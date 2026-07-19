import test from "node:test";
import assert from "node:assert/strict";

const { rateLimitSettings } = await import("./rate-limits");

test("defaults: auth 30 failed/15min by IP, ai 20/h by user, upload 60/h by user, join 600/min by IP", () => {
  const s = rateLimitSettings({});
  assert.deepEqual(s.auth,   { windowMs: 15 * 60_000, max: 30,  skipSuccessfulRequests: true,  keyBy: "ip" });
  assert.deepEqual(s.ai,     { windowMs: 60 * 60_000, max: 20,  skipSuccessfulRequests: false, keyBy: "user" });
  assert.deepEqual(s.upload, { windowMs: 60 * 60_000, max: 60,  skipSuccessfulRequests: false, keyBy: "user" });
  assert.deepEqual(s.join,   { windowMs: 60_000,      max: 600, skipSuccessfulRequests: false, keyBy: "ip" });
});

test("join ceiling honors the venue-NAT floor: default max is >= 600", () => {
  // 400 phones behind one venue NAT join within seconds — the limiter must
  // never touch a real event.
  assert.ok(rateLimitSettings({}).join.max >= 600);
});

test("env overrides parse as integers and 0 disables", () => {
  const s = rateLimitSettings({
    RATE_LIMIT_AUTH_MAX: "5",
    RATE_LIMIT_AI_MAX: "0",
    RATE_LIMIT_UPLOAD_MAX: "7",
    RATE_LIMIT_JOIN_MAX: "1200",
  } as NodeJS.ProcessEnv);
  assert.equal(s.auth.max, 5);
  assert.equal(s.ai.max, 0);
  assert.equal(s.upload.max, 7);
  assert.equal(s.join.max, 1200);
});

test("garbage env values fall back to defaults", () => {
  const s = rateLimitSettings({ RATE_LIMIT_AUTH_MAX: "banana", RATE_LIMIT_JOIN_MAX: "-3" } as NodeJS.ProcessEnv);
  assert.equal(s.auth.max, 30);
  assert.equal(s.join.max, 600);
});

test("buildRateLimiters constructs all four limiters without express-rate-limit validation errors", async () => {
  const { buildRateLimiters } = await import("./rate-limits");
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const limiters = buildRateLimiters({} as NodeJS.ProcessEnv);
    assert.equal(typeof limiters.authLimiter, "function");
    assert.equal(typeof limiters.joinLimiter, "function");
  } finally {
    console.error = orig;
  }
  const validationNoise = logged.filter((l) => l.includes("ERR_ERL"));
  assert.deepEqual(validationNoise, []);
});

test("draft limiter: 60/min per user by default, env-overridable", () => {
  const s = rateLimitSettings({} as NodeJS.ProcessEnv);
  assert.equal(s.draft.windowMs, 60_000);
  assert.equal(s.draft.max, 60);
  assert.equal(s.draft.keyBy, "user");
  assert.equal(s.draft.skipSuccessfulRequests, false);
  const overridden = rateLimitSettings({ RATE_LIMIT_DRAFT_MAX: "5" } as any);
  assert.equal(overridden.draft.max, 5);
});
