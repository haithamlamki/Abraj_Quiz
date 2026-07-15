import {
  users, quizzes, games, gameResponses, gamePlayers, tenants,
  type User, type InsertUser,
  type Quiz, type InsertQuiz,
  type Game, type InsertGame,
  type GameResponse, type InsertGameResponse,
  type GamePlayer,
  type Tenant, type InsertTenant
} from "@shared/schema";
import { db } from "./db";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";

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
  // case we most need to map to GAME_BUSY.
  return typeof e?.message === "string" &&
    /timeout exceeded when trying to connect|Connection terminated/i.test(e.message);
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

function tenantFilter(ctx: StorageCtx, column: typeof users.tenantId | typeof quizzes.tenantId | typeof games.tenantId | typeof gameResponses.tenantId | typeof gamePlayers.tenantId): SQL | undefined {
  return "system" in ctx ? undefined : eq(column, ctx.tenantId);
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
  getUserQuizzes(ctx: StorageCtx, userId: number): Promise<Quiz[]>;
  createQuiz(ctx: StorageCtx, quiz: InsertQuiz): Promise<Quiz>;
  updateQuiz(ctx: StorageCtx, id: number, quiz: Partial<InsertQuiz>): Promise<Quiz>;
  deleteQuiz(ctx: StorageCtx, id: number): Promise<boolean>;

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
      return tx.select().from(quizzes).where(tenantFilter(ctx, quizzes.tenantId));
    });
  }

  async getPublicQuizzes(ctx: StorageCtx): Promise<Quiz[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(quizzes)
        .where(and(eq(quizzes.isPublic, true), tenantFilter(ctx, quizzes.tenantId)));
    });
  }

  async getUserQuizzes(ctx: StorageCtx, userId: number): Promise<Quiz[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(quizzes)
        .where(and(eq(quizzes.createdBy, userId), tenantFilter(ctx, quizzes.tenantId)));
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

  async deleteQuiz(ctx: StorageCtx, id: number): Promise<boolean> {
    return withCtx(ctx, async (tx) => {
      const result = await tx.delete(quizzes)
        .where(and(eq(quizzes.id, id), tenantFilter(ctx, quizzes.tenantId)));
      return (result.rowCount || 0) > 0;
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
  private currentUserId: number;
  private currentQuizId: number;
  private currentGameId: number;
  private currentResponseId: number;
  private currentGamePlayerId: number;
  private currentTenantId = 1;

  constructor() {
    this.users = new Map();
    this.quizzes = new Map();
    this.games = new Map();
    this.gameResponses = new Map();
    this.gamePlayers = new Map();
    this.currentUserId = 1;
    this.currentQuizId = 1;
    this.currentGameId = 1;
    this.currentResponseId = 1;
    this.currentGamePlayerId = 1;

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
        createdAt: new Date()
      },
      {
        id: 2,
        tenantId: 1,
        title: "Science Trivia",
        description: "Explore fascinating facts about biology, chemistry, and physics.",
        createdBy: 1,
        background: "classroom",
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
        createdAt: new Date()
      },
      {
        id: 3,
        tenantId: 1,
        title: "Math Masters",
        description: "Challenge yourself with algebra, geometry, and calculus problems.",
        createdBy: 1,
        background: "classroom",
        questions: [
          {
            question: "What is 15% of 200?",
            answers: ["25", "30", "35", "40"],
            correctAnswer: 1,
            timeLimit: 30
          }
        ],
        isPublic: true,
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
    return Array.from(this.quizzes.values()).filter((q) => this.inTenant(ctx, q));
  }

  async getPublicQuizzes(ctx: StorageCtx): Promise<Quiz[]> {
    return Array.from(this.quizzes.values()).filter(
      (quiz) => quiz.isPublic && this.inTenant(ctx, quiz),
    );
  }

  async getUserQuizzes(ctx: StorageCtx, userId: number): Promise<Quiz[]> {
    return Array.from(this.quizzes.values()).filter(
      (quiz) => quiz.createdBy === userId && this.inTenant(ctx, quiz),
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
      isPublic: quiz.isPublic ?? true,
      createdBy: quiz.createdBy,
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

  async deleteQuiz(ctx: StorageCtx, id: number): Promise<boolean> {
    const existing = this.quizzes.get(id);
    if (!existing || !this.inTenant(ctx, existing)) return false;
    return this.quizzes.delete(id);
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
