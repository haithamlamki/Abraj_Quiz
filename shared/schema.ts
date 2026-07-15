import { pgTable, text, serial, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
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

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const quizzes = pgTable("quizzes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  createdBy: integer("created_by").notNull(),
  questions: jsonb("questions").notNull(),
  background: text("background").default("classroom"), // Can store theme name or base64 data URL
  isPublic: boolean("is_public").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  quizId: integer("quiz_id").notNull(),
  gamePin: text("game_pin").notNull().unique(),
  hostId: integer("host_id").notNull(),
  status: text("status").notNull(), // 'waiting', 'active', 'completed'
  currentQuestion: integer("current_question").default(0),
  players: jsonb("players").default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const gameResponses = pgTable("game_responses", {
  id: serial("id").primaryKey(),
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
});

export const insertGameSchema = createInsertSchema(games).pick({
  quizId: true,
  gamePin: true,
  hostId: true,
  status: true,
});

export const insertGameResponseSchema = createInsertSchema(gameResponses).pick({
  gameId: true,
  playerName: true,
  questionIndex: true,
  selectedAnswer: true,
  responseTime: true,
  isCorrect: true,
  pointsEarned: true,
});

// Question schema
export const questionSchema = z.object({
  question: z.string().min(1, "Question text is required"),
  answers: z.array(z.string().min(1, "Answer text is required")).length(4, "Must have exactly 4 answers"),
  correctAnswer: z.number().min(0).max(3, "Correct answer must be between 0-3"),
  timeLimit: z.number().min(5).max(120).default(10),
});

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

export type Question = z.infer<typeof questionSchema>;
export type QuizQuestions = z.infer<typeof quizQuestionsSchema>;
