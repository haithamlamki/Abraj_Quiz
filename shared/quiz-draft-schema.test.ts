import test from "node:test";
import assert from "node:assert/strict";
import { quizDraftSchema, MAX_QUIZ_VERSIONS } from "./schema";

test("quizDraftSchema accepts half-typed content insertQuizSchema would reject", () => {
  const parsed = quizDraftSchema.parse({
    title: "",                                  // empty title is fine in a draft
    questions: [
      { question: "half-typed", answers: ["only one"], correctAnswers: [] }, // no correct answer yet
      {},                                       // even an empty question object
    ],
  });
  assert.equal(parsed.title, "");
  assert.equal(parsed.questions.length, 2);
  // Defaults are filled so the payload is always structurally complete.
  assert.equal(parsed.questions[1].type, "quiz");
  assert.equal(parsed.questions[1].timeLimit, 20);
  assert.equal(parsed.isPublic, true);
});

test("quizDraftSchema strips unknown keys (no payload smuggling)", () => {
  const parsed = quizDraftSchema.parse({
    title: "t",
    evil: "x",
    questions: [{ question: "q", sneaky: true }],
  } as any);
  assert.ok(!("evil" in parsed));
  assert.ok(!("sneaky" in (parsed.questions[0] as any)));
});

test("quizDraftSchema enforces hard bounds", () => {
  // 101 questions
  assert.throws(() =>
    quizDraftSchema.parse({ questions: Array.from({ length: 101 }, () => ({})) }),
  );
  // title over 200 chars
  assert.throws(() => quizDraftSchema.parse({ title: "x".repeat(201), questions: [] }));
  // per-question string over 5000 chars
  assert.throws(() =>
    quizDraftSchema.parse({ questions: [{ question: "x".repeat(5001) }] }),
  );
  // more than 10 answers
  assert.throws(() =>
    quizDraftSchema.parse({ questions: [{ answers: Array.from({ length: 11 }, () => "a") }] }),
  );
});

test("MAX_QUIZ_VERSIONS is 20", () => {
  assert.equal(MAX_QUIZ_VERSIONS, 20);
});
