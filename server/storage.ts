import {
  users, quizzes, games, gameResponses, gamePlayers, tenants, bankQuestions,
  type User, type InsertUser,
  type Quiz, type InsertQuiz,
  type Game, type InsertGame,
  type GameResponse, type InsertGameResponse,
  type GamePlayer,
  type Tenant, type InsertTenant,
  type BankQuestion, type InsertBankQuestion
} from "@shared/schema";
import { db } from "./db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

// Safety cap on active participants per game. Configurable via env; the default
// leaves headroom over the 400-player target. This is a bound, not an exact
// gate — see joinGame's rank-based enforcement for the concurrency caveat.
export function maxPlayersPerGame(): number {
  const raw = parseInt(process.env.MAX_PLAYERS_PER_GAME || "500", 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 500;
}

// Postgres/driver error codes and pg-pool messages that signal transient
// contention rather than a real failure. A join that hits one of these is told
// GAME_BUSY (retryable 503) instead of surfacing as an HTTP 500.
const TRANSIENT_DB_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
  "57P03", // cannot_connect_now
  "08000", "08003", "08006", "08001", "08004", // connection exceptions
  "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", // node socket errors
]);

export function isTransientDbError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | undefined;
  if (e?.code && TRANSIENT_DB_CODES.has(e.code)) return true;
  // node-postgres' Pool throws a plain Error (no .code) when connectionTimeout
  // is exceeded while every connection is checked out — the pool-exhaustion
  // case we most need to map to GAME_BUSY. Supabase's pooler (Supavisor)
  // rejects clients beyond its pool_size with FATAL XX000 "max clients
  // reached" — XX000 is a generic internal error, so match the message, not
  // the code.
  return typeof e?.message === "string" &&
    /timeout exceeded when trying to connect|Connection terminated|max clients reached/i.test(e.message);
}

// ── Tenant context ───────────────────────────────────────────────
// Request paths carry the resolved tenant. The in-memory game engine
// (keyed by globally-unique game PIN) runs in system context.
export type StorageCtx = { tenantId: number } | { system: true };
export const SYSTEM_CTX: StorageCtx = { system: true };

// Result of a join attempt (see IStorage.joinGame). "full" and "busy" let the
// route return controlled GAME_FULL / GAME_BUSY responses instead of HTTP 500.
export type JoinGameResult =
  | { status: "ok"; game: Game; player: GamePlayer; playerCount: number }
  | { status: "not_found" }
  | { status: "not_waiting" }
  | { status: "duplicate" }
  | { status: "full" }
  | { status: "busy" };

// Aggregated analytics for a single quiz, computed over its COMPLETED games
// only. avgScore is the mean over ALL players of those games (weighted by
// per-game player count), not the mean of per-game averages. Question text
// only — never answer keys — so this is safe to return to a quiz owner
// before/without exposing correctAnswer(s).
export interface QuizInsights {
  gamesPlayed: number;            // completed games only
  totalPlayers: number;           // sum of game_players rows across those games
  avgScore: number;               // weighted mean of game_players.score across those games, 0 when no players
  lastPlayedAt: Date | null;      // latest completed game's createdAt
  questions: Array<{
    questionIndex: number;
    question: string;             // text from quizzes.questions (never answer keys)
    totalResponses: number;
    correctRate: number;          // 0..1, correct responses / total, 0 when none
    avgResponseMs: number;        // mean responseTime, 0 when none
  }>;
  recentGames: Array<{
    id: number;
    gamePin: string;
    createdAt: Date | null;
    playerCount: number;
    avgScore: number;
  }>;                             // newest first, cap 20
}

export function requireTenantId(ctx: StorageCtx): number {
  if ("system" in ctx) {
    throw new Error("Tenant context required");
  }
  return ctx.tenantId;
}

function requireSystem(ctx: StorageCtx): void {
  if (!("system" in ctx)) {
    throw new Error("System context required");
  }
}

function tenantFilter(ctx: StorageCtx, column: typeof users.tenantId | typeof quizzes.tenantId | typeof games.tenantId | typeof gameResponses.tenantId | typeof gamePlayers.tenantId | typeof bankQuestions.tenantId): SQL | undefined {
  return "system" in ctx ? undefined : eq(column, ctx.tenantId);
}

// Bank question list/search filters (mirrors getUserQuizzes' archived-only
// semantics for the `archived` flag rather than an "includeArchived" toggle).
export interface BankQuestionFilters {
  search?: string;      // case-insensitive substring on question text
  subject?: string;     // exact match (values come from getBankSubjectsAndTags)
  tags?: string[];      // row must contain ALL of these (exact strings)
  archived?: boolean;   // true → archived-only; false/undefined → live-only
}

export interface IStorage {
  // Users
  getUser(ctx: StorageCtx, id: number): Promise<User | undefined>;
  getUserByUsername(ctx: StorageCtx, username: string): Promise<User | undefined>;
  createUser(ctx: StorageCtx, user: InsertUser): Promise<User>;

  // Quizzes
  getQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined>;
  getQuizzes(ctx: StorageCtx): Promise<Quiz[]>;
  getPublicQuizzes(ctx: StorageCtx): Promise<Quiz[]>;
  getUserQuizzes(ctx: StorageCtx, userId: number, opts?: { archived?: boolean }): Promise<Quiz[]>;
  createQuiz(ctx: StorageCtx, quiz: InsertQuiz): Promise<Quiz>;
  updateQuiz(ctx: StorageCtx, id: number, quiz: Partial<InsertQuiz>): Promise<Quiz>;
  deleteQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined>;
  restoreQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined>;
  // Aggregated analytics over this quiz's completed games. undefined when the
  // quiz is not visible in ctx (same tenant-visibility rule as getQuiz).
  getQuizInsights(ctx: StorageCtx, quizId: number): Promise<QuizInsights | undefined>;

  // Bank questions (reusable question library, separate from any one quiz)
  getBankQuestions(ctx: StorageCtx, filters?: BankQuestionFilters): Promise<BankQuestion[]>;    // newest-updated first
  getBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined>;
  createBankQuestion(ctx: StorageCtx, data: InsertBankQuestion & { createdBy: number }): Promise<BankQuestion>;
  updateBankQuestion(ctx: StorageCtx, id: number, updates: Partial<InsertBankQuestion>): Promise<BankQuestion | undefined>;
  archiveBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined>;
  restoreBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined>;
  getBankSubjectsAndTags(ctx: StorageCtx): Promise<{ subjects: string[]; tags: string[] }>;     // distinct, live rows only

  // Games
  getGame(ctx: StorageCtx, id: number): Promise<Game | undefined>;
  getGameByPin(ctx: StorageCtx, pin: string): Promise<Game | undefined>;
  createGame(ctx: StorageCtx, game: InsertGame): Promise<Game>;
  updateGame(ctx: StorageCtx, id: number, game: Partial<Game>): Promise<Game | undefined>;
  deleteGame(ctx: StorageCtx, id: number): Promise<boolean>;
  // Add a player to a waiting game via an independent INSERT into game_players
  // (no games-row lock). Duplicate names are rejected by a case-insensitive DB
  // unique index; the configured player cap yields status "full"; transient DB
  // contention yields status "busy".
  joinGame(ctx: StorageCtx, pin: string, playerName: string): Promise<JoinGameResult>;
  // True iff a waiting/active game (tenant-scoped) references this quiz. Used
  // to let players fetch a private/archived quiz's sanitized data while a
  // live game on it is in progress.
  quizHasLiveGame(ctx: StorageCtx, quizId: number): Promise<boolean>;

  // Game Players (authoritative roster — replaces the legacy games.players JSON)
  getGamePlayers(ctx: StorageCtx, gameId: number): Promise<GamePlayer[]>;
  countGamePlayers(ctx: StorageCtx, gameId: number): Promise<number>;
  // Persist final scores at game completion (one bulk statement, not N updates).
  setGamePlayerScores(ctx: StorageCtx, gameId: number, scores: Array<{ name: string; score: number }>): Promise<void>;

  // Game Responses
  getGameResponses(ctx: StorageCtx, gameId: number): Promise<GameResponse[]>;
  createGameResponse(ctx: StorageCtx, response: InsertGameResponse): Promise<GameResponse>;
  // Persist many responses in a single round-trip (one multi-row INSERT). Used
  // by closeQuestion() to avoid a per-answer insert loop that scales linearly
  // with lobby size (~400 players → 400 sequential inserts per question).
  createGameResponses(ctx: StorageCtx, responses: InsertGameResponse[]): Promise<GameResponse[]>;
  updateGameResponse(ctx: StorageCtx, id: number, updates: Partial<GameResponse>): Promise<GameResponse | undefined>;
  getPlayerResponses(ctx: StorageCtx, gameId: number, playerName: string): Promise<GameResponse[]>;

  // Latest Game Results
  getLatestCompletedGame(ctx: StorageCtx): Promise<{ game: Game; players: any[]; totalQuestions: number } | undefined>;

  // Tenants (system context only — used by the super-admin API)
  getTenants(ctx: StorageCtx): Promise<Tenant[]>;
  getTenant(ctx: StorageCtx, id: number): Promise<Tenant | undefined>;
  createTenant(ctx: StorageCtx, tenant: InsertTenant): Promise<Tenant>;
  updateTenant(ctx: StorageCtx, id: number, updates: Partial<InsertTenant>): Promise<Tenant | undefined>;
}

// Every DB call runs in a transaction that sets the RLS GUC:
//   app.tenant_id for request paths, app.role='system' for the game engine.
// Inert until migration 0003 forces RLS; load-bearing after.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function withCtx<T>(ctx: StorageCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if ("system" in ctx) {
      await tx.execute(sql`select set_config('app.role', 'system', true)`);
    } else {
      await tx.execute(sql`select set_config('app.tenant_id', ${String(ctx.tenantId)}, true)`);
    }
    return fn(tx);
  });
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(ctx: StorageCtx, id: number): Promise<User | undefined> {
    return withCtx(ctx, async (tx) => {
      const [user] = await tx.select().from(users)
        .where(and(eq(users.id, id), tenantFilter(ctx, users.tenantId)));
      return user || undefined;
    });
  }

  async getUserByUsername(ctx: StorageCtx, username: string): Promise<User | undefined> {
    return withCtx(ctx, async (tx) => {
      const [user] = await tx.select().from(users)
        .where(and(eq(users.username, username), tenantFilter(ctx, users.tenantId)));
      return user || undefined;
    });
  }

  async createUser(ctx: StorageCtx, insertUser: InsertUser): Promise<User> {
    const tenantId = requireTenantId(ctx);
    return withCtx(ctx, async (tx) => {
      const [user] = await tx.insert(users).values({ ...insertUser, tenantId }).returning();
      return user;
    });
  }

  // Quizzes
  async getQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined> {
    return withCtx(ctx, async (tx) => {
      const [quiz] = await tx.select().from(quizzes)
        .where(and(eq(quizzes.id, id), tenantFilter(ctx, quizzes.tenantId)));
      return quiz || undefined;
    });
  }

  async getQuizzes(ctx: StorageCtx): Promise<Quiz[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(quizzes)
        .where(and(isNull(quizzes.deletedAt), tenantFilter(ctx, quizzes.tenantId)));
    });
  }

  async getPublicQuizzes(ctx: StorageCtx): Promise<Quiz[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(quizzes)
        .where(and(eq(quizzes.isPublic, true), isNull(quizzes.deletedAt), tenantFilter(ctx, quizzes.tenantId)));
    });
  }

  async getUserQuizzes(ctx: StorageCtx, userId: number, opts?: { archived?: boolean }): Promise<Quiz[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(quizzes)
        .where(and(
          eq(quizzes.createdBy, userId),
          opts?.archived ? isNotNull(quizzes.deletedAt) : isNull(quizzes.deletedAt),
          tenantFilter(ctx, quizzes.tenantId),
        ));
    });
  }

  async createQuiz(ctx: StorageCtx, insertQuiz: InsertQuiz): Promise<Quiz> {
    const tenantId = requireTenantId(ctx);
    return withCtx(ctx, async (tx) => {
      const [quiz] = await tx.insert(quizzes).values({ ...insertQuiz, tenantId }).returning();
      return quiz;
    });
  }

  async updateQuiz(ctx: StorageCtx, id: number, updates: Partial<InsertQuiz>): Promise<Quiz> {
    return withCtx(ctx, async (tx) => {
      const [quiz] = await tx.update(quizzes).set(updates)
        .where(and(eq(quizzes.id, id), tenantFilter(ctx, quizzes.tenantId)))
        .returning();
      return quiz;
    });
  }

  async deleteQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined> {
    return withCtx(ctx, async (tx) => {
      const [row] = await tx.update(quizzes).set({ deletedAt: sql`now()` })
        .where(and(eq(quizzes.id, id), tenantFilter(ctx, quizzes.tenantId)))
        .returning();
      return row;
    });
  }

  async restoreQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined> {
    return withCtx(ctx, async (tx) => {
      const [row] = await tx.update(quizzes).set({ deletedAt: null })
        .where(and(eq(quizzes.id, id), tenantFilter(ctx, quizzes.tenantId)))
        .returning();
      return row;
    });
  }

  // Bank questions
  async getBankQuestions(ctx: StorageCtx, filters?: BankQuestionFilters): Promise<BankQuestion[]> {
    return withCtx(ctx, async (tx) => {
      const conds: (SQL | undefined)[] = [
        tenantFilter(ctx, bankQuestions.tenantId),
        filters?.archived ? isNotNull(bankQuestions.deletedAt) : isNull(bankQuestions.deletedAt),
      ];
      if (filters?.subject) conds.push(eq(bankQuestions.subject, filters.subject));
      if (filters?.tags?.length) {
        // Row must contain ALL requested tags (jsonb containment; GIN-indexed).
        conds.push(sql`${bankQuestions.tags} @> ${JSON.stringify(filters.tags)}::jsonb`);
      }
      const search = filters?.search?.trim();
      if (search) {
        conds.push(sql`${bankQuestions.question}->>'question' ilike ${"%" + search + "%"}`);
      }
      return tx.select().from(bankQuestions)
        .where(and(...conds))
        .orderBy(desc(bankQuestions.updatedAt), desc(bankQuestions.id));
    });
  }

  async getBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
    return withCtx(ctx, async (tx) => {
      const [row] = await tx.select().from(bankQuestions)
        .where(and(eq(bankQuestions.id, id), tenantFilter(ctx, bankQuestions.tenantId)));
      return row || undefined;
    });
  }

  async createBankQuestion(ctx: StorageCtx, data: InsertBankQuestion & { createdBy: number }): Promise<BankQuestion> {
    const tenantId = requireTenantId(ctx);
    return withCtx(ctx, async (tx) => {
      const [row] = await tx.insert(bankQuestions).values({
        tenantId,
        createdBy: data.createdBy,
        question: data.question,
        subject: data.subject ?? null,
        tags: data.tags ?? [],
      }).returning();
      return row;
    });
  }

  async updateBankQuestion(ctx: StorageCtx, id: number, updates: Partial<InsertBankQuestion>): Promise<BankQuestion | undefined> {
    return withCtx(ctx, async (tx) => {
      const [row] = await tx.update(bankQuestions).set({
        ...(updates.question !== undefined ? { question: updates.question } : {}),
        ...(updates.subject !== undefined ? { subject: updates.subject ?? null } : {}),
        ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
        updatedAt: sql`now()`,
      })
        .where(and(eq(bankQuestions.id, id), tenantFilter(ctx, bankQuestions.tenantId)))
        .returning();
      return row || undefined;
    });
  }

  async archiveBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
    return withCtx(ctx, async (tx) => {
      const [row] = await tx.update(bankQuestions).set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(bankQuestions.id, id), tenantFilter(ctx, bankQuestions.tenantId)))
        .returning();
      return row || undefined;
    });
  }

  async restoreBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
    return withCtx(ctx, async (tx) => {
      const [row] = await tx.update(bankQuestions).set({ deletedAt: null, updatedAt: sql`now()` })
        .where(and(eq(bankQuestions.id, id), tenantFilter(ctx, bankQuestions.tenantId)))
        .returning();
      return row || undefined;
    });
  }

  async getBankSubjectsAndTags(ctx: StorageCtx): Promise<{ subjects: string[]; tags: string[] }> {
    return withCtx(ctx, async (tx) => {
      // One narrow scan of live rows; dedupe in JS so semantics are identical
      // to MemStorage. Bank sizes are small; revisit if that changes.
      const rows = await tx.select({ subject: bankQuestions.subject, tags: bankQuestions.tags })
        .from(bankQuestions)
        .where(and(isNull(bankQuestions.deletedAt), tenantFilter(ctx, bankQuestions.tenantId)));
      const subjects = new Set<string>();
      const tags = new Set<string>();
      for (const row of rows) {
        if (row.subject) subjects.add(row.subject);
        for (const t of (row.tags as string[]) ?? []) tags.add(t);
      }
      return { subjects: Array.from(subjects), tags: Array.from(tags) };
    });
  }

  async getQuizInsights(ctx: StorageCtx, quizId: number): Promise<QuizInsights | undefined> {
    return withCtx(ctx, async (tx) => {
      // Same tenant-visibility rule as getQuiz.
      const [quiz] = await tx.select().from(quizzes)
        .where(and(eq(quizzes.id, quizId), tenantFilter(ctx, quizzes.tenantId)));
      if (!quiz) return undefined;

      // Per-game aggregates over completed games only, newest first. avgScore
      // here is per-game (used by recentGames); the headline avgScore below is
      // the weighted mean over ALL players, not the mean of these per-game
      // averages.
      const gameRows = await tx
        .select({
          id: games.id,
          gamePin: games.gamePin,
          createdAt: games.createdAt,
          playerCount: sql<number>`count(${gamePlayers.id})::int`,
          avgScore: sql<number>`coalesce(avg(${gamePlayers.score}), 0)::float`,
        })
        .from(games)
        .leftJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
        .where(and(
          eq(games.quizId, quizId),
          eq(games.status, "completed"),
          tenantFilter(ctx, games.tenantId),
        ))
        .groupBy(games.id)
        .orderBy(desc(games.createdAt), desc(games.id));

      const gamesPlayed = gameRows.length;
      const totalPlayers = gameRows.reduce((sum, r) => sum + r.playerCount, 0);
      const totalScoreSum = gameRows.reduce((sum, r) => sum + r.avgScore * r.playerCount, 0);
      const avgScore = totalPlayers > 0 ? totalScoreSum / totalPlayers : 0;
      const lastPlayedAt = gamesPlayed > 0 ? gameRows[0].createdAt : null;

      const gameIds = gameRows.map((r) => r.id);
      const questionAggRows = gameIds.length > 0
        ? await tx
            .select({
              questionIndex: gameResponses.questionIndex,
              total: sql<number>`count(*)::int`,
              correctRate: sql<number>`avg(case when ${gameResponses.isCorrect} then 1.0 else 0.0 end)::float`,
              avgMs: sql<number>`coalesce(avg(${gameResponses.responseTime}), 0)::float`,
            })
            .from(gameResponses)
            .where(and(
              inArray(gameResponses.gameId, gameIds),
              tenantFilter(ctx, gameResponses.tenantId),
            ))
            .groupBy(gameResponses.questionIndex)
        : [];

      // Question TEXT only — never answer keys.
      const rawQuestions = (quiz.questions as any[]) || [];
      const questions = rawQuestions.map((q, questionIndex) => {
        const row = questionAggRows.find((r) => r.questionIndex === questionIndex);
        return {
          questionIndex,
          question: q.question,
          totalResponses: row?.total ?? 0,
          correctRate: row?.correctRate ?? 0,
          avgResponseMs: row?.avgMs ?? 0,
        };
      });

      const recentGames = gameRows.slice(0, 20).map((r) => ({
        id: r.id,
        gamePin: r.gamePin,
        createdAt: r.createdAt,
        playerCount: r.playerCount,
        avgScore: r.avgScore,
      }));

      return { gamesPlayed, totalPlayers, avgScore, lastPlayedAt, questions, recentGames };
    });
  }

  // Games
  async getGame(ctx: StorageCtx, id: number): Promise<Game | undefined> {
    return withCtx(ctx, async (tx) => {
      const [game] = await tx.select().from(games)
        .where(and(eq(games.id, id), tenantFilter(ctx, games.tenantId)));
      return game || undefined;
    });
  }

  async getGameByPin(ctx: StorageCtx, pin: string): Promise<Game | undefined> {
    return withCtx(ctx, async (tx) => {
      const [game] = await tx.select().from(games)
        .where(and(eq(games.gamePin, pin), tenantFilter(ctx, games.tenantId)));
      return game || undefined;
    });
  }

  async createGame(ctx: StorageCtx, insertGame: InsertGame): Promise<Game> {
    const tenantId = requireTenantId(ctx);
    return withCtx(ctx, async (tx) => {
      const [game] = await tx.insert(games).values({ ...insertGame, tenantId }).returning();
      return game;
    });
  }

  async updateGame(ctx: StorageCtx, id: number, updates: Partial<Game>): Promise<Game | undefined> {
    return withCtx(ctx, async (tx) => {
      const [game] = await tx.update(games).set(updates)
        .where(and(eq(games.id, id), tenantFilter(ctx, games.tenantId)))
        .returning();
      return game || undefined;
    });
  }

  async deleteGame(ctx: StorageCtx, id: number): Promise<boolean> {
    return withCtx(ctx, async (tx) => {
      const result = await tx.delete(games)
        .where(and(eq(games.id, id), tenantFilter(ctx, games.tenantId)));
      return (result.rowCount || 0) > 0;
    });
  }

  async joinGame(ctx: StorageCtx, pin: string, playerName: string): Promise<JoinGameResult> {
    const cap = maxPlayersPerGame();
    try {
      return await withCtx(ctx, async (tx) => {
        // Read the game WITHOUT locking it — independent joins no longer contend
        // on the games row. This is a plain lookup for existence/status only.
        const [game] = await tx.select().from(games)
          .where(and(eq(games.gamePin, pin), tenantFilter(ctx, games.tenantId)));

        if (!game) return { status: "not_found" };
        if (game.status !== "waiting") return { status: "not_waiting" };

        // Independent insert. ON CONFLICT DO NOTHING against the case-insensitive
        // unique index (game_id, lower(name)) rejects duplicates at the DB with
        // no row lock — an empty returning() means the name was already taken.
        const insertedRows = await tx
          .insert(gamePlayers)
          .values({ tenantId: game.tenantId, gameId: game.id, name: playerName, score: 0 })
          .onConflictDoNothing()
          .returning();
        if (insertedRows.length === 0) return { status: "duplicate" };
        const player = insertedRows[0];

        // Enforce the cap by INSERTION RANK: count this game's rows with id <=
        // mine. Ids are monotonic, so the first `cap` joiners (lowest ids) keep
        // their seats and anyone past the cap deletes their own row and is told
        // GAME_FULL. Deterministic — no lost survivors. Under extreme concurrency
        // the count only sees committed peers (READ COMMITTED), so the cap can be
        // exceeded by at most the number of in-flight joins at the exact boundary;
        // it is a safety bound, not an exact gate.
        const [{ rank }] = await tx
          .select({ rank: sql<number>`count(*)::int` })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, game.id), sql`${gamePlayers.id} <= ${player.id}`));

        if (rank > cap) {
          await tx.delete(gamePlayers).where(eq(gamePlayers.id, player.id));
          return { status: "full" };
        }

        return { status: "ok", game, player, playerCount: rank };
      });
    } catch (error) {
      if (isTransientDbError(error)) return { status: "busy" };
      throw error;
    }
  }

  async quizHasLiveGame(ctx: StorageCtx, quizId: number): Promise<boolean> {
    return withCtx(ctx, async (tx) => {
      const rows = await tx.select({ one: sql`1` }).from(games)
        .where(and(
          eq(games.quizId, quizId),
          inArray(games.status, ["waiting", "active"]),
          tenantFilter(ctx, games.tenantId),
        ))
        .limit(1);
      return rows.length > 0;
    });
  }

  async getGamePlayers(ctx: StorageCtx, gameId: number): Promise<GamePlayer[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, gameId), tenantFilter(ctx, gamePlayers.tenantId)))
        .orderBy(asc(gamePlayers.id));
    });
  }

  async countGamePlayers(ctx: StorageCtx, gameId: number): Promise<number> {
    return withCtx(ctx, async (tx) => {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, gameId), tenantFilter(ctx, gamePlayers.tenantId)));
      return n ?? 0;
    });
  }

  async setGamePlayerScores(ctx: StorageCtx, gameId: number, scores: Array<{ name: string; score: number }>): Promise<void> {
    if (scores.length === 0) return;
    await withCtx(ctx, async (tx) => {
      // One bulk UPDATE joining against an inline VALUES list keyed by
      // lower(name) — a single statement instead of one round-trip per player
      // at completion. Each value is a scalar bind with an explicit cast; do
      // NOT pass a JS array to unnest(...) — drizzle expands an embedded array
      // into a (row) list, not an array parameter.
      const rows = scores.map(
        (s) => sql`(${s.name}::text, ${Math.trunc(s.score)}::int)`,
      );
      await tx.execute(sql`
        update ${gamePlayers} as gp
        set score = v.score
        from (values ${sql.join(rows, sql`, `)}) as v(name, score)
        where gp.game_id = ${gameId}
          and lower(gp.name) = lower(v.name)
          ${"system" in ctx ? sql`` : sql`and gp.tenant_id = ${ctx.tenantId}`}
      `);
    });
  }

  // Game Responses
  async getGameResponses(ctx: StorageCtx, gameId: number): Promise<GameResponse[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(gameResponses)
        .where(and(eq(gameResponses.gameId, gameId), tenantFilter(ctx, gameResponses.tenantId)));
    });
  }

  async createGameResponse(ctx: StorageCtx, insertResponse: InsertGameResponse): Promise<GameResponse> {
    return withCtx(ctx, async (tx) => {
      const [response] = await tx.insert(gameResponses).values(insertResponse).returning();
      return response;
    });
  }

  async createGameResponses(ctx: StorageCtx, responses: InsertGameResponse[]): Promise<GameResponse[]> {
    if (responses.length === 0) return [];
    return withCtx(ctx, async (tx) => {
      return tx.insert(gameResponses).values(responses).returning();
    });
  }

  async updateGameResponse(ctx: StorageCtx, id: number, updates: Partial<GameResponse>): Promise<GameResponse | undefined> {
    return withCtx(ctx, async (tx) => {
      const [response] = await tx.update(gameResponses).set(updates)
        .where(and(eq(gameResponses.id, id), tenantFilter(ctx, gameResponses.tenantId)))
        .returning();
      return response || undefined;
    });
  }

  async getPlayerResponses(ctx: StorageCtx, gameId: number, playerName: string): Promise<GameResponse[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(gameResponses).where(and(
        eq(gameResponses.gameId, gameId),
        eq(gameResponses.playerName, playerName),
        tenantFilter(ctx, gameResponses.tenantId),
      ));
    });
  }

  async getLatestCompletedGame(ctx: StorageCtx): Promise<{ game: Game; players: any[]; totalQuestions: number } | undefined> {
    return withCtx(ctx, async (tx) => {
      const [latestGame] = await tx.select().from(games)
        .where(and(eq(games.status, "completed"), tenantFilter(ctx, games.tenantId)))
        .orderBy(desc(games.id))
        .limit(1);

      if (!latestGame) return undefined;

      const [quiz] = await tx.select().from(quizzes)
        .where(and(eq(quizzes.id, latestGame.quizId), tenantFilter(ctx, quizzes.tenantId)));
      if (!quiz) return undefined;

      // Roster comes from game_players (authoritative), not the legacy JSON.
      const roster = await tx.select().from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, latestGame.id), tenantFilter(ctx, gamePlayers.tenantId)));
      const players = roster.map((p) => ({ name: p.name, score: p.score }));
      const totalQuestions = (quiz.questions as any[])?.length || 0;

      return {
        game: latestGame,
        players: players.sort((a, b) => (b.score || 0) - (a.score || 0)),
        totalQuestions,
      };
    });
  }

  // Tenants
  async getTenants(ctx: StorageCtx): Promise<Tenant[]> {
    requireSystem(ctx);
    return withCtx(ctx, async (tx) => tx.select().from(tenants));
  }

  async getTenant(ctx: StorageCtx, id: number): Promise<Tenant | undefined> {
    requireSystem(ctx);
    return withCtx(ctx, async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, id));
      return tenant || undefined;
    });
  }

  async createTenant(ctx: StorageCtx, insertTenant: InsertTenant): Promise<Tenant> {
    requireSystem(ctx);
    return withCtx(ctx, async (tx) => {
      const [tenant] = await tx.insert(tenants).values(insertTenant).returning();
      return tenant;
    });
  }

  async updateTenant(ctx: StorageCtx, id: number, updates: Partial<InsertTenant>): Promise<Tenant | undefined> {
    requireSystem(ctx);
    return withCtx(ctx, async (tx) => {
      const [existing] = await tx.select().from(tenants).where(eq(tenants.id, id));
      if (!existing) return undefined;
      const merged = {
        ...updates,
        ...(updates.branding !== undefined
          ? { branding: { ...(existing.branding as object), ...updates.branding } }
          : {}),
        ...(updates.features !== undefined
          ? { features: { ...(existing.features as object), ...updates.features } }
          : {}),
      };
      const [tenant] = await tx.update(tenants).set(merged).where(eq(tenants.id, id)).returning();
      return tenant || undefined;
    });
  }

  // Helper method to generate unique game PIN
  generateGamePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private quizzes: Map<number, Quiz>;
  private games: Map<number, Game>;
  private gameResponses: Map<number, GameResponse>;
  private gamePlayers: Map<number, GamePlayer>;
  private tenants: Map<number, Tenant> = new Map();
  private bankQuestions: Map<number, BankQuestion>;
  private currentUserId: number;
  private currentQuizId: number;
  private currentGameId: number;
  private currentResponseId: number;
  private currentGamePlayerId: number;
  private currentTenantId = 1;
  private currentBankQuestionId: number;

  constructor() {
    this.users = new Map();
    this.quizzes = new Map();
    this.games = new Map();
    this.gameResponses = new Map();
    this.gamePlayers = new Map();
    this.bankQuestions = new Map();
    this.currentUserId = 1;
    this.currentQuizId = 1;
    this.currentGameId = 1;
    this.currentResponseId = 1;
    this.currentGamePlayerId = 1;
    this.currentBankQuestionId = 1;

    // Add some sample quizzes
    this.initializeSampleData();
  }

  private initializeSampleData() {
    // Sample user
    const sampleUser: User = {
      id: 1,
      tenantId: 1,
      isSuperAdmin: false,
      username: "demo_user",
      password: ""
    };
    this.users.set(1, sampleUser);
    this.currentUserId = 2;

    // Sample quizzes
    const sampleQuizzes: Quiz[] = [
      {
        id: 1,
        tenantId: 1,
        title: "World Geography Challenge",
        description: "Test your knowledge of countries, capitals, and landmarks around the globe.",
        createdBy: 1,
        background: "classroom",
        theme: null,
        questions: [
          {
            question: "What is the capital of France?",
            answers: ["Paris", "London", "Madrid", "Berlin"],
            correctAnswer: 0,
            timeLimit: 30
          },
          {
            question: "Which planet is known as the Red Planet?",
            answers: ["Venus", "Mars", "Jupiter", "Earth"],
            correctAnswer: 1,
            timeLimit: 30
          },
          {
            question: "What is the largest ocean on Earth?",
            answers: ["Atlantic", "Indian", "Arctic", "Pacific"],
            correctAnswer: 3,
            timeLimit: 30
          }
        ],
        isPublic: true,
        deletedAt: null,
        createdAt: new Date()
      },
      {
        id: 2,
        tenantId: 1,
        title: "Science Trivia",
        description: "Explore fascinating facts about biology, chemistry, and physics.",
        createdBy: 1,
        background: "classroom",
        theme: null,
        questions: [
          {
            question: "What is the chemical symbol for gold?",
            answers: ["Go", "Gd", "Au", "Ag"],
            correctAnswer: 2,
            timeLimit: 30
          },
          {
            question: "How many chambers does a human heart have?",
            answers: ["2", "3", "4", "5"],
            correctAnswer: 2,
            timeLimit: 30
          }
        ],
        isPublic: true,
        deletedAt: null,
        createdAt: new Date()
      },
      {
        id: 3,
        tenantId: 1,
        title: "Math Masters",
        description: "Challenge yourself with algebra, geometry, and calculus problems.",
        createdBy: 1,
        background: "classroom",
        theme: null,
        questions: [
          {
            question: "What is 15% of 200?",
            answers: ["25", "30", "35", "40"],
            correctAnswer: 1,
            timeLimit: 30
          }
        ],
        isPublic: true,
        deletedAt: null,
        createdAt: new Date()
      }
    ];

    sampleQuizzes.forEach(quiz => {
      this.quizzes.set(quiz.id, quiz);
    });
    this.currentQuizId = 4;
  }

  private inTenant(ctx: StorageCtx, row: { tenantId: number }): boolean {
    return "system" in ctx || row.tenantId === ctx.tenantId;
  }

  // Users
  async getUser(ctx: StorageCtx, id: number): Promise<User | undefined> {
    const user = this.users.get(id);
    return user && this.inTenant(ctx, user) ? user : undefined;
  }

  async getUserByUsername(ctx: StorageCtx, username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username && this.inTenant(ctx, user),
    );
  }

  async createUser(ctx: StorageCtx, insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id, tenantId: requireTenantId(ctx), isSuperAdmin: false };
    this.users.set(id, user);
    return user;
  }

  // Quizzes
  async getQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined> {
    const quiz = this.quizzes.get(id);
    return quiz && this.inTenant(ctx, quiz) ? quiz : undefined;
  }

  async getQuizzes(ctx: StorageCtx): Promise<Quiz[]> {
    return Array.from(this.quizzes.values()).filter((q) => !q.deletedAt && this.inTenant(ctx, q));
  }

  async getPublicQuizzes(ctx: StorageCtx): Promise<Quiz[]> {
    return Array.from(this.quizzes.values()).filter(
      (quiz) => quiz.isPublic && !quiz.deletedAt && this.inTenant(ctx, quiz),
    );
  }

  async getUserQuizzes(ctx: StorageCtx, userId: number, opts?: { archived?: boolean }): Promise<Quiz[]> {
    return Array.from(this.quizzes.values()).filter(
      (quiz) =>
        quiz.createdBy === userId &&
        this.inTenant(ctx, quiz) &&
        (opts?.archived ? !!quiz.deletedAt : !quiz.deletedAt),
    );
  }

  async createQuiz(ctx: StorageCtx, quiz: InsertQuiz): Promise<Quiz> {
    const id = this.currentQuizId++;
    const newQuiz: Quiz = {
      id,
      tenantId: requireTenantId(ctx),
      title: quiz.title,
      description: quiz.description || null,
      questions: quiz.questions,
      background: quiz.background || "classroom",
      theme: quiz.theme ?? null,
      isPublic: quiz.isPublic ?? true,
      createdBy: quiz.createdBy,
      deletedAt: null,
      createdAt: new Date()
    };
    this.quizzes.set(id, newQuiz);
    return newQuiz;
  }

  async updateQuiz(ctx: StorageCtx, id: number, updates: Partial<InsertQuiz>): Promise<Quiz> {
    const existing = this.quizzes.get(id);
    if (!existing || !this.inTenant(ctx, existing)) {
      throw new Error("Quiz not found");
    }

    const updated: Quiz = {
      ...existing,
      ...updates,
      id: existing.id,
      tenantId: existing.tenantId,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt
    };

    this.quizzes.set(id, updated);
    return updated;
  }

  async deleteQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined> {
    const existing = this.quizzes.get(id);
    if (!existing || !this.inTenant(ctx, existing)) return undefined;
    const updated: Quiz = { ...existing, deletedAt: new Date() };
    this.quizzes.set(id, updated);
    return updated;
  }

  async restoreQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined> {
    const existing = this.quizzes.get(id);
    if (!existing || !this.inTenant(ctx, existing)) return undefined;
    const updated: Quiz = { ...existing, deletedAt: null };
    this.quizzes.set(id, updated);
    return updated;
  }

  // Bank questions
  async getBankQuestions(ctx: StorageCtx, filters?: BankQuestionFilters): Promise<BankQuestion[]> {
    const search = filters?.search?.trim().toLowerCase();
    return Array.from(this.bankQuestions.values())
      .filter((row) => this.inTenant(ctx, row))
      .filter((row) => (filters?.archived ? !!row.deletedAt : !row.deletedAt))
      .filter((row) => !filters?.subject || row.subject === filters.subject)
      .filter((row) => !filters?.tags?.length || filters.tags.every((t) => (row.tags as string[]).includes(t)))
      .filter((row) => !search || String((row.question as any)?.question ?? "").toLowerCase().includes(search))
      .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0) || b.id - a.id);
  }

  async getBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
    const row = this.bankQuestions.get(id);
    return row && this.inTenant(ctx, row) ? row : undefined;
  }

  async createBankQuestion(ctx: StorageCtx, data: InsertBankQuestion & { createdBy: number }): Promise<BankQuestion> {
    const id = this.currentBankQuestionId++;
    const now = new Date();
    const row: BankQuestion = {
      id,
      tenantId: requireTenantId(ctx),
      createdBy: data.createdBy,
      question: data.question,
      subject: data.subject ?? null,
      tags: data.tags ?? [],
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.bankQuestions.set(id, row);
    return row;
  }

  async updateBankQuestion(ctx: StorageCtx, id: number, updates: Partial<InsertBankQuestion>): Promise<BankQuestion | undefined> {
    const existing = this.bankQuestions.get(id);
    if (!existing || !this.inTenant(ctx, existing)) return undefined;
    const updated: BankQuestion = {
      ...existing,
      ...(updates.question !== undefined ? { question: updates.question } : {}),
      ...(updates.subject !== undefined ? { subject: updates.subject ?? null } : {}),
      ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
      updatedAt: new Date(),
    };
    this.bankQuestions.set(id, updated);
    return updated;
  }

  async archiveBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
    const existing = this.bankQuestions.get(id);
    if (!existing || !this.inTenant(ctx, existing)) return undefined;
    const updated: BankQuestion = { ...existing, deletedAt: new Date(), updatedAt: new Date() };
    this.bankQuestions.set(id, updated);
    return updated;
  }

  async restoreBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
    const existing = this.bankQuestions.get(id);
    if (!existing || !this.inTenant(ctx, existing)) return undefined;
    const updated: BankQuestion = { ...existing, deletedAt: null, updatedAt: new Date() };
    this.bankQuestions.set(id, updated);
    return updated;
  }

  async getBankSubjectsAndTags(ctx: StorageCtx): Promise<{ subjects: string[]; tags: string[] }> {
    const live = await this.getBankQuestions(ctx);
    const subjects = new Set<string>();
    const tags = new Set<string>();
    for (const row of live) {
      if (row.subject) subjects.add(row.subject);
      for (const t of (row.tags as string[]) ?? []) tags.add(t);
    }
    return { subjects: Array.from(subjects), tags: Array.from(tags) };
  }

  async getQuizInsights(ctx: StorageCtx, quizId: number): Promise<QuizInsights | undefined> {
    // Same tenant-visibility rule as getQuiz.
    const quiz = await this.getQuiz(ctx, quizId);
    if (!quiz) return undefined;

    const completedGames = Array.from(this.games.values())
      .filter((g) => g.quizId === quizId && g.status === "completed" && this.inTenant(ctx, g))
      .sort((a, b) => {
        const at = a.createdAt?.getTime() ?? 0;
        const bt = b.createdAt?.getTime() ?? 0;
        return bt !== at ? bt - at : b.id - a.id;
      });

    const gameIds = new Set(completedGames.map((g) => g.id));
    const players = Array.from(this.gamePlayers.values())
      .filter((p) => gameIds.has(p.gameId) && this.inTenant(ctx, p));

    const gamesPlayed = completedGames.length;
    const totalPlayers = players.length;
    // Weighted mean over ALL players of these games, not mean-of-game-means.
    const avgScore = totalPlayers > 0
      ? players.reduce((sum, p) => sum + (p.score ?? 0), 0) / totalPlayers
      : 0;
    const lastPlayedAt = gamesPlayed > 0 ? (completedGames[0].createdAt ?? null) : null;

    const responses = Array.from(this.gameResponses.values())
      .filter((r) => gameIds.has(r.gameId) && this.inTenant(ctx, r));

    // Question TEXT only — never answer keys.
    const rawQuestions = (quiz.questions as any[]) || [];
    const questions = rawQuestions.map((q, questionIndex) => {
      const matching = responses.filter((r) => r.questionIndex === questionIndex);
      const totalResponses = matching.length;
      const correctRate = totalResponses > 0
        ? matching.filter((r) => r.isCorrect).length / totalResponses
        : 0;
      const avgResponseMs = totalResponses > 0
        ? matching.reduce((sum, r) => sum + r.responseTime, 0) / totalResponses
        : 0;
      return { questionIndex, question: q.question, totalResponses, correctRate, avgResponseMs };
    });

    const recentGames = completedGames.slice(0, 20).map((g) => {
      const gamePlayersForGame = players.filter((p) => p.gameId === g.id);
      const playerCount = gamePlayersForGame.length;
      const gAvgScore = playerCount > 0
        ? gamePlayersForGame.reduce((sum, p) => sum + (p.score ?? 0), 0) / playerCount
        : 0;
      return { id: g.id, gamePin: g.gamePin, createdAt: g.createdAt ?? null, playerCount, avgScore: gAvgScore };
    });

    return { gamesPlayed, totalPlayers, avgScore, lastPlayedAt, questions, recentGames };
  }

  // Games
  async getGame(ctx: StorageCtx, id: number): Promise<Game | undefined> {
    const game = this.games.get(id);
    return game && this.inTenant(ctx, game) ? game : undefined;
  }

  async getGameByPin(ctx: StorageCtx, pin: string): Promise<Game | undefined> {
    return Array.from(this.games.values()).find(
      (game) => game.gamePin === pin && this.inTenant(ctx, game),
    );
  }

  async createGame(ctx: StorageCtx, insertGame: InsertGame): Promise<Game> {
    const id = this.currentGameId++;
    const game: Game = {
      ...insertGame,
      id,
      tenantId: requireTenantId(ctx),
      currentQuestion: 0,
      players: [],
      createdAt: new Date()
    };
    this.games.set(id, game);
    return game;
  }

  async updateGame(ctx: StorageCtx, id: number, updates: Partial<Game>): Promise<Game | undefined> {
    const game = this.games.get(id);
    if (!game || !this.inTenant(ctx, game)) return undefined;

    const updatedGame = { ...game, ...updates };
    this.games.set(id, updatedGame);
    return updatedGame;
  }

  async deleteGame(ctx: StorageCtx, id: number): Promise<boolean> {
    const game = this.games.get(id);
    if (!game || !this.inTenant(ctx, game)) return false;
    return this.games.delete(id);
  }

  async joinGame(ctx: StorageCtx, pin: string, playerName: string): Promise<JoinGameResult> {
    // Mirrors the DB path: independent game_players insert, case-insensitive
    // uniqueness, insertion-rank cap. No await between read and write, so it is
    // atomic in the single-threaded runtime.
    const game = Array.from(this.games.values()).find(
      (g) => g.gamePin === pin && this.inTenant(ctx, g),
    );
    if (!game) return { status: "not_found" };
    if (game.status !== "waiting") return { status: "not_waiting" };

    const roster = Array.from(this.gamePlayers.values()).filter((p) => p.gameId === game.id);
    const taken = roster.some((p) => p.name.toLowerCase() === playerName.toLowerCase());
    if (taken) return { status: "duplicate" };

    const id = this.currentGamePlayerId++;
    const player: GamePlayer = {
      id,
      tenantId: game.tenantId,
      gameId: game.id,
      name: playerName,
      score: 0,
      joinedAt: new Date(),
    };

    const rank = roster.length + 1;
    if (rank > maxPlayersPerGame()) {
      return { status: "full" };
    }

    this.gamePlayers.set(id, player);
    return { status: "ok", game, player, playerCount: rank };
  }

  async quizHasLiveGame(ctx: StorageCtx, quizId: number): Promise<boolean> {
    return Array.from(this.games.values()).some(
      (g) =>
        g.quizId === quizId &&
        (g.status === "waiting" || g.status === "active") &&
        this.inTenant(ctx, g),
    );
  }

  async getGamePlayers(ctx: StorageCtx, gameId: number): Promise<GamePlayer[]> {
    return Array.from(this.gamePlayers.values())
      .filter((p) => p.gameId === gameId && this.inTenant(ctx, p))
      .sort((a, b) => a.id - b.id);
  }

  async countGamePlayers(ctx: StorageCtx, gameId: number): Promise<number> {
    return (await this.getGamePlayers(ctx, gameId)).length;
  }

  async setGamePlayerScores(ctx: StorageCtx, gameId: number, scores: Array<{ name: string; score: number }>): Promise<void> {
    const byName = new Map(scores.map((s) => [s.name.toLowerCase(), Math.trunc(s.score)]));
    for (const player of Array.from(this.gamePlayers.values())) {
      if (player.gameId !== gameId || !this.inTenant(ctx, player)) continue;
      const score = byName.get(player.name.toLowerCase());
      if (score !== undefined) {
        this.gamePlayers.set(player.id, { ...player, score });
      }
    }
  }

  // Game Responses
  async getGameResponses(ctx: StorageCtx, gameId: number): Promise<GameResponse[]> {
    return Array.from(this.gameResponses.values()).filter(
      (response) => response.gameId === gameId && this.inTenant(ctx, response)
    );
  }

  async createGameResponse(ctx: StorageCtx, insertResponse: InsertGameResponse): Promise<GameResponse> {
    const id = this.currentResponseId++;
    const response: GameResponse = { ...insertResponse, id };
    this.gameResponses.set(id, response);
    return response;
  }

  async createGameResponses(ctx: StorageCtx, responses: InsertGameResponse[]): Promise<GameResponse[]> {
    return responses.map((insertResponse) => {
      const id = this.currentResponseId++;
      const response: GameResponse = { ...insertResponse, id };
      this.gameResponses.set(id, response);
      return response;
    });
  }

  async updateGameResponse(ctx: StorageCtx, id: number, updates: Partial<GameResponse>): Promise<GameResponse | undefined> {
    const response = this.gameResponses.get(id);
    if (!response || !this.inTenant(ctx, response)) return undefined;

    const updatedResponse = { ...response, ...updates };
    this.gameResponses.set(id, updatedResponse);
    return updatedResponse;
  }

  async getPlayerResponses(ctx: StorageCtx, gameId: number, playerName: string): Promise<GameResponse[]> {
    return Array.from(this.gameResponses.values()).filter(
      (response) => response.gameId === gameId && response.playerName === playerName && this.inTenant(ctx, response)
    );
  }

  async getLatestCompletedGame(ctx: StorageCtx): Promise<{ game: Game; players: any[]; totalQuestions: number } | undefined> {
    const completedGames = Array.from(this.games.values())
      .filter((game) => game.status === "completed" && this.inTenant(ctx, game))
      .sort((a, b) => b.id - a.id);

    if (completedGames.length === 0) return undefined;

    const latestGame = completedGames[0];
    const quiz = await this.getQuiz(ctx, latestGame.quizId);
    if (!quiz) return undefined;

    const roster = await this.getGamePlayers(ctx, latestGame.id);
    const players = roster.map((p) => ({ name: p.name, score: p.score }));
    const totalQuestions = (quiz.questions as any[])?.length || 0;

    return {
      game: latestGame,
      players: players.sort((a, b) => (b.score || 0) - (a.score || 0)),
      totalQuestions
    };
  }

  // Tenants
  async getTenants(ctx: StorageCtx): Promise<Tenant[]> {
    requireSystem(ctx);
    return Array.from(this.tenants.values());
  }

  async getTenant(ctx: StorageCtx, id: number): Promise<Tenant | undefined> {
    requireSystem(ctx);
    return this.tenants.get(id);
  }

  async createTenant(ctx: StorageCtx, insertTenant: InsertTenant): Promise<Tenant> {
    requireSystem(ctx);
    const id = this.currentTenantId++;
    const tenant: Tenant = {
      id,
      slug: insertTenant.slug,
      name: insertTenant.name,
      domains: insertTenant.domains ?? [],
      branding: insertTenant.branding ?? {},
      features: insertTenant.features ?? {},
      status: insertTenant.status ?? "active",
      createdAt: new Date(),
    };
    this.tenants.set(id, tenant);
    return tenant;
  }

  async updateTenant(ctx: StorageCtx, id: number, updates: Partial<InsertTenant>): Promise<Tenant | undefined> {
    requireSystem(ctx);
    const existing = this.tenants.get(id);
    if (!existing) return undefined;
    const merged = {
      ...updates,
      ...(updates.branding !== undefined
        ? { branding: { ...(existing.branding as object), ...updates.branding } }
        : {}),
      ...(updates.features !== undefined
        ? { features: { ...(existing.features as object), ...updates.features } }
        : {}),
    };
    const updated: Tenant = { ...existing, ...merged, id: existing.id, createdAt: existing.createdAt };
    this.tenants.set(id, updated);
    return updated;
  }

  // Helper method to generate unique game PIN
  generateGamePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

export const storage = new DatabaseStorage();
