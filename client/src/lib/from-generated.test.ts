import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGeneratedQuestions } from "./from-generated";

test("passes through a canonical mixed-type question incl. difficulty/explanation", () => {
  const out = normalizeGeneratedQuestions([
    { question: "q?", type: "quiz", answerType: "single", answers: ["a", "b", "c", "d"], correctAnswers: [2], timeLimit: 20, points: "standard", difficulty: "hard", explanation: "c" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].correctAnswers[0], 2);
  assert.equal((out[0] as any).difficulty, "hard");
});

test("normalizes a legacy {correctAnswer} question via schema preprocess", () => {
  const out = normalizeGeneratedQuestions([
    { question: "q?", answers: ["a", "b", "c", "d"], correctAnswer: 1, timeLimit: 10 },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].correctAnswers, [1]);
});

test("drops invalid questions instead of throwing", () => {
  const out = normalizeGeneratedQuestions([
    { question: "ok?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 10, points: "standard" },
    { question: "", answers: [] },            // invalid
    { garbage: true },                         // invalid
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].question, "ok?");
});

test("empty / non-array input yields empty array", () => {
  assert.deepEqual(normalizeGeneratedQuestions([]), []);
  assert.deepEqual(normalizeGeneratedQuestions(undefined as any), []);
});
