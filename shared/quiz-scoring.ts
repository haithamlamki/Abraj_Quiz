import type { Question } from "./schema";

// Answer-selection encoding (shared by the game engine and the play view):
//  - single-select: the stored `selectedAnswer` IS the chosen index (0..n-1) —
//    unchanged from the pre-revamp behavior, so historical rows stay valid.
//  - multi-select: `selectedAnswer` is a BITMASK of the chosen indices
//    (bit i set ⇒ option i chosen), which fits the existing integer column.

type ScoringQuestion = Pick<Question, "answerType" | "answers" | "correctAnswers"> & Partial<Pick<Question, "type">>;

export function decodeSelection(answerType: Question["answerType"], selectedAnswer: number): number[] {
  if (answerType === "multiple") {
    const indices: number[] = [];
    for (let i = 0; i < 30; i++) {
      if (selectedAnswer & (1 << i)) indices.push(i);
    }
    return indices;
  }
  return [selectedAnswer];
}

export function encodeSelection(answerType: Question["answerType"], indices: number[]): number {
  if (answerType === "multiple") {
    return indices.reduce((mask, i) => mask | (1 << i), 0);
  }
  return indices.length > 0 ? indices[0] : -1;
}

// All-or-nothing correctness (Kahoot-style): a multi-select answer scores only
// when the chosen set EXACTLY equals the correct set.
export function isSelectionCorrect(question: ScoringQuestion, selectedAnswer: number): boolean {
  // Polls have no correct answer — they're a tally, not a scored question.
  if (question.type === "poll") return false;
  const selected = decodeSelection(question.answerType, selectedAnswer);
  const correct = question.correctAnswers;
  if (question.answerType === "multiple") {
    if (selected.length !== correct.length) return false;
    const correctSet = new Set(correct);
    return selected.every((i) => correctSet.has(i));
  }
  return selected.length === 1 && correct.includes(selected[0]);
}

// Consecutive-correct-answer bonus: x1.0 on the first correct answer of a
// streak, +0.1 per additional consecutive correct answer, capped at x1.5
// (i.e. streak 6+). Defensive: a streak of 0 or negative (no streak yet /
// just broken) is treated like a first answer, never a discount below x1.0.
export function streakMultiplier(streak: number): number {
  return 1 + 0.1 * Math.min(Math.max(streak, 1) - 1, 5);
}

// Per-option vote counts, sized to the question's answer count. Multi-select
// selections contribute to each chosen option.
export function tallyDistribution(question: ScoringQuestion, selections: number[]): number[] {
  const counts = new Array(question.answers.length).fill(0);
  for (const sel of selections) {
    for (const idx of decodeSelection(question.answerType, sel)) {
      if (idx >= 0 && idx < counts.length) counts[idx]++;
    }
  }
  return counts;
}
