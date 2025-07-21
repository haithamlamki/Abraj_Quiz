import { pgTable, text, serial, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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

// Zod schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertQuizSchema = createInsertSchema(quizzes).pick({
  title: true,
  description: true,
  createdBy: true,
  questions: true,
  isPublic: true,
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
  question: z.string(),
  answers: z.array(z.string()).length(4),
  correctAnswer: z.number().min(0).max(3),
  timeLimit: z.number().default(30),
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
