import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBackgroundBodySchema } from "./background-request";

test("accepts a prompt-only body and trims it", () => {
  const r = generateBackgroundBodySchema.safeParse({ prompt: "  space adventure  " });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.prompt, "space adventure");
});

test("accepts a title-only body (legacy shape) and rejects an empty body", () => {
  assert.equal(generateBackgroundBodySchema.safeParse({ title: "Fire Safety" }).success, true);
  assert.equal(generateBackgroundBodySchema.safeParse({}).success, false);
  assert.equal(generateBackgroundBodySchema.safeParse({ prompt: "ab" }).success, false);
});

test("enforces length caps: prompt 300, title 100, description 500", () => {
  assert.equal(generateBackgroundBodySchema.safeParse({ prompt: "x".repeat(301) }).success, false);
  assert.equal(generateBackgroundBodySchema.safeParse({ prompt: "x".repeat(300) }).success, true);
  assert.equal(generateBackgroundBodySchema.safeParse({ title: "x".repeat(101) }).success, false);
  assert.equal(generateBackgroundBodySchema.safeParse({ prompt: "valid one", description: "x".repeat(501) }).success, false);
});
