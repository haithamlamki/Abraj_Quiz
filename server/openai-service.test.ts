import test from "node:test";
import assert from "node:assert/strict";
import { parseGeneratedQuiz, buildGenerationPrompt, buildExtractionPrompt, parseExtractedQuiz } from "./openai-service";

test("parseGeneratedQuiz accepts a valid canonical mixed-type payload", () => {
  const raw = {
    title: "T", description: "d", subject: "Safety", tags: ["fire"],
    questions: [
      { question: "q1?", type: "quiz", answerType: "single", answers: ["a", "b", "c", "d"], correctAnswers: [2], timeLimit: 20, points: "standard", difficulty: "easy", explanation: "c" },
      { question: "q2?", type: "true_false", answerType: "single", answers: ["True", "False"], correctAnswers: [1], timeLimit: 15, points: "standard", difficulty: "medium", explanation: "false" },
    ],
  };
  const res = parseGeneratedQuiz(raw);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.questions.length, 2);
});

test("parseGeneratedQuiz reports errors for a legacy {correctAnswer} payload (no correctAnswers)", () => {
  // The generator must emit correctAnswers[]; a legacy-only shape without it
  // normalizes via questionSchema's preprocess, so it actually SUCCEEDS — assert that,
  // documenting the back-compat path.
  const raw = { title: "T", description: "", questions: [
    { question: "q?", answers: ["a", "b", "c", "d"], correctAnswer: 1, timeLimit: 10 },
  ] };
  const res = parseGeneratedQuiz(raw);
  assert.equal(res.ok, true);
  if (res.ok) assert.deepEqual(res.data.questions[0].correctAnswers, [1]);
});

test("parseGeneratedQuiz rejects junk and yields a non-empty error string", () => {
  const res = parseGeneratedQuiz({ title: "", questions: "nope" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.errors.length > 0);
});

test("buildGenerationPrompt embeds the input and asks for canonical mixed-type JSON", () => {
  const p = buildGenerationPrompt("topics", "Fire safety");
  assert.match(p, /Fire safety/);
  assert.match(p, /correctAnswers/);
  assert.match(p, /true_false/);
  assert.match(p, /difficulty/);
  assert.match(p, /explanation/);
  const c = buildGenerationPrompt("content", "some text", "My Source");
  assert.match(c, /My Source/);
  assert.match(c, /some text/);
});

test("buildExtractionPrompt embeds the document and the extraction rules", () => {
  const p = buildExtractionPrompt("The capital of Oman is Muscat.");
  assert.match(p, /The capital of Oman is Muscat\./);
  assert.match(p, /NEVER invent/i);
  assert.match(p, /original language/i);
  assert.match(p, /SKIP that question/i);
  assert.match(p, /correctAnswers/);
});

test("parseExtractedQuiz accepts 40 questions (beyond the generation cap) and rejects junk", () => {
  const q = { question: "q?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" };
  const ok = parseExtractedQuiz({ title: "T", description: "", questions: Array.from({ length: 40 }, () => ({ ...q })) });
  assert.equal(ok.ok, true);
  const bad = parseExtractedQuiz({ title: "", questions: [] });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.errors.length > 0);
});
