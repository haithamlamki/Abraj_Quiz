import test from "node:test";
import assert from "node:assert/strict";
import { mergeInsightQuestions, type GameQuestionData } from "./insights";

const agg = (total: number, correct: number, msSum: number) => ({ total, correct, msSum });

test("current-quiz rows come first (quiz order, zero-response included); historical rows appended", () => {
  const perGame: GameQuestionData[] = [
    { snapshotTexts: ["Old-A", "Kept-B"], byIndex: new Map([[0, agg(2, 2, 3000)], [1, agg(2, 0, 4000)]]) },
  ];
  const rows = mergeInsightQuestions(["Kept-B", "New-C"], perGame);
  assert.deepEqual(rows.map((r) => r.question), ["Kept-B", "New-C", "Old-A"]);
  assert.deepEqual(rows.map((r) => r.questionIndex), [0, 1, 2]); // ordinal
  const byText = Object.fromEntries(rows.map((r) => [r.question, r]));
  assert.equal(byText["Kept-B"].totalResponses, 2);   // attributed via snapshot index 1
  assert.equal(byText["Kept-B"].correctRate, 0);
  assert.equal(byText["Kept-B"].avgResponseMs, 2000);
  assert.equal(byText["Old-A"].totalResponses, 2);    // historical text keeps its stats
  assert.equal(byText["Old-A"].correctRate, 1);
  assert.equal(byText["New-C"].totalResponses, 0);    // never played
});

test("same text merges across games with weighted rates; trimming collapses whitespace variants", () => {
  const perGame: GameQuestionData[] = [
    { snapshotTexts: ["Q1"], byIndex: new Map([[0, agg(3, 3, 3000)]]) },
    { snapshotTexts: ["  Q1  "], byIndex: new Map([[0, agg(1, 0, 5000)]]) },
  ];
  const rows = mergeInsightQuestions(["Q1"], perGame);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalResponses, 4);
  assert.equal(rows[0].correctRate, 0.75);
  assert.equal(rows[0].avgResponseMs, 2000);
});

test("null snapshot falls back to current-quiz index attribution (legacy behavior)", () => {
  const perGame: GameQuestionData[] = [
    { snapshotTexts: null, byIndex: new Map([[0, agg(1, 1, 1000)], [1, agg(1, 0, 2000)]]) },
  ];
  const rows = mergeInsightQuestions(["First", "Second"], perGame);
  assert.equal(rows[0].question, "First");
  assert.equal(rows[0].correctRate, 1);
  assert.equal(rows[1].question, "Second");
  assert.equal(rows[1].correctRate, 0);
});

test("responses beyond the known question list are dropped, not misattributed", () => {
  const perGame: GameQuestionData[] = [
    { snapshotTexts: ["Only"], byIndex: new Map([[0, agg(1, 1, 100)], [7, agg(9, 9, 900)]]) },
  ];
  const rows = mergeInsightQuestions(["Only"], perGame);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalResponses, 1);
});

test("empty inputs: no games and no questions → empty rows; questions but no games → zeroed rows", () => {
  assert.deepEqual(mergeInsightQuestions([], []), []);
  const rows = mergeInsightQuestions(["A"], []);
  assert.deepEqual(rows, [{ questionIndex: 0, question: "A", totalResponses: 0, correctRate: 0, avgResponseMs: 0 }]);
});
