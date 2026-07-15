import { z } from "zod";

export const wsErrorCodeSchema = z.enum([
  "ROOM_NOT_FOUND",
  "HOST_REQUIRED",
  "DUPLICATE_ANSWER",
  "QUESTION_CLOSED",
  "INVALID_PAYLOAD",
  "PLAYER_NOT_REGISTERED",
  "SESSION_HYDRATION_FAILED",
  // Join was rejected because the game reached its configured player cap.
  "GAME_FULL",
  // Join hit transient database contention (pool exhaustion, lock/serialization
  // timeout). Retryable — surfaced as HTTP 503, never a 500.
  "GAME_BUSY",
]);

export type WsErrorCode = z.infer<typeof wsErrorCodeSchema>;

export const wsJoinMessageSchema = z.object({
  type: z.literal("join"),
  gamePin: z.string().regex(/^\d{6}$/),
  playerName: z.string().trim().min(1).max(40).optional(),
  isHost: z.boolean().optional().default(false),
});

export const wsLeaveMessageSchema = z.object({
  type: z.literal("leave"),
});

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  wsJoinMessageSchema,
  wsLeaveMessageSchema,
]);

export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

export const wsAnswerDistributionSchema = z.object({
  answerCounts: z.array(z.number().int().min(0)).min(2).max(6),
  answerPercentages: z.array(z.number().int().min(0).max(100)).min(2).max(6),
  totalResponses: z.number().int().min(0),
});

export const wsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("joined"),
    gamePin: z.string(),
    isHost: z.boolean(),
  }),
  z.object({
    type: z.literal("error"),
    code: wsErrorCodeSchema,
    message: z.string(),
  }),
  z.object({
    type: z.literal("game_updated"),
    game: z.any(),
  }),
  z.object({
    type: z.literal("game_started"),
    game: z.any(),
  }),
  z.object({
    type: z.literal("question_started"),
    gamePin: z.string(),
    questionIndex: z.number().int().min(0),
    durationSeconds: z.number().int().min(0),
    startedAt: z.number().int().min(0),
    closesAt: z.number().int().min(0),
    timeRemaining: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("time_remaining"),
    gamePin: z.string(),
    questionIndex: z.number().int().min(0),
    timeRemaining: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("question_closed"),
    gamePin: z.string(),
    questionIndex: z.number().int().min(0),
    // correctAnswer = first correct index (back-compat); correctAnswers = full set.
    correctAnswer: z.number().int().min(0).max(5),
    correctAnswers: z.array(z.number().int().min(0).max(5)).default([]),
    distribution: wsAnswerDistributionSchema,
    players: z.array(z.any()),
  }),
  z.object({
    type: z.literal("next_question"),
    game: z.any(),
  }),
  z.object({
    type: z.literal("game_completed"),
    game: z.any(),
  }),
]);

export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;
