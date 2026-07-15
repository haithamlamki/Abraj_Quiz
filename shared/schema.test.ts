import { test } from "node:test";
import assert from "node:assert/strict";
import { questionSchema, insertQuizSchema } from "./schema";

test("points defaults to standard for legacy questions", () => {
  const q = questionSchema.parse({ question: "Q", answers: ["a", "b", "c", "d"], correctAnswer: 1 });
  assert.equal(q.points, "standard");
  assert.deepEqual(q.correctAnswers, [1]);
});

test("points accepts double", () => {
  const q = questionSchema.parse({ question: "Q", answers: ["a", "b"], correctAnswers: [0], points: "double" });
  assert.equal(q.points, "double");
});

test("points rejects unknown values", () => {
  assert.throws(() => questionSchema.parse({ question: "Q", answers: ["a", "b"], correctAnswers: [0], points: "triple" }));
});

test("timeLimit accepts 0 as the no-limit sentinel", () => {
  const q = questionSchema.parse({ question: "Q", answers: ["a", "b"], correctAnswers: [0], timeLimit: 0 });
  assert.equal(q.timeLimit, 0);
});

test("timeLimit rejects values between 1 and 4", () => {
  assert.throws(() => questionSchema.parse({ question: "Q", answers: ["a", "b"], correctAnswers: [0], timeLimit: 3 }));
});

test("timeLimit still rejects over 120", () => {
  assert.throws(() => questionSchema.parse({ question: "Q", answers: ["a", "b"], correctAnswers: [0], timeLimit: 200 }));
});

test("insertQuizSchema accepts an optional theme object", () => {
  const parsed = insertQuizSchema.parse({ title: "T", questions: [], createdBy: 1, theme: { accent: "#123456" } });
  assert.deepEqual(parsed.theme, { accent: "#123456" });
});

test("insertQuizSchema tolerates a missing theme", () => {
  const parsed = insertQuizSchema.parse({ title: "T", questions: [], createdBy: 1 });
  assert.equal(parsed.theme, undefined);
});
