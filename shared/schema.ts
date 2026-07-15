import { pgTable, text, serial, integer, boolean, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Multi-tenancy ────────────────────────────────────────────────
export const brandingSchema = z.object({
  appName: z.string().default("Abraj Quiz"),
  logoUrl: z.string().default(""),      // URL or data: URL; empty = bundled default logo
  faviconUrl: z.string().default(""),
  colors: z
    .object({
      primary: z.string().default("hsl(184, 100%, 47%)"),
      secondary: z.string().default("hsl(184, 85%, 35%)"),
    })
    .default({}),
  pdf: z
    .object({
      headerText: z.string().default("ABRAJ QUIZ COMPLETE REPORT"),
      footerText: z.string().default("© 2025 Abraj Quiz Platform"),
      footerTagline: z.string().default("Enhancing Education Through Interactive Technology"),
      primaryColor: z.array(z.number()).length(3).default([1, 158, 189]),
    })
    .default({}),
  emailFromName: z.string().default(""),
});
export type TenantBranding = z.infer<typeof brandingSchema>;

export const featuresSchema = z.object({
  aiGeneration: z.boolean().default(true),
  pdfReports: z.boolean().default(true),
  publicQuizzes: z.boolean().default(true),
});
export type TenantFeatures = z.infer<typeof featuresSchema>;

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  domains: jsonb("domains").$type<string[]>().notNull().default([]),
  branding: jsonb("branding").$type<Partial<TenantBranding>>().notNull().default({}),
  features: jsonb("features").$type<Partial<TenantFeatures>>().notNull().default({}),
  status: text("status").notNull().default("active"), // 'active' | 'suspended'
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTenantSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, digits, hyphens"),
  name: z.string().min(1),
  domains: z.array(z.string()).default([]),
  branding: brandingSchema.partial().default({}),
  features: featuresSchema.partial().default({}),
  status: z.enum(["active", "suspended"]).default("active"),
});
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    username: text("username").notNull(),
    password: text("password").notNull(),
  },
  (t) => [uniqueIndex("users_tenant_username_uq").on(t.tenantId, t.username)],
);

export const quizzes = pgTable("quizzes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  title: text("title").notNull(),
  description: text("description"),
  createdBy: integer("created_by").notNull(),
  questions: jsonb("questions").notNull(),
  background: text("background").default("classroom"), // Can store theme name or base64 data URL
  // Custom theme config (colors/font/card style). NULL → derive from `background`
  // preset (backward compatible). Validated by shared/quiz-theme.ts at read time.
  theme: jsonb("theme"),
  isPublic: boolean("is_public").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  quizId: integer("quiz_id").notNull(),
  gamePin: text("game_pin").notNull().unique(),
  hostId: integer("host_id").notNull(),
  status: text("status").notNull(), // 'waiting', 'active', 'completed'
  currentQuestion: integer("current_question").default(0),
  // LEGACY / FROZEN as of migration 0006. The authoritative roster of active
  // participants is now the game_players table (independent per-row inserts —
  // no single-row lock, no O(n^2) rewrite). This column is retained only so
  // historical rows survive; the app no longer reads or writes it. Do not
  // reintroduce reads/writes here — that would recreate the dual-source
  // inconsistency 0006 removed.
  players: jsonb("players").default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

// Authoritative roster of active participants for a game. One row per player;
// joins are independent INSERTs (no locking/rewriting a shared JSON array), so
// a 400-player join storm no longer serializes on the games row. The partial
// unique index on (game_id, lower(name)) enforces case-insensitive name
// uniqueness per game at the database — the second layer that makes duplicate
// rejection reliable under concurrency, not just in application code.
export const gamePlayers = pgTable(
  "game_players",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    gameId: integer("game_id").notNull().references(() => games.id),
    name: text("name").notNull(),
    score: integer("score").notNull().default(0),
    joinedAt: timestamp("joined_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("game_players_game_name_uq").on(t.gameId, sql`lower(${t.name})`),
    index("game_players_game_id_idx").on(t.gameId),
  ],
);

export const gameResponses = pgTable("game_responses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  gameId: integer("game_id").notNull(),
  playerName: text("player_name").notNull(),
  questionIndex: integer("question_index").notNull(),
  selectedAnswer: integer("selected_answer").notNull(),
  responseTime: integer("response_time").notNull(), // in milliseconds
  isCorrect: boolean("is_correct").notNull(),
  pointsEarned: integer("points_earned").notNull(),
});

export const sessions = pgTable("session", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

// Zod schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertQuizSchema = createInsertSchema(quizzes).pick({
  title: true,
  description: true,
  questions: true,
  background: true,
  isPublic: true,
  createdBy: true,
}).extend({
  title: z.string().min(1, "Quiz title is required"),
  description: z.string().optional(),
  background: z.string().default("classroom"), // Can store theme name or base64 data URL
  isPublic: z.boolean().default(true),
  theme: z.record(z.any()).optional(),
});

export const insertGameSchema = createInsertSchema(games).pick({
  quizId: true,
  gamePin: true,
  hostId: true,
  status: true,
});

export const insertGamePlayerSchema = createInsertSchema(gamePlayers).pick({
  tenantId: true,
  gameId: true,
  name: true,
  score: true,
}).extend({
  // tenantId has a DB default(1) that drizzle-zod treats as optional; storage
  // callers always stamp it explicitly from the game's tenant.
  tenantId: z.number().int(),
  score: z.number().int().default(0),
});

export const insertGameResponseSchema = createInsertSchema(gameResponses).pick({
  tenantId: true,
  gameId: true,
  playerName: true,
  questionIndex: true,
  selectedAnswer: true,
  responseTime: true,
  isCorrect: true,
  pointsEarned: true,
}).extend({
  // tenantId has a DB default(1), which drizzle-zod otherwise treats as optional;
  // storage callers (routes.ts, game-room-manager.ts) always stamp it explicitly.
  tenantId: z.number().int(),
});

// Question schema
export const questionTypeSchema = z.enum(["quiz", "true_false"]);
export const answerModeSchema = z.enum(["single", "multiple"]);
export const questionPointsSchema = z.enum(["standard", "double"]);

export const MAX_ANSWERS = 6;

// Canonical (normalized) question shape. A question now supports:
//  - an optional per-question image (Supabase Storage URL),
//  - 2..6 answers (was exactly 4),
//  - a question type (Quiz | True/False),
//  - single- or multiple-correct answers (correctAnswers array; single-select
//    stores a chosen index at play time, multi-select stores a bitmask).
const questionObjectSchema = z
  .object({
    question: z.string().min(1, "Question text is required"),
    imageUrl: z.string().url().optional(),
    type: questionTypeSchema.default("quiz"),
    answerType: answerModeSchema.default("single"),
    answers: z
      .array(z.string().min(1, "Answer text is required"))
      .min(2, "Must have at least 2 answers")
      .max(MAX_ANSWERS, `Must have at most ${MAX_ANSWERS} answers`),
    correctAnswers: z
      .array(z.number().int().min(0))
      .min(1, "Mark at least one correct answer"),
    // 0 = no limit (host advances manually); otherwise 5..120 seconds.
    timeLimit: z
      .number()
      .int()
      .min(0)
      .max(120)
      .refine((t) => t === 0 || t >= 5, {
        message: "Time limit must be 0 (no limit) or between 5 and 120 seconds",
      })
      .default(20),
    // Score multiplier: standard = 1x, double = 2x on the time-based score.
    points: questionPointsSchema.default("standard"),
  })
  .superRefine((q, ctx) => {
    const n = q.answers.length;
    const unique = new Set(q.correctAnswers);
    for (const idx of q.correctAnswers) {
      if (idx >= n) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Correct answer index ${idx} is out of range`, path: ["correctAnswers"] });
      }
    }
    if (unique.size !== q.correctAnswers.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate correct answers", path: ["correctAnswers"] });
    }
    if (q.answerType === "single" && q.correctAnswers.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Single-select questions must have exactly one correct answer", path: ["correctAnswers"] });
    }
    if (q.type === "true_false" && n !== 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "True/False questions must have exactly two answers", path: ["answers"] });
    }
  });

// Normalize legacy questions ({ correctAnswer: n, 4 answers }) written before the
// Kahoot revamp into the canonical shape, so existing quizzes keep working with
// no data migration.
export function normalizeLegacyQuestion(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const q = raw as Record<string, unknown>;
    if (q.correctAnswers === undefined && typeof q.correctAnswer === "number") {
      return {
        ...q,
        correctAnswers: [q.correctAnswer],
        type: q.type ?? "quiz",
        answerType: q.answerType ?? "single",
      };
    }
  }
  return raw;
}

export const questionSchema = z.preprocess(normalizeLegacyQuestion, questionObjectSchema);

export const quizQuestionsSchema = z.array(questionSchema);

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertQuiz = z.infer<typeof insertQuizSchema>;
export type Quiz = typeof quizzes.$inferSelect;

export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof games.$inferSelect;

export type InsertGameResponse = z.infer<typeof insertGameResponseSchema>;
export type GameResponse = typeof gameResponses.$inferSelect;

export type InsertGamePlayer = z.infer<typeof insertGamePlayerSchema>;
export type GamePlayer = typeof gamePlayers.$inferSelect;

export type Question = z.infer<typeof questionSchema>;
export type QuizQuestions = z.infer<typeof quizQuestionsSchema>;
