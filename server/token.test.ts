import test from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET ||= "test-token-secret";

const { signToken, verifyToken } = await import("./token");

test("signToken/verifyToken round-trips the payload", () => {
  const token = signToken({ userId: 7, tenantId: 2 });
  assert.deepEqual(verifyToken(token), { userId: 7, tenantId: 2 });
});

test("verifyToken rejects a tampered signature", () => {
  const token = signToken({ userId: 7, tenantId: 2 });
  const tampered = token.slice(0, -3) + (token.endsWith("aaa") ? "bbb" : "aaa");
  assert.equal(verifyToken(tampered), null);
});

test("verifyToken rejects a tampered payload", () => {
  const token = signToken({ userId: 7, tenantId: 2 });
  const [, sig] = token.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ userId: 8, tenantId: 2, exp: Date.now() + 1000 }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.equal(verifyToken(`${forgedBody}.${sig}`), null);
});

test("verifyToken rejects garbage and empty input", () => {
  assert.equal(verifyToken(undefined), null);
  assert.equal(verifyToken(null), null);
  assert.equal(verifyToken(""), null);
  assert.equal(verifyToken("not-a-token"), null);
  assert.equal(verifyToken("only.onedot"), null);
});
