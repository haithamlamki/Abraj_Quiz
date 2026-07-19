import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response, NextFunction, RequestHandler } from "express";

// HTTP rate limiting. In-memory store is CORRECT here: the backend is
// single-instance by hard rule (live game state is in-process). If that rule
// ever changes, these limiters must move to a shared store in the same PR.
//
// Limits are env-tunable; 0 disables a limiter (break-glass escape hatch).
// The join ceiling is deliberately huge: at a live venue, hundreds of players
// join within seconds from ONE public NAT IP — 600/min only stops floods.

export interface LimiterSetting {
  windowMs: number;
  max: number;
  skipSuccessfulRequests: boolean;
  keyBy: "ip" | "user";
}

export interface RateLimitSettings {
  auth: LimiterSetting;
  ai: LimiterSetting;
  upload: LimiterSetting;
  join: LimiterSetting;
  draft: LimiterSetting;
}

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const parsed = parseInt(env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function rateLimitSettings(env: NodeJS.ProcessEnv): RateLimitSettings {
  return {
    // Credential stuffing protection. Successful logins/registrations are NOT
    // counted, so shared school/office NATs only burn quota on failures.
    auth:   { windowMs: 15 * 60_000, max: intFromEnv(env, "RATE_LIMIT_AUTH_MAX", 30),  skipSuccessfulRequests: true,  keyBy: "ip" },
    // Direct OpenAI spend — keyed per account, not per IP.
    ai:     { windowMs: 60 * 60_000, max: intFromEnv(env, "RATE_LIMIT_AI_MAX", 20),    skipSuccessfulRequests: false, keyBy: "user" },
    upload: { windowMs: 60 * 60_000, max: intFromEnv(env, "RATE_LIMIT_UPLOAD_MAX", 60), skipSuccessfulRequests: false, keyBy: "user" },
    join:   { windowMs: 60_000,      max: intFromEnv(env, "RATE_LIMIT_JOIN_MAX", 600), skipSuccessfulRequests: false, keyBy: "ip" },
    // Autosave drafts — debounced client-side (~2.5s), so steady state is a few
    // req/min; 60/min per account only stops runaway loops, never real typing.
    draft:  { windowMs: 60_000, max: intFromEnv(env, "RATE_LIMIT_DRAFT_MAX", 60), skipSuccessfulRequests: false, keyBy: "user" },
  };
}

const passThrough: RequestHandler = (_req: Request, _res: Response, next: NextFunction) => next();

function toLimiter(setting: LimiterSetting, message: string): RequestHandler {
  if (setting.max === 0) return passThrough;
  return rateLimit({
    windowMs: setting.windowMs,
    // v8 name; `max` still works but is deprecated.
    limit: setting.max,
    skipSuccessfulRequests: setting.skipSuccessfulRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) =>
      setting.keyBy === "user" && (req as any).authUserId != null
        ? String((req as any).authUserId)
        : ipKeyGenerator(req.ip ?? "unknown"),
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ message, code: "RATE_LIMITED" });
    },
  });
}

export function buildRateLimiters(env: NodeJS.ProcessEnv = process.env) {
  const s = rateLimitSettings(env);
  return {
    authLimiter:   toLimiter(s.auth,   "Too many sign-in attempts. Please try again later."),
    aiLimiter:     toLimiter(s.ai,     "AI generation limit reached. Please try again later."),
    uploadLimiter: toLimiter(s.upload, "Upload limit reached. Please try again later."),
    joinLimiter:   toLimiter(s.join,   "Too many join attempts from this network. Please try again shortly."),
    draftLimiter:  toLimiter(s.draft,  "Draft is saving too often. Please slow down."),
  };
}
