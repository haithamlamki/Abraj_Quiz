import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { questionSchema, quizQuestionsSchema } = await import("@shared/schema");
const { isSelectionCorrect, tallyDistribution, encodeSelection, decodeSelection } = await import("@shared/quiz-scoring");

test("questionSchema normalizes a legacy single-correct question", () => {
  const legacy = { question: "Capital of Oman?", answers: ["Doha", "Riyadh", "Muscat", "Dubai"], correctAnswer: 2, timeLimit: 10 };
  const parsed = questionSchema.parse(legacy) as any;
  assert.deepEqual(parsed.correctAnswers, [2]);
  assert.equal(parsed.type, "quiz");
  assert.equal(parsed.answerType, "single");
  assert.equal(parsed.correctAnswer, undefined);
});

test("questionSchema accepts 2..6 answers and rejects out-of-range counts", () => {
  const base = { question: "Q", correctAnswers: [0], type: "quiz", answerType: "single", timeLimit: 20 };
  assert.ok(questionSchema.safeParse({ ...base, answers: ["a", "b"] }).success);
  assert.ok(questionSchema.safeParse({ ...base, answers: ["a", "b", "c", "d", "e", "f"] }).success);
  assert.ok(!questionSchema.safeParse({ ...base, answers: ["a"] }).success);
  assert.ok(!questionSchema.safeParse({ ...base, answers: ["a", "b", "c", "d", "e", "f", "g"] }).success);
});

test("questionSchema enforces single-select exactly one correct, and correct-in-range", () => {
  const q = { question: "Q", answers: ["a", "b", "c"], type: "quiz", answerType: "single" as const, timeLimit: 20 };
  assert.ok(!questionSchema.safeParse({ ...q, correctAnswers: [0, 1] }).success, "single with 2 correct rejected");
  assert.ok(!questionSchema.safeParse({ ...q, correctAnswers: [5] }).success, "out-of-range correct rejected");
  assert.ok(questionSchema.safeParse({ ...q, correctAnswers: [1] }).success);
});

test("questionSchema enforces True/False has exactly 2 answers", () => {
  const tf = { question: "Sky is blue?", type: "true_false" as const, answerType: "single" as const, correctAnswers: [0], timeLimit: 20 };
  assert.ok(questionSchema.safeParse({ ...tf, answers: ["True", "False"] }).success);
  assert.ok(!questionSchema.safeParse({ ...tf, answers: ["True", "False", "Maybe"] }).success);
});

test("multi-select bitmask round-trips through encode/decode", () => {
  assert.equal(encodeSelection("multiple", [0, 2]), 0b101);
  assert.deepEqual(decodeSelection("multiple", 0b101).sort(), [0, 2]);
  // single-select stores the index verbatim
  assert.equal(encodeSelection("single", [3]), 3);
  assert.deepEqual(decodeSelection("single", 3), [3]);
});

test("isSelectionCorrect: single-select matches the chosen index", () => {
  const q = { answerType: "single" as const, answers: ["a", "b", "c", "d"], correctAnswers: [2] };
  assert.equal(isSelectionCorrect(q, 2), true);
  assert.equal(isSelectionCorrect(q, 1), false);
});

test("isSelectionCorrect: multi-select is all-or-nothing", () => {
  const q = { answerType: "multiple" as const, answers: ["a", "b", "c", "d"], correctAnswers: [0, 2] };
  assert.equal(isSelectionCorrect(q, encodeSelection("multiple", [0, 2])), true, "exact set");
  assert.equal(isSelectionCorrect(q, encodeSelection("multiple", [0])), false, "missing one");
  assert.equal(isSelectionCorrect(q, encodeSelection("multiple", [0, 2, 3])), false, "extra wrong one");
});

test("tallyDistribution sizes to answer count and decodes multi-select", () => {
  const single = { answerType: "single" as const, answers: ["a", "b", "c"], correctAnswers: [0] };
  assert.deepEqual(tallyDistribution(single, [0, 0, 1, 2]), [2, 1, 1]);

  const multi = { answerType: "multiple" as const, answers: ["a", "b", "c", "d", "e", "f"], correctAnswers: [1, 3] };
  const s1 = encodeSelection("multiple", [1, 3]);
  const s2 = encodeSelection("multiple", [1]);
  // option 1 chosen twice, option 3 chosen once; distribution has length 6
  assert.deepEqual(tallyDistribution(multi, [s1, s2]), [0, 2, 0, 1, 0, 0]);
});

test("quizQuestionsSchema normalizes a mixed legacy+new question array", () => {
  const parsed = quizQuestionsSchema.parse([
    { question: "old", answers: ["a", "b", "c", "d"], correctAnswer: 1, timeLimit: 10 },
    { question: "new", type: "quiz", answerType: "multiple", answers: ["a", "b", "c"], correctAnswers: [0, 2], timeLimit: 30 },
  ]) as any[];
  assert.deepEqual(parsed[0].correctAnswers, [1]);
  assert.equal(parsed[1].answerType, "multiple");
  assert.deepEqual(parsed[1].correctAnswers, [0, 2]);
});
