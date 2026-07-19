import test from "node:test";
import assert from "node:assert/strict";
import {
  blankQuestion, trueFalseQuestion, withRemovedAnswer,
  withToggledCorrect, withType, withAnswerMode, validateQuestion,
} from "./question-form-utils";

test("factories: blank has 4 empty answers; trueFalse preserves text/image/time/points", () => {
  const b = blankQuestion();
  assert.equal(b.answers.length, 4);
  assert.deepEqual(b.correctAnswers, [0]);
  const tf = trueFalseQuestion({ question: "Sky is blue?", timeLimit: 30, points: "double" });
  assert.deepEqual(tf.answers, ["True", "False"]);
  assert.equal(tf.type, "true_false");
  assert.equal(tf.timeLimit, 30);
  assert.equal(tf.points, "double");
});

test("withRemovedAnswer re-maps correct indices and never leaves a scored question with none", () => {
  const q = { ...blankQuestion(), answers: ["a", "b", "c"], correctAnswers: [2] };
  const r = withRemovedAnswer(q, 2);
  assert.deepEqual(r.answers, ["a", "b"]);
  assert.deepEqual(r.correctAnswers, [0]); // backfilled
  const shifted = withRemovedAnswer({ ...q, correctAnswers: [2] }, 0);
  assert.deepEqual(shifted.correctAnswers, [1]); // 2 shifted down past removed 0
  // Guards: min 2 answers, true_false untouched.
  const min = { ...blankQuestion(), answers: ["a", "b"] };
  assert.equal(withRemovedAnswer(min, 0), min);
  const tf = trueFalseQuestion();
  assert.equal(withRemovedAnswer(tf, 0), tf);
  // Poll never backfills a correct answer.
  const poll = withType(blankQuestion(), "poll");
  const pollRemoved = withRemovedAnswer({ ...poll, answers: ["a", "b", "c"] }, 0);
  assert.deepEqual(pollRemoved.correctAnswers, []);
});

test("withToggledCorrect: single replaces; multiple toggles but keeps at least one", () => {
  const single = blankQuestion();
  assert.deepEqual(withToggledCorrect(single, 2).correctAnswers, [2]);
  const multi = { ...blankQuestion(), answerType: "multiple" as const, correctAnswers: [0, 2] };
  assert.deepEqual(withToggledCorrect(multi, 1).correctAnswers, [0, 1, 2]);
  assert.deepEqual(withToggledCorrect(multi, 0).correctAnswers, [2]);
  // Un-toggling the last one keeps it selected.
  const one = { ...multi, correctAnswers: [1] };
  assert.deepEqual(withToggledCorrect(one, 1).correctAnswers, [1]);
});

test("withType and withAnswerMode preserve poll invariant (no correct answers)", () => {
  const q = blankQuestion();
  const poll = withType(q, "poll");
  assert.deepEqual(poll.correctAnswers, []);
  assert.deepEqual(withAnswerMode(poll, "multiple").correctAnswers, []);
  const backToQuiz = withType(poll, "quiz");
  assert.equal(backToQuiz.type, "quiz");
  const single = withAnswerMode({ ...q, answerType: "multiple", correctAnswers: [1, 2] }, "single");
  assert.deepEqual(single.correctAnswers, [1]);
});

test("validateQuestion returns the first violated rule's key, null when valid", () => {
  const valid = { ...blankQuestion(), question: "Q?", answers: ["a", "b"], correctAnswers: [1] };
  assert.equal(validateQuestion(valid), null);
  assert.equal(validateQuestion({ ...valid, question: "  " }), "needsText");
  assert.equal(validateQuestion({ ...valid, answers: ["a"] }), "needsTwoAnswers");
  assert.equal(validateQuestion({ ...valid, answers: ["a", " "] }), "emptyAnswer");
  assert.equal(validateQuestion({ ...valid, correctAnswers: [] }), "needsCorrectAnswer");
  assert.equal(validateQuestion({ ...valid, correctAnswers: [0, 1] }), "singleSelectOneCorrect");
  // Polls skip correctness rules.
  const poll = { ...withType(valid, "poll"), question: "P?" };
  assert.equal(validateQuestion(poll), null);
});

test("sourceQuestionId provenance survives type switches (incl. true_false)", () => {
  const q = { ...blankQuestion(), question: "Q?", sourceQuestionId: 42 };
  assert.equal(withType(q, "true_false").sourceQuestionId, 42);
  assert.equal(withType(withType(q, "true_false"), "quiz").sourceQuestionId, 42);
  assert.equal(withType(q, "poll").sourceQuestionId, 42);
  // Absent stays absent — no undefined-to-null drift.
  assert.equal(withType(blankQuestion(), "true_false").sourceQuestionId, undefined);
});
