import { pgTable, text, serial, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const presentations = pgTable("presentations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  createdBy: integer("created_by").notNull(),
  slides: jsonb("slides").notNull(), // Array of slide objects
  theme: text("theme").default("professional"), // Theme/template name
  generatedFrom: text("generated_from"), // 'pdf', 'url', 'text', 'topics', 'manual'
  sourceContent: text("source_content"), // Original content used for generation
  isPublic: boolean("is_public").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const presentationSessions = pgTable("presentation_sessions", {
  id: serial("id").primaryKey(),
  presentationId: integer("presentation_id").notNull(),
  sessionPin: text("session_pin").notNull().unique(),
  hostId: integer("host_id").notNull(),
  status: text("status").notNull(), // 'waiting', 'active', 'completed'
  currentSlide: integer("current_slide").default(0),
  viewers: jsonb("viewers").default([]), // Array of viewer objects
  interactions: jsonb("interactions").default([]), // Polls, Q&A, feedback
  createdAt: timestamp("created_at").defaultNow(),
});

export const sessionInteractions = pgTable("session_interactions", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  viewerName: text("viewer_name").notNull(),
  interactionType: text("interaction_type").notNull(), // 'poll', 'qa', 'feedback', 'reaction'
  slideIndex: integer("slide_index").notNull(),
  content: jsonb("content").notNull(), // Interaction data (poll answer, question, etc.)
  createdAt: timestamp("created_at").defaultNow(),
});

// Zod schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertPresentationSchema = createInsertSchema(presentations).pick({
  title: true,
  description: true,
  slides: true,
  theme: true,
  generatedFrom: true,
  sourceContent: true,
  isPublic: true,
}).extend({
  title: z.string().min(1, "Presentation title is required"),
  description: z.string().optional(),
  theme: z.string().default("professional"),
  generatedFrom: z.enum(["pdf", "url", "text", "topics", "manual"]).optional(),
  sourceContent: z.string().optional(),
  isPublic: z.boolean().default(true),
});

export const insertPresentationSessionSchema = createInsertSchema(presentationSessions).pick({
  presentationId: true,
  sessionPin: true,
  hostId: true,
  status: true,
});

export const insertSessionInteractionSchema = createInsertSchema(sessionInteractions).pick({
  sessionId: true,
  viewerName: true,
  interactionType: true,
  slideIndex: true,
  content: true,
});

// Slide schema
export const slideSchema = z.object({
  id: z.string(),
  type: z.enum(["title", "content", "image", "video", "chart", "poll", "qa"]),
  title: z.string().min(1, "Slide title is required"),
  content: z.string().optional(),
  media: z.object({
    type: z.enum(["image", "video", "chart"]).optional(),
    url: z.string().optional(),
    alt: z.string().optional(),
  }).optional(),
  interactive: z.object({
    type: z.enum(["poll", "qa", "feedback"]).optional(),
    question: z.string().optional(),
    options: z.array(z.string()).optional(),
  }).optional(),
  layout: z.enum(["single", "split", "grid", "full"]).default("single"),
  animations: z.array(z.string()).default([]),
});

export const presentationSlidesSchema = z.array(slideSchema);

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertPresentation = z.infer<typeof insertPresentationSchema>;
export type Presentation = typeof presentations.$inferSelect;

export type InsertPresentationSession = z.infer<typeof insertPresentationSessionSchema>;
export type PresentationSession = typeof presentationSessions.$inferSelect;

export type InsertSessionInteraction = z.infer<typeof insertSessionInteractionSchema>;
export type SessionInteraction = typeof sessionInteractions.$inferSelect;

export type Slide = z.infer<typeof slideSchema>;
export type PresentationSlides = z.infer<typeof presentationSlidesSchema>;
