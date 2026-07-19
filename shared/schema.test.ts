import { test } from "node:test";
import assert from "node:assert/strict";
import { questionSchema, insertQuizSchema, insertBankQuestionSchema, normalizeTags, generatedQuizSchema } from "./schema";

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

test("questionSchema: poll type requires empty correctAnswers; quiz still requires one", () => {
  const base = { question: "Fav color?", answers: ["Red", "Blue"], timeLimit: 20 };
  assert.ok(questionSchema.safeParse({ ...base, type: "poll", answerType: "single", correctAnswers: [] }).success);
  assert.ok(!questionSchema.safeParse({ ...base, type: "poll", answerType: "single", correctAnswers: [0] }).success);
  assert.ok(!questionSchema.safeParse({ ...base, type: "quiz", answerType: "single", correctAnswers: [] }).success);
});

test("questionSchema round-trips sourceQuestionId (provenance survives Zod)", () => {
  const q = {
    question: "Q?",
    type: "quiz",
    answerType: "single",
    answers: ["a", "b"],
    correctAnswers: [0],
    timeLimit: 20,
    points: "standard",
    sourceQuestionId: 42,
  };
  const parsed = questionSchema.parse(q) as any;
  assert.equal(parsed.sourceQuestionId, 42);
  // And absent stays absent (not null / not 0).
  const { sourceQuestionId: _omit, ...bare } = q;
  assert.equal((questionSchema.parse(bare) as any).sourceQuestionId, undefined);
});

test("normalizeTags trims, drops empties, collapses case-insensitive duplicates keeping first casing", () => {
  assert.deepEqual(normalizeTags([" Safety ", "safety", "", "  ", "HR", "hr", "Fire"]), ["Safety", "HR", "Fire"]);
});

test("insertBankQuestionSchema: valid payload, tag caps, poll-with-correct rejected", () => {
  const question = {
    question: "Q?", type: "quiz", answerType: "single",
    answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard",
  };
  const ok = insertBankQuestionSchema.parse({ question, subject: " Safety ", tags: ["fire", "Fire", " hr "] });
  assert.equal(ok.subject, "Safety");
  assert.deepEqual(ok.tags, ["fire", "hr"]);
  // defaults
  const min = insertBankQuestionSchema.parse({ question });
  assert.equal(min.subject, undefined);
  assert.deepEqual(min.tags, []);
  // > 20 tags rejected
  assert.throws(() => insertBankQuestionSchema.parse({ question, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }));
  // tag longer than 50 chars rejected
  assert.throws(() => insertBankQuestionSchema.parse({ question, tags: ["x".repeat(51)] }));
  // poll with correctAnswers rejected (questionSchema reuse)
  assert.throws(() => insertBankQuestionSchema.parse({ question: { ...question, type: "poll" } }));
});

test("questionSchema accepts optional difficulty and explanation, round-trips them", () => {
  const q = {
    question: "Q?", type: "quiz", answerType: "single",
    answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard",
    difficulty: "medium", explanation: "A is right because reasons.",
  };
  const parsed = questionSchema.parse(q) as any;
  assert.equal(parsed.difficulty, "medium");
  assert.equal(parsed.explanation, "A is right because reasons.");
  const { difficulty: _d, explanation: _e, ...bare } = q;
  const bareParsed = questionSchema.parse(bare) as any;
  assert.equal(bareParsed.difficulty, undefined);
  assert.equal(bareParsed.explanation, undefined);
});

test("questionSchema rejects an over-long explanation and a bad difficulty", () => {
  const base = { question: "Q?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" };
  assert.throws(() => questionSchema.parse({ ...base, explanation: "x".repeat(501) }));
  assert.throws(() => questionSchema.parse({ ...base, difficulty: "trivial" }));
});

test("generatedQuizSchema accepts mixed types, normalizes tags, rejects poll-with-correct", () => {
  const ok = generatedQuizSchema.parse({
    title: "Mixed", description: "d", subject: " Safety ", tags: ["Fire", "fire", " ppe "],
    questions: [
      { question: "single?", type: "quiz", answerType: "single", answers: ["a", "b", "c", "d"], correctAnswers: [1], timeLimit: 20, points: "standard", difficulty: "easy", explanation: "b" },
      { question: "tf?", type: "true_false", answerType: "single", answers: ["True", "False"], correctAnswers: [0], timeLimit: 15, points: "standard", difficulty: "medium", explanation: "true" },
      { question: "multi?", type: "quiz", answerType: "multiple", answers: ["a", "b", "c"], correctAnswers: [0, 2], timeLimit: 30, points: "standard", difficulty: "hard", explanation: "a and c" },
    ],
  });
  assert.equal(ok.subject, "Safety");
  assert.deepEqual(ok.tags, ["Fire", "ppe"]);
  assert.equal(ok.questions.length, 3);
  // poll with correct answers is rejected by the underlying questionSchema
  assert.throws(() => generatedQuizSchema.parse({
    title: "x", description: "", questions: [{ question: "p?", type: "poll", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 10, points: "standard" }],
  }));
  // empty questions rejected
  assert.throws(() => generatedQuizSchema.parse({ title: "x", description: "", questions: [] }));
});
