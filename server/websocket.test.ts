import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { isOriginAllowed } = await import("./websocket");
const { wsServerMessageSchema } = await import("../shared/ws-protocol");

test("isOriginAllowed: empty list in dev is permissive", () => {
  assert.equal(isOriginAllowed([], "https://anywhere.example.com", false), true);
  assert.equal(isOriginAllowed([], undefined, false), true);
});

test("isOriginAllowed: empty list in production is strict", () => {
  assert.equal(isOriginAllowed([], "https://app.example.com", true), false);
  assert.equal(isOriginAllowed([], undefined, true), false);
});

test("isOriginAllowed: missing Origin header is rejected when list is non-empty", () => {
  assert.equal(isOriginAllowed(["https://app.example.com"], undefined, true), false);
  assert.equal(isOriginAllowed(["https://app.example.com"], "", true), false);
});

test("isOriginAllowed: exact match is allowed", () => {
  assert.equal(
    isOriginAllowed(["https://app.example.com"], "https://app.example.com", true),
    true,
  );
});

test("isOriginAllowed: case mismatch is rejected (current behavior, not normalized)", () => {
  assert.equal(
    isOriginAllowed(["https://app.example.com"], "https://App.Example.com", true),
    false,
  );
});

test("isOriginAllowed: trailing-slash mismatch is rejected (current behavior, not normalized)", () => {
  assert.equal(
    isOriginAllowed(["https://app.example.com"], "https://app.example.com/", true),
    false,
  );
});

test("question_started accepts a no-limit (0-duration) message", () => {
  const msg = {
    type: "question_started",
    gamePin: "123456",
    questionIndex: 0,
    durationSeconds: 0,
    startedAt: 1,
    closesAt: 0,
    timeRemaining: 0,
  };
  assert.doesNotThrow(() => wsServerMessageSchema.parse(msg));
});
