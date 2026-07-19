import { WebSocket } from "ws";
import { storage as defaultStorage, SYSTEM_CTX } from "./storage";
import type { IStorage } from "./storage";
import type { Game, Question } from "@shared/schema";
import { quizQuestionsSchema } from "@shared/schema";
import { isSelectionCorrect, streakMultiplier, tallyDistribution } from "@shared/quiz-scoring";
import type { WsErrorCode, WsServerMessage } from "@shared/ws-protocol";
import { captureError } from "./instrument";
import { logAudit, AUDIT_ACTIONS } from "./audit";

interface RuntimePlayer {
  name: string;
  score: number;
}

interface RuntimeAnswer {
  playerName: string;
  questionIndex: number;
  selectedAnswer: number;
  responseTime: number;
  isCorrect: boolean;
  pointsEarned: number;
  answeredAt: number;
}

interface RuntimeRoom {
  gamePin: string;
  gameId: number;
  tenantId: number;
  quizId: number;
  hostId: number;
  status: "waiting" | "active" | "completed";
  currentQuestion: number;
  questions: Question[];
  players: Map<string, RuntimePlayer>;
  // Consecutive-correct-answer streak per player, keyed by playerKey (the same
  // case/whitespace-normalized key used by `players`/`acceptedAnswers`). Lives
  // on the room, so it survives a player's reconnect (new socket, same room)
  // and only resets on a wrong answer or a missed question (see closeQuestion).
  streaks: Map<string, number>;
  acceptedAnswers: Map<string, RuntimeAnswer>;
  persistedQuestionIndexes: Set<number>;
  closedResults: Map<number, QuestionCloseResult>;
  hostSocket?: WebSocket;
  playerSockets: Map<string, WebSocket>;
  questionStartedAt?: number;
  questionClosesAt?: number | null;
  questionOpen: boolean;
  closeTimer?: NodeJS.Timeout;
  tickTimer?: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
  lastActivityAt: number;
}

interface QuestionCloseResult {
  questionIndex: number;
  // correctAnswer = first correct index (kept for backward-compatible clients);
  // correctAnswers = full correct set (single- or multi-select).
  correctAnswer: number;
  correctAnswers: number[];
  answerCounts: number[];
  answerPercentages: number[];
  totalResponses: number;
  players: RuntimePlayer[];
}

interface RegisterClientInput {
  ws: WebSocket;
  gamePin: string;
  userId?: number;
  // Tenant the caller's bearer token was minted for (undefined for session/no
  // token). When present it must match the game's tenant.
  tokenTenantId?: number;
  wantsHostRole: boolean;
  playerName?: string;
}

interface SubmitAnswerInput {
  gamePin: string;
  playerName: string;
  questionIndex: number;
  selectedAnswer: number;
}

// The games row carries questions_snapshot — the FULL question set including
// answer keys — for the engine and insights. It must NEVER reach a client.
// Every path that returns or broadcasts a game object strips it here.
export function toClientGame<T extends { questionsSnapshot?: unknown }>(game: T): Omit<T, "questionsSnapshot"> {
  const { questionsSnapshot: _omit, ...rest } = game;
  return rest;
}

// Shape returned to callers/broadcasts once questionsSnapshot has been stripped.
export type ClientGame = Omit<Game, "questionsSnapshot">;

export class RoomError extends Error {
  constructor(
    public readonly code: WsErrorCode,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export class GameRoomManager {
  private rooms: Map<string, RuntimeRoom> = new Map();
  private socketIndex: WeakMap<WebSocket, { gamePin: string; playerName?: string; isHost: boolean }> = new WeakMap();
  private socketLastSeen: WeakMap<WebSocket, number> = new WeakMap();
  private readonly cleanupAfterCompletionMs = 10 * 60 * 1000;
  private readonly cleanupAfterIdleMs = 30 * 60 * 1000;

  constructor(private readonly storage: IStorage = defaultStorage) {}

  async registerClient(input: RegisterClientInput): Promise<{ isHost: boolean; room: RuntimeRoom }> {
    const room = await this.getOrCreateRoom(input.gamePin);
    this.touch(room);

    // A bearer token is bound to the tenant it was minted on. Reject a host
    // whose token belongs to a different tenant than the game — defense in
    // depth alongside the userId === hostId check below (hostId is a globally
    // unique serial, so takeover is already blocked, but this keeps the WS
    // tenant boundary consistent with the HTTP layer).
    if (
      input.wantsHostRole &&
      input.tokenTenantId !== undefined &&
      input.tokenTenantId !== room.tenantId
    ) {
      throw new RoomError("HOST_REQUIRED", "Host session required", 403);
    }

    const isHost = input.wantsHostRole && input.userId === room.hostId;
    if (input.wantsHostRole && !isHost) {
      throw new RoomError("HOST_REQUIRED", "Host session required", 403);
    }

    if (isHost) {
      if (room.hostSocket && room.hostSocket !== input.ws) {
        room.hostSocket.close(1000, "Replaced by a newer host connection");
      }
      room.hostSocket = input.ws;
      this.socketIndex.set(input.ws, { gamePin: input.gamePin, isHost: true });
      this.socketLastSeen.set(input.ws, Date.now());
    } else {
      const normalizedName = input.playerName?.trim().slice(0, 40);
      if (!normalizedName) {
        throw new RoomError("PLAYER_NOT_REGISTERED", "Player name required", 403);
      }

      const player = this.findPlayer(room, normalizedName);
      if (!player) {
        throw new RoomError("PLAYER_NOT_REGISTERED", "Player has not joined this game", 403);
      }

      const key = this.playerKey(player.name);
      const existingSocket = room.playerSockets.get(key);
      if (existingSocket && existingSocket !== input.ws) {
        existingSocket.close(1000, "Replaced by a newer player connection");
      }

      room.playerSockets.set(key, input.ws);
      this.socketIndex.set(input.ws, { gamePin: input.gamePin, playerName: player.name, isHost: false });
      this.socketLastSeen.set(input.ws, Date.now());
    }

    this.send(input.ws, { type: "joined", gamePin: input.gamePin, isHost });
    this.sendCurrentQuestionState(input.ws, room);
    return { isHost, room };
  }

  removeClient(ws: WebSocket) {
    const indexed = this.socketIndex.get(ws);
    if (!indexed) return;

    const room = this.rooms.get(indexed.gamePin);
    if (!room) return;

    if (indexed.isHost && room.hostSocket === ws) {
      room.hostSocket = undefined;
    }

    if (indexed.playerName) {
      const key = this.playerKey(indexed.playerName);
      if (room.playerSockets.get(key) === ws) {
        room.playerSockets.delete(key);
      }
    }

    this.scheduleIdleCleanup(room);
  }

  markSocketSeen(ws: WebSocket) {
    this.socketLastSeen.set(ws, Date.now());
  }

  heartbeat(staleAfterMs: number) {
    const staleBefore = Date.now() - staleAfterMs;
    for (const room of Array.from(this.rooms.values())) {
      const sockets = [
        room.hostSocket,
        ...Array.from(room.playerSockets.values()),
      ].filter(Boolean) as WebSocket[];

      for (const ws of sockets) {
        const lastSeen = this.socketLastSeen.get(ws) || 0;
        if (ws.readyState !== WebSocket.OPEN || lastSeen < staleBefore) {
          ws.terminate();
          this.removeClient(ws);
          continue;
        }

        ws.ping();
      }
    }
  }

  async addPersistedPlayer(gamePin: string, playerName: string, score = 0) {
    const room = this.rooms.get(gamePin);
    if (!room) return;

    room.players.set(this.playerKey(playerName), { name: playerName, score });
    this.touch(room);
  }

  async broadcastGameUpdated(gamePin: string, game: Game) {
    const room = this.rooms.get(gamePin);
    if (!room) return;

    this.broadcast(room, { type: "game_updated", game: this.applyRuntimeState(game) });
  }

  async startGame(gamePin: string, hostId: number): Promise<ClientGame> {
    const room = await this.getOrCreateRoom(gamePin);
    this.assertHost(room, hostId);

    room.status = "active";
    room.currentQuestion = 0;
    room.acceptedAnswers.clear();
    room.closedResults.clear();
    room.persistedQuestionIndexes.clear();
    room.questionOpen = false;
    this.clearQuestionTimers(room);
    this.touch(room);

    const updatedGame = await this.storage.updateGame(SYSTEM_CTX, room.gameId, {
      status: "active",
      currentQuestion: 0,
    });

    const game = this.applyRuntimeState(updatedGame);
    this.broadcast(room, { type: "game_started", game });
    this.startQuestion(room, 0, game);
    return game;
  }

  async submitAnswer(input: SubmitAnswerInput): Promise<{ success: true; streak: number }> {
    const room = await this.getOrCreateRoom(input.gamePin);
    this.touch(room);

    if (room.status !== "active" || room.currentQuestion !== input.questionIndex || !room.questionOpen) {
      throw new RoomError("QUESTION_CLOSED", "Question is closed", 409);
    }

    // No-limit questions (questionClosesAt === null) have no auto-close deadline —
    // only host-advance (closeQuestion("host")) closes them. Only auto-close a
    // timed question whose deadline has passed.
    if (!room.questionStartedAt || (room.questionClosesAt && Date.now() >= room.questionClosesAt)) {
      await this.closeQuestion(room, "timer");
      throw new RoomError("QUESTION_CLOSED", "Question is closed", 409);
    }

    const player = this.findPlayer(room, input.playerName);
    if (!player) {
      throw new RoomError("PLAYER_NOT_REGISTERED", "Player has not joined this game", 403);
    }

    const answerKey = this.answerKey(player.name, input.questionIndex);
    if (room.acceptedAnswers.has(answerKey)) {
      throw new RoomError("DUPLICATE_ANSWER", "Player has already answered this question", 409);
    }

    const question = room.questions[input.questionIndex];
    if (!question) {
      throw new RoomError("INVALID_PAYLOAD", "Invalid question index", 400);
    }

    const responseTime = Math.max(0, Date.now() - room.questionStartedAt);
    // Single-select: selectedAnswer is a chosen index. Multi-select: a bitmask.
    // isSelectionCorrect handles both (multi is all-or-nothing; polls are never "correct").
    const isCorrect = isSelectionCorrect(question, input.selectedAnswer);

    const streakKey = this.playerKey(player.name);
    let pointsEarned = 0;
    let streak = 0;

    if (question.type === "poll") {
      // Polls are a tally, not a scored question: zero points, and the streak
      // Map is left untouched (a poll neither extends nor breaks a streak).
      // poll is streak-neutral — report the player's current streak unchanged
      pointsEarned = 0;
      streak = room.streaks.get(streakKey) ?? 0;
    } else if (isCorrect) {
      streak = (room.streaks.get(streakKey) ?? 0) + 1;
      room.streaks.set(streakKey, streak);
      pointsEarned = Math.round(this.calculatePoints(question, responseTime) * streakMultiplier(streak));
    } else {
      room.streaks.set(streakKey, 0);
      pointsEarned = 0;
      streak = 0;
    }

    room.acceptedAnswers.set(answerKey, {
      playerName: player.name,
      questionIndex: input.questionIndex,
      selectedAnswer: input.selectedAnswer,
      responseTime,
      isCorrect,
      pointsEarned,
      answeredAt: Date.now(),
    });

    return { success: true, streak };
  }

  async advanceQuestion(gamePin: string, hostId: number): Promise<{ gameComplete: boolean; game: ClientGame }> {
    const room = await this.getOrCreateRoom(gamePin);
    this.assertHost(room, hostId);
    this.touch(room);

    if (room.status !== "active") {
      throw new RoomError("INVALID_PAYLOAD", "Game is not active", 400);
    }

    if (room.questionOpen) {
      await this.closeQuestion(room, "host");
    }

    const nextQuestion = room.currentQuestion + 1;
    if (nextQuestion >= room.questions.length) {
      const completedGame = await this.completeGame(room);
      return { gameComplete: true, game: completedGame };
    }

    room.currentQuestion = nextQuestion;
    room.acceptedAnswers.clear();
    room.questionOpen = false;
    this.clearQuestionTimers(room);

    const updatedGame = await this.storage.updateGame(SYSTEM_CTX, room.gameId, { currentQuestion: nextQuestion });
    const game = this.applyRuntimeState(updatedGame);
    this.broadcast(room, { type: "next_question", game });
    this.startQuestion(room, nextQuestion, game);
    return { gameComplete: false, game };
  }

  async getGameSnapshot(gamePin: string, game: Game): Promise<ClientGame> {
    const room = this.rooms.get(gamePin);
    if (!room) return toClientGame(game);
    return this.applyRuntimeState(game);
  }

  getQuestionResults(gamePin: string, questionIndex: number): QuestionCloseResult | undefined {
    return this.rooms.get(gamePin)?.closedResults.get(questionIndex);
  }

  toHttpError(error: unknown): { status: number; body: { message: string; code?: WsErrorCode } } {
    if (error instanceof RoomError) {
      return { status: error.status, body: { message: error.message, code: error.code } };
    }

    return { status: 500, body: { message: "Runtime room error" } };
  }

  private async getOrCreateRoom(gamePin: string): Promise<RuntimeRoom> {
    const existing = this.rooms.get(gamePin);
    if (existing) return existing;

    const game = await this.storage.getGameByPin(SYSTEM_CTX, gamePin);
    if (!game) {
      throw new RoomError("ROOM_NOT_FOUND", "Game not found", 404);
    }

    // Prefer the frozen per-game snapshot (the questions this game's players
    // actually saw) over the live quiz row: a quiz edit combined with a
    // server restart must not swap questions under an in-flight game, and
    // insights attribute historical responses against this exact set.
    let normalizedQuestions: Question[];
    if (Array.isArray(game.questionsSnapshot) && game.questionsSnapshot.length > 0) {
      normalizedQuestions = quizQuestionsSchema.parse(game.questionsSnapshot);
    } else {
      const quiz = await this.storage.getQuiz(SYSTEM_CTX, game.quizId);
      if (!quiz || !Array.isArray(quiz.questions)) {
        throw new RoomError("ROOM_NOT_FOUND", "Quiz not found", 404);
      }
      // Normalize stored questions to the canonical shape (correctAnswers /
      // type / answerType). Legacy quizzes hold only `correctAnswer` — the
      // engine's scoring reads `correctAnswers`, so this must run before play.
      normalizedQuestions = quizQuestionsSchema.parse(quiz.questions);
      // Freeze the played set ONCE. One write per game at hydration — never
      // on timer ticks (hard rule).
      await this.storage.updateGame(SYSTEM_CTX, game.id, { questionsSnapshot: normalizedQuestions });
    }

    // Roster is sourced from the authoritative game_players table (SYSTEM_CTX —
    // the engine keys rooms by globally-unique pin), not the legacy JSON array.
    const dbPlayers = await this.storage.getGamePlayers(SYSTEM_CTX, game.id);
    const players = new Map<string, RuntimePlayer>();
    for (const player of dbPlayers) {
      players.set(this.playerKey(player.name), {
        name: player.name,
        score: player.score || 0,
      });
    }

    const room: RuntimeRoom = {
      gamePin,
      gameId: game.id,
      tenantId: game.tenantId,
      quizId: game.quizId,
      hostId: game.hostId,
      status: game.status as RuntimeRoom["status"],
      currentQuestion: game.currentQuestion || 0,
      questions: normalizedQuestions,
      players,
      streaks: new Map(),
      acceptedAnswers: new Map(),
      persistedQuestionIndexes: new Set(),
      closedResults: new Map(),
      playerSockets: new Map(),
      questionOpen: false,
      lastActivityAt: Date.now(),
    };

    this.rooms.set(gamePin, room);
    this.scheduleIdleCleanup(room);
    return room;
  }

  private startQuestion(room: RuntimeRoom, questionIndex: number, game: ClientGame) {
    const question = room.questions[questionIndex];
    if (!question) return;

    this.clearQuestionTimers(room);
    room.currentQuestion = questionIndex;
    room.questionOpen = true;
    room.acceptedAnswers.clear();

    const noLimit = !question.timeLimit; // timeLimit === 0
    room.questionStartedAt = Date.now();
    room.questionClosesAt = noLimit ? null : room.questionStartedAt + question.timeLimit * 1000;
    this.touch(room);

    this.broadcast(room, {
      type: "question_started",
      gamePin: room.gamePin,
      questionIndex,
      durationSeconds: noLimit ? 0 : question.timeLimit,
      startedAt: room.questionStartedAt,
      closesAt: room.questionClosesAt ?? 0,
      timeRemaining: this.getTimeRemaining(room),
    });
    this.broadcast(room, { type: "game_updated", game });

    if (!noLimit) {
      room.tickTimer = setInterval(() => {
        if (!room.questionOpen) return;
        const timeRemaining = this.getTimeRemaining(room);
        this.broadcast(room, {
          type: "time_remaining",
          gamePin: room.gamePin,
          questionIndex: room.currentQuestion,
          timeRemaining,
        });
      }, 1000);
      room.tickTimer.unref();

      room.closeTimer = setTimeout(() => {
        // A rejection here has no caller to bubble to — the question would
        // silently stay open for every player. Log and report it.
        this.closeQuestion(room, "timer").catch((error) => {
          console.error(`closeQuestion(timer) failed for game ${room.gamePin}:`, error);
          captureError(error, {
            scope: "question_close_timer",
            gamePin: room.gamePin,
            tenantId: room.tenantId,
          });
        });
      }, Math.max(0, room.questionClosesAt! - Date.now()));
      room.closeTimer.unref();
    }
  }

  private async closeQuestion(room: RuntimeRoom, _reason: "timer" | "host"): Promise<QuestionCloseResult> {
    if (!room.questionOpen && room.closedResults.has(room.currentQuestion)) {
      return room.closedResults.get(room.currentQuestion)!;
    }

    const questionIndex = room.currentQuestion;
    const question = room.questions[questionIndex];
    room.questionOpen = false;
    this.clearQuestionTimers(room);
    this.touch(room);

    if (!room.persistedQuestionIndexes.has(questionIndex)) {
      // Claim this question synchronously — before any await — so a concurrent
      // closeQuestion (e.g. the close timer firing at the same moment the host
      // advances, or two late answers both triggering a close) cannot re-enter
      // this block and double-persist responses or double-count player scores.
      room.persistedQuestionIndexes.add(questionIndex);

      const responses = Array.from(room.acceptedAnswers.values())
        .filter((answer) => answer.questionIndex === questionIndex);

      // One multi-row INSERT instead of a per-answer loop: a 400-player question
      // was ~400 sequential round-trips (~5-6 min for a full game); this is a
      // single statement. Scores are tallied in-memory (never a DB bottleneck).
      await this.storage.createGameResponses(
        SYSTEM_CTX,
        responses.map((response) => ({
          tenantId: room.tenantId,
          gameId: room.gameId,
          playerName: response.playerName,
          questionIndex: response.questionIndex,
          selectedAnswer: response.selectedAnswer,
          responseTime: response.responseTime,
          isCorrect: response.isCorrect,
          pointsEarned: response.pointsEarned,
        })),
      );

      for (const response of responses) {
        const player = this.findPlayer(room, response.playerName);
        if (player) {
          player.score += response.pointsEarned;
        }
      }

      // A roster player who did NOT respond to this question breaks their
      // streak (they can't have answered correctly) — except a poll, which is
      // streak-neutral for everyone, answered or not.
      if (question?.type !== "poll") {
        const answeredKeys = new Set(responses.map((r) => this.playerKey(r.playerName)));
        for (const key of Array.from(room.players.keys())) {
          if (!answeredKeys.has(key)) {
            room.streaks.set(key, 0);
          }
        }
      }
    }

    const result = this.buildQuestionResult(room, questionIndex, question);
    room.closedResults.set(questionIndex, result);

    this.broadcast(room, {
      type: "question_closed",
      gamePin: room.gamePin,
      questionIndex,
      correctAnswer: result.correctAnswer,
      correctAnswers: result.correctAnswers,
      distribution: {
        answerCounts: result.answerCounts,
        answerPercentages: result.answerPercentages,
        totalResponses: result.totalResponses,
      },
      players: result.players,
    });

    return result;
  }

  private async completeGame(room: RuntimeRoom): Promise<ClientGame> {
    room.status = "completed";
    room.questionOpen = false;
    this.clearQuestionTimers(room);
    this.touch(room);

    const players = this.runtimePlayers(room);
    // Persist final scores to the authoritative roster (game_players), not the
    // frozen games.players JSON. One bulk statement, not N updates.
    await this.storage.setGamePlayerScores(
      SYSTEM_CTX,
      room.gameId,
      players.map((p) => ({ name: p.name, score: p.score })),
    );
    const updatedGame = await this.storage.updateGame(SYSTEM_CTX, room.gameId, {
      status: "completed",
    });

    // Audit: game completed. SYSTEM_CTX has no tenant, so pass the room's
    // tenant explicitly; one low-volume user lookup for the name snapshot.
    const host = await this.storage.getUser({ tenantId: room.tenantId }, room.hostId).catch(() => undefined);
    logAudit(this.storage, { tenantId: room.tenantId }, {
      action: AUDIT_ACTIONS.GAME_COMPLETE,
      actorId: room.hostId,
      actorName: host?.username ?? `user#${room.hostId}`,
      targetType: "game",
      targetId: room.gameId,
      targetLabel: room.gamePin,
      details: { pin: room.gamePin, players: players.length },
    });

    const game = this.applyRuntimeState(updatedGame);
    this.broadcast(room, { type: "game_completed", game });
    this.scheduleCompletionCleanup(room);
    return game;
  }

  private buildQuestionResult(room: RuntimeRoom, questionIndex: number, question?: Question): QuestionCloseResult {
    const responses = Array.from(room.acceptedAnswers.values())
      .filter((answer) => answer.questionIndex === questionIndex);

    // Distribution sized to the question's answer count (was hardcoded 4);
    // multi-select selections are decoded from their bitmask per option.
    const answerCounts = question
      ? tallyDistribution(question, responses.map((r) => r.selectedAnswer))
      : [];

    const totalResponses = responses.length;
    const answerPercentages = answerCounts.map((count) =>
      totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0,
    );

    const correctAnswers = question?.correctAnswers ?? [];
    // Polls have no correct answer to reveal — send -1 rather than leaking a
    // meaningless 0 that a client could mistake for "option 0 is correct".
    const correctAnswer = question?.type === "poll" ? -1 : (correctAnswers[0] ?? 0);

    return {
      questionIndex,
      correctAnswer,
      correctAnswers,
      answerCounts,
      answerPercentages,
      totalResponses,
      players: this.runtimePlayers(room),
    };
  }

  private sendCurrentQuestionState(ws: WebSocket, room: RuntimeRoom) {
    if (room.status === "completed") return;

    if (room.questionOpen && room.questionStartedAt) {
      const q = room.questions[room.currentQuestion];
      this.send(ws, {
        type: "question_started",
        gamePin: room.gamePin,
        questionIndex: room.currentQuestion,
        durationSeconds: q?.timeLimit || 0,
        startedAt: room.questionStartedAt,
        closesAt: room.questionClosesAt ?? 0,
        timeRemaining: this.getTimeRemaining(room),
      });
      return;
    }

    const result = room.closedResults.get(room.currentQuestion);
    if (result) {
      this.send(ws, {
        type: "question_closed",
        gamePin: room.gamePin,
        questionIndex: result.questionIndex,
        correctAnswer: result.correctAnswer,
        correctAnswers: result.correctAnswers,
        distribution: {
          answerCounts: result.answerCounts,
          answerPercentages: result.answerPercentages,
          totalResponses: result.totalResponses,
        },
        players: result.players,
      });
    }
  }

  private applyRuntimeState(game?: Game): ClientGame {
    if (!game) {
      throw new RoomError("ROOM_NOT_FOUND", "Game not found", 404);
    }

    const room = this.rooms.get(game.gamePin);
    if (!room) return toClientGame(game);

    return toClientGame({
      ...game,
      status: room.status,
      currentQuestion: room.currentQuestion,
      players: this.runtimePlayers(room),
    });
  }

  private runtimePlayers(room: RuntimeRoom): RuntimePlayer[] {
    return Array.from(room.players.values())
      .sort((a, b) => b.score - a.score)
      .map((player) => ({ ...player }));
  }

  private calculatePoints(question: Question, responseTime: number): number {
    const maxPoints = 1000;
    const multiplier = question.points === "double" ? 2 : 1;
    // No-limit questions (timeLimit === 0) have no time pressure → flat floor score.
    if (!question.timeLimit) {
      return Math.round(maxPoints * 0.5 * multiplier);
    }
    const timeLimit = question.timeLimit;
    const timeBonus = Math.max(0, (timeLimit - responseTime / 1000) / timeLimit);
    return Math.round(maxPoints * (0.5 + 0.5 * timeBonus) * multiplier);
  }

  private getTimeRemaining(room: RuntimeRoom): number {
    if (!room.questionClosesAt) return 0;
    return Math.max(0, Math.ceil((room.questionClosesAt - Date.now()) / 1000));
  }

  private findPlayer(room: RuntimeRoom, playerName: string): RuntimePlayer | undefined {
    return room.players.get(this.playerKey(playerName));
  }

  private playerKey(playerName: string): string {
    return playerName.trim().toLowerCase();
  }

  private answerKey(playerName: string, questionIndex: number): string {
    return `${this.playerKey(playerName)}:${questionIndex}`;
  }

  private assertHost(room: RuntimeRoom, hostId: number) {
    if (room.hostId !== hostId) {
      throw new RoomError("HOST_REQUIRED", "Only the game host can control this game", 403);
    }
  }

  private clearQuestionTimers(room: RuntimeRoom) {
    if (room.closeTimer) {
      clearTimeout(room.closeTimer);
      room.closeTimer = undefined;
    }

    if (room.tickTimer) {
      clearInterval(room.tickTimer);
      room.tickTimer = undefined;
    }
  }

  private touch(room: RuntimeRoom) {
    room.lastActivityAt = Date.now();
    if (room.cleanupTimer && room.status !== "completed") {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = undefined;
    }
  }

  private scheduleIdleCleanup(room: RuntimeRoom) {
    if (room.status === "completed" || room.cleanupTimer || this.hasConnectedSockets(room)) return;

    room.cleanupTimer = setTimeout(() => {
      if (!this.hasConnectedSockets(room) && Date.now() - room.lastActivityAt >= this.cleanupAfterIdleMs) {
        this.disposeRoom(room);
      } else {
        room.cleanupTimer = undefined;
        this.scheduleIdleCleanup(room);
      }
    }, this.cleanupAfterIdleMs);
    room.cleanupTimer.unref();
  }

  private scheduleCompletionCleanup(room: RuntimeRoom) {
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
    }

    room.cleanupTimer = setTimeout(() => {
      this.disposeRoom(room);
    }, this.cleanupAfterCompletionMs);
    room.cleanupTimer.unref();
  }

  private disposeRoom(room: RuntimeRoom) {
    this.clearQuestionTimers(room);
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
    }
    this.rooms.delete(room.gamePin);
  }

  private hasConnectedSockets(room: RuntimeRoom): boolean {
    if (room.hostSocket?.readyState === WebSocket.OPEN) return true;
    return Array.from(room.playerSockets.values()).some((ws) => ws.readyState === WebSocket.OPEN);
  }

  private broadcast(room: RuntimeRoom, message: WsServerMessage) {
    if (room.hostSocket) {
      this.send(room.hostSocket, message);
    }

    for (const ws of Array.from(room.playerSockets.values())) {
      this.send(ws, message);
    }
  }

  private send(ws: WebSocket, message: WsServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

export const gameRoomManager = new GameRoomManager();
