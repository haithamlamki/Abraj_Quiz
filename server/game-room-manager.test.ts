import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

class FakeSocket {
  readyState = WebSocket.OPEN;
  sent: any[] = [];
  closed = false;

  send(payload: string) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
  }

  terminate() {
    this.close();
  }

  ping() {
    // no-op for tests
  }
}

async function createRuntimeFixture() {
  const [{ GameRoomManager }, { MemStorage }] = await Promise.all([
    import("./game-room-manager"),
    import("./storage"),
  ]);

  const storage = new MemStorage();
  await storage.createGame({ tenantId: 1 }, {
    quizId: 1,
    gamePin: "123456",
    hostId: 1,
    status: "waiting",
  });
  // Seed the roster through the authoritative path (game_players), not the
  // legacy JSON — the runtime room now loads players from game_players.
  await storage.joinGame({ tenantId: 1 }, "123456", "Alice");

  const manager = new GameRoomManager(storage);
  const hostSocket = new FakeSocket();
  const playerSocket = new FakeSocket();

  await manager.registerClient({
    ws: hostSocket as unknown as WebSocket,
    gamePin: "123456",
    userId: 1,
    wantsHostRole: true,
  });
  await manager.registerClient({
    ws: playerSocket as unknown as WebSocket,
    gamePin: "123456",
    wantsHostRole: false,
    playerName: "Alice",
  });

  return { manager, storage, hostSocket, playerSocket };
}

test("runtime room starts a server-authoritative question", async () => {
  const { manager, hostSocket, playerSocket } = await createRuntimeFixture();

  const game = await manager.startGame("123456", 1);

  assert.equal(game.status, "active");
  assert.equal(game.currentQuestion, 0);
  assert.ok(hostSocket.sent.some((event) => event.type === "game_started"));
  assert.ok(hostSocket.sent.some((event) => event.type === "question_started"));
  assert.ok(playerSocket.sent.some((event) => event.type === "question_started"));

  const questionStarted = playerSocket.sent.find((event) => event.type === "question_started");
  assert.equal(questionStarted.questionIndex, 0);
  assert.equal(typeof questionStarted.timeRemaining, "number");
});

test("runtime room rejects duplicate answers and flushes accepted answers on question close", async () => {
  const { manager, storage, hostSocket } = await createRuntimeFixture();

  await manager.startGame("123456", 1);

  const answer = await manager.submitAnswer({
    gamePin: "123456",
    playerName: "Alice",
    questionIndex: 0,
    selectedAnswer: 0,
  });
  assert.deepEqual(answer, { success: true, streak: 1 });

  const duplicate = await manager.submitAnswer({
    gamePin: "123456",
    playerName: "Alice",
    questionIndex: 0,
    selectedAnswer: 0,
  }).catch((error) => manager.toHttpError(error));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "DUPLICATE_ANSWER");

  const next = await manager.advanceQuestion("123456", 1);
  assert.equal(next.gameComplete, false);
  assert.equal(next.game.currentQuestion, 1);

  const responses = await storage.getGameResponses({ tenantId: 1 }, 1);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].playerName, "Alice");
  assert.equal(responses[0].isCorrect, true);
  assert.ok(responses[0].pointsEarned > 0);
  assert.ok(hostSocket.sent.some((event) => event.type === "question_closed"));
});

test("runtime room batch-persists every player's response on question close", async () => {
  const [{ GameRoomManager }, { MemStorage }] = await Promise.all([
    import("./game-room-manager"),
    import("./storage"),
  ]);

  const storage = new MemStorage();
  const players = Array.from({ length: 25 }, (_, i) => ({ name: `p${i}`, score: 0 }));
  const game = await storage.createGame({ tenantId: 1 }, {
    quizId: 1,
    gamePin: "654321",
    hostId: 1,
    status: "waiting",
  });
  for (const player of players) {
    await storage.joinGame({ tenantId: 1 }, "654321", player.name);
  }

  const manager = new GameRoomManager(storage);
  await manager.startGame("654321", 1);

  for (const player of players) {
    await manager.submitAnswer({
      gamePin: "654321",
      playerName: player.name,
      questionIndex: 0,
      selectedAnswer: 0,
    });
  }

  await manager.advanceQuestion("654321", 1);

  // The batched INSERT must persist one row per answering player — no drops,
  // no duplicates — exactly as the old per-answer loop did.
  const responses = await storage.getGameResponses({ tenantId: 1 }, game.id);
  assert.equal(responses.length, players.length);
  assert.deepEqual(
    responses.map((r) => r.playerName).sort(),
    players.map((p) => p.name).sort(),
  );
});

test("runtime room rejects late answers after the question is closed", async () => {
  const { manager } = await createRuntimeFixture();

  await manager.startGame("123456", 1);
  await manager.advanceQuestion("123456", 1);

  const lateAnswer = await manager.submitAnswer({
    gamePin: "123456",
    playerName: "Alice",
    questionIndex: 0,
    selectedAnswer: 0,
  }).catch((error) => manager.toHttpError(error));

  assert.equal(lateAnswer.status, 409);
  assert.equal(lateAnswer.body.code, "QUESTION_CLOSED");
});

test("concurrent closeQuestion does not double-count scores or double-persist", async () => {
  const { manager, storage } = await createRuntimeFixture();

  await manager.startGame("123456", 1);
  await manager.submitAnswer({
    gamePin: "123456",
    playerName: "Alice",
    questionIndex: 0,
    selectedAnswer: 0,
  });

  // Simulate the race: the close timer firing at the same instant the host
  // advances (both funnel into closeQuestion for the same question).
  const room = (manager as any).rooms.get("123456");
  await Promise.all([
    (manager as any).closeQuestion(room, "timer"),
    (manager as any).closeQuestion(room, "host"),
  ]);

  const responses = await storage.getGameResponses({ tenantId: 1 }, 1);
  assert.equal(responses.length, 1, "answer must be persisted exactly once");

  const player = (room.players as Map<string, { score: number }>).get("alice");
  const single = responses[0].pointsEarned;
  assert.equal(player?.score, single, "score must be counted exactly once");
});

test("registerClient rejects a host whose token tenant does not match the game's tenant", async () => {
  const { manager } = await createRuntimeFixture();

  const foreign = new FakeSocket();
  const rejected = await manager
    .registerClient({
      ws: foreign as unknown as WebSocket,
      gamePin: "123456",
      userId: 1,
      wantsHostRole: true,
      tokenTenantId: 999, // room's tenant is 1
    })
    .catch((error) => manager.toHttpError(error));
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.code, "HOST_REQUIRED");

  // A matching token tenant is accepted.
  const okSocket = new FakeSocket();
  const ok = await manager.registerClient({
    ws: okSocket as unknown as WebSocket,
    gamePin: "123456",
    userId: 1,
    wantsHostRole: true,
    tokenTenantId: 1,
  });
  assert.equal(ok.isHost, true);
});

test("runtime room persists final scores when completing the game", async () => {
  const { manager, storage } = await createRuntimeFixture();

  await manager.startGame("123456", 1);
  await manager.submitAnswer({
    gamePin: "123456",
    playerName: "Alice",
    questionIndex: 0,
    selectedAnswer: 0,
  });

  await manager.advanceQuestion("123456", 1);
  await manager.advanceQuestion("123456", 1);
  const completed = await manager.advanceQuestion("123456", 1);

  assert.equal(completed.gameComplete, true);
  assert.equal(completed.game.status, "completed");

  const persistedGame = await storage.getGameByPin({ tenantId: 1 }, "123456");
  assert.equal(persistedGame?.status, "completed");
  // Final scores are persisted to the authoritative game_players roster.
  const roster = await storage.getGamePlayers({ tenantId: 1 }, persistedGame!.id);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].name, "Alice");
  assert.ok(roster[0].score > 0);
});

test("calculatePoints doubles the score for double-points questions", async () => {
  const { GameRoomManager } = await import("./game-room-manager");
  const { MemStorage } = await import("./storage");

  const mgr = new GameRoomManager(new MemStorage());
  const base = (mgr as any).calculatePoints({ timeLimit: 20, points: "standard" }, 0);
  const doubled = (mgr as any).calculatePoints({ timeLimit: 20, points: "double" }, 0);
  assert.equal(doubled, base * 2);
});

test("calculatePoints gives a flat score for no-limit questions", async () => {
  const { GameRoomManager } = await import("./game-room-manager");
  const { MemStorage } = await import("./storage");

  const mgr = new GameRoomManager(new MemStorage());
  const fast = (mgr as any).calculatePoints({ timeLimit: 0, points: "standard" }, 0);
  const slow = (mgr as any).calculatePoints({ timeLimit: 0, points: "standard" }, 60_000);
  assert.equal(fast, slow); // no time bonus when there is no limit
  assert.ok(fast > 0);
});

test("no-limit question schedules no close timer and stays open for host-paced answers", async () => {
  const [{ GameRoomManager }, { MemStorage }] = await Promise.all([
    import("./game-room-manager"),
    import("./storage"),
  ]);

  const storage = new MemStorage();
  const quiz = await storage.createQuiz({ tenantId: 1 }, {
    title: "No-limit quiz",
    createdBy: 1,
    questions: [
      {
        question: "Take your time",
        answers: ["A", "B"],
        correctAnswer: 0,
        timeLimit: 0, // no limit — host advances manually
      },
    ],
  } as any);

  await storage.createGame({ tenantId: 1 }, {
    quizId: quiz.id,
    gamePin: "999000",
    hostId: 1,
    status: "waiting",
  });
  await storage.joinGame({ tenantId: 1 }, "999000", "Bob");

  const manager = new GameRoomManager(storage);
  const hostSocket = new FakeSocket();
  const playerSocket = new FakeSocket();

  await manager.registerClient({
    ws: hostSocket as unknown as WebSocket,
    gamePin: "999000",
    userId: 1,
    wantsHostRole: true,
  });
  await manager.registerClient({
    ws: playerSocket as unknown as WebSocket,
    gamePin: "999000",
    wantsHostRole: false,
    playerName: "Bob",
  });

  await manager.startGame("999000", 1);

  const started = playerSocket.sent.find((event) => event.type === "question_started");
  assert.equal(started.durationSeconds, 0);
  assert.equal(started.closesAt, 0);

  const room = (manager as any).rooms.get("999000");
  assert.equal(room.questionClosesAt, null);
  assert.equal(room.closeTimer, undefined);
  assert.equal(room.tickTimer, undefined);

  // A no-limit question must still accept answers — it must not be treated
  // as already closed just because there is no close deadline.
  const answer = await manager.submitAnswer({
    gamePin: "999000",
    playerName: "Bob",
    questionIndex: 0,
    selectedAnswer: 0,
  });
  assert.deepEqual(answer, { success: true, streak: 1 });

  // Reconnecting mid-question must still resend question_started (regression
  // guard for sendCurrentQuestionState requiring a non-null questionClosesAt).
  const reconnectSocket = new FakeSocket();
  await manager.registerClient({
    ws: reconnectSocket as unknown as WebSocket,
    gamePin: "999000",
    wantsHostRole: false,
    playerName: "Bob",
  });
  const resent = reconnectSocket.sent.find((event) => event.type === "question_started");
  assert.ok(resent, "reconnect must resend question_started for an open no-limit question");
  assert.equal(resent.durationSeconds, 0);
});

// --- Streak state + poll close semantics -----------------------------------
//
// All fixtures below use timeLimit: 0 (no-limit) questions so calculatePoints
// is a deterministic flat score (no time-bonus variance from wall-clock
// timing in tests).

async function createStreakFixture(gamePin: string, questions: any[], playerNames: string[] = ["Alice"]) {
  const [{ GameRoomManager }, { MemStorage }] = await Promise.all([
    import("./game-room-manager"),
    import("./storage"),
  ]);

  const storage = new MemStorage();
  const quiz = await storage.createQuiz({ tenantId: 1 }, {
    title: "Streak test quiz",
    createdBy: 1,
    questions,
  } as any);

  const game = await storage.createGame({ tenantId: 1 }, {
    quizId: quiz.id,
    gamePin,
    hostId: 1,
    status: "waiting",
  });

  for (const name of playerNames) {
    await storage.joinGame({ tenantId: 1 }, gamePin, name);
  }

  const manager = new GameRoomManager(storage);
  const hostSocket = new FakeSocket();
  const playerSockets: Record<string, FakeSocket> = {};

  await manager.registerClient({
    ws: hostSocket as unknown as WebSocket,
    gamePin,
    userId: 1,
    wantsHostRole: true,
  });

  for (const name of playerNames) {
    const ws = new FakeSocket();
    playerSockets[name] = ws;
    await manager.registerClient({
      ws: ws as unknown as WebSocket,
      gamePin,
      wantsHostRole: false,
      playerName: name,
    });
  }

  return { manager, storage, hostSocket, playerSockets, game };
}

test("streak: two consecutive correct answers apply a x1.1 multiplier on the second", async () => {
  const { manager } = await createStreakFixture("300001", [
    { question: "Q0", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
    { question: "Q1", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
  ]);

  await manager.startGame("300001", 1);
  const base = (manager as any).calculatePoints({ timeLimit: 0, points: "standard" }, 0);

  const first = await manager.submitAnswer({ gamePin: "300001", playerName: "Alice", questionIndex: 0, selectedAnswer: 0 });
  assert.deepEqual(first, { success: true, streak: 1 });

  await manager.advanceQuestion("300001", 1);

  const second = await manager.submitAnswer({ gamePin: "300001", playerName: "Alice", questionIndex: 1, selectedAnswer: 0 });
  assert.deepEqual(second, { success: true, streak: 2 });

  const room = (manager as any).rooms.get("300001");
  const response = Array.from(room.acceptedAnswers.values())[0] as any;
  assert.equal(response.pointsEarned, Math.round(base * 1.1));
});

test("streak: a wrong answer resets the streak (next correct answer scores at x1.0)", async () => {
  const { manager } = await createStreakFixture("300002", [
    { question: "Q0", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
    { question: "Q1", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
    { question: "Q2", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
  ]);

  await manager.startGame("300002", 1);
  const base = (manager as any).calculatePoints({ timeLimit: 0, points: "standard" }, 0);

  await manager.submitAnswer({ gamePin: "300002", playerName: "Alice", questionIndex: 0, selectedAnswer: 0 }); // correct, streak 1
  await manager.advanceQuestion("300002", 1);

  const wrong = await manager.submitAnswer({ gamePin: "300002", playerName: "Alice", questionIndex: 1, selectedAnswer: 1 }); // wrong
  assert.deepEqual(wrong, { success: true, streak: 0 });
  await manager.advanceQuestion("300002", 1);

  const third = await manager.submitAnswer({ gamePin: "300002", playerName: "Alice", questionIndex: 2, selectedAnswer: 0 }); // correct after miss
  assert.deepEqual(third, { success: true, streak: 1 });

  const room = (manager as any).rooms.get("300002");
  const response = Array.from(room.acceptedAnswers.values())[0] as any;
  assert.equal(response.pointsEarned, base); // x1.0, not x1.2
});

test("streak: missing a question resets the streak at close, even without submitting", async () => {
  const { manager } = await createStreakFixture("300003", [
    { question: "Q0", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
    { question: "Q1", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
    { question: "Q2", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
  ]);

  await manager.startGame("300003", 1);
  const base = (manager as any).calculatePoints({ timeLimit: 0, points: "standard" }, 0);

  await manager.submitAnswer({ gamePin: "300003", playerName: "Alice", questionIndex: 0, selectedAnswer: 0 }); // correct, streak 1
  await manager.advanceQuestion("300003", 1); // closes Q0; Q1 opens

  // Alice never answers Q1.
  await manager.advanceQuestion("300003", 1); // closes Q1 (no response) -> streak reset; Q2 opens

  const room = (manager as any).rooms.get("300003");
  assert.equal(room.streaks.get("alice"), 0);

  const third = await manager.submitAnswer({ gamePin: "300003", playerName: "Alice", questionIndex: 2, selectedAnswer: 0 });
  assert.deepEqual(third, { success: true, streak: 1 });

  const response = Array.from(room.acceptedAnswers.values())[0] as any;
  assert.equal(response.pointsEarned, base); // x1.0, streak restarted
});

test("streak: a poll answer earns zero points and leaves an existing streak intact through the next scored question", async () => {
  const { manager } = await createStreakFixture(
    "300004",
    [
      { question: "Q0 scored", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
      { question: "Q1 poll", type: "poll", answers: ["Red", "Blue"], correctAnswers: [], timeLimit: 0 },
      { question: "Q2 scored", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
    ],
    ["Alice", "Bob"],
  );

  await manager.startGame("300004", 1);
  const base = (manager as any).calculatePoints({ timeLimit: 0, points: "standard" }, 0);

  // Both players build a streak of 1 on Q0.
  await manager.submitAnswer({ gamePin: "300004", playerName: "Alice", questionIndex: 0, selectedAnswer: 0 });
  await manager.submitAnswer({ gamePin: "300004", playerName: "Bob", questionIndex: 0, selectedAnswer: 0 });
  await manager.advanceQuestion("300004", 1); // closes Q0 (scored); Q1 poll opens

  // Alice answers the poll; Bob does not answer it at all.
  // Poll is streak-neutral: Alice's current streak (1, built on Q0) is reported
  // back unchanged, not reset to 0.
  const pollAnswer = await manager.submitAnswer({ gamePin: "300004", playerName: "Alice", questionIndex: 1, selectedAnswer: 0 });
  assert.deepEqual(pollAnswer, { success: true, streak: 1 });

  const room = (manager as any).rooms.get("300004");
  const pollResponse = Array.from(room.acceptedAnswers.values())[0] as any;
  assert.equal(pollResponse.pointsEarned, 0);

  await manager.advanceQuestion("300004", 1); // closes Q1 poll (streak-neutral for everyone); Q2 opens

  assert.equal(room.streaks.get("alice"), 1, "poll must not reset a streak for a player who answered it");
  assert.equal(room.streaks.get("bob"), 1, "poll must not reset a streak for a player who skipped it");

  const scoredAlice = await manager.submitAnswer({ gamePin: "300004", playerName: "Alice", questionIndex: 2, selectedAnswer: 0 });
  assert.deepEqual(scoredAlice, { success: true, streak: 2 });

  const response = Array.from(room.acceptedAnswers.values()).find((r: any) => r.playerName === "Alice") as any;
  assert.equal(response.pointsEarned, Math.round(base * 1.1));
});

test("poll close broadcasts correctAnswer -1, empty correctAnswers, and a normal distribution", async () => {
  const { manager, hostSocket } = await createStreakFixture(
    "300005",
    [
      { question: "Q0 poll", type: "poll", answers: ["Red", "Blue", "Green"], correctAnswers: [], timeLimit: 0 },
      { question: "Q1 scored", answers: ["A", "B"], correctAnswer: 0, timeLimit: 0 },
    ],
    ["Alice", "Bob"],
  );

  const { wsServerMessageSchema } = await import("@shared/ws-protocol");

  await manager.startGame("300005", 1);

  await manager.submitAnswer({ gamePin: "300005", playerName: "Alice", questionIndex: 0, selectedAnswer: 0 }); // Red
  await manager.submitAnswer({ gamePin: "300005", playerName: "Bob", questionIndex: 0, selectedAnswer: 1 }); // Blue

  await manager.advanceQuestion("300005", 1);

  const pollClosed = hostSocket.sent.find((event: any) => event.type === "question_closed" && event.questionIndex === 0);
  assert.ok(pollClosed, "poll question_closed must have been broadcast");
  assert.equal(pollClosed.correctAnswer, -1);
  assert.deepEqual(pollClosed.correctAnswers, []);
  assert.deepEqual(pollClosed.distribution.answerCounts, [1, 1, 0]);
  assert.equal(pollClosed.distribution.totalResponses, 2);

  // Regression guard for the zod widening: the broadcast payload must still
  // validate against the shared WS protocol schema (correctAnswer: -1 for polls).
  assert.doesNotThrow(() => wsServerMessageSchema.parse(pollClosed));
});
