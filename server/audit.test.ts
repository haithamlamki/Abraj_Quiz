import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { AUDIT_ACTIONS, logAudit } = await import("./audit");

test("catalog: 17 unique namespace.verb codes", () => {
  const codes = Object.values(AUDIT_ACTIONS);
  assert.equal(codes.length, 17);
  assert.equal(new Set(codes).size, 17);
  for (const c of codes) assert.match(c, /^[a-z]+\.[a-z_]+$/);
});

test("logAudit never throws or rejects the caller when the insert fails", async () => {
  let called = 0;
  const storage = {
    insertAuditEvent: async () => { called++; throw new Error("db down"); },
  } as any;
  // Must not throw synchronously…
  logAudit(storage, { tenantId: 1 }, {
    action: AUDIT_ACTIONS.QUIZ_SAVE, actorId: 1, actorName: "u",
  });
  // …and the rejection must be swallowed (give the microtask a beat).
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(called, 1);
});
