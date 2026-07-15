import type { Question } from "./schema";

// Answer-selection encoding (shared by the game engine and the play view):
//  - single-select: the stored `selectedAnswer` IS the chosen index (0..n-1) —
//    unchanged from the pre-revamp behavior, so historical rows stay valid.
//  - multi-select: `selectedAnswer` is a BITMASK of the chosen indices
//    (bit i set ⇒ option i chosen), which fits the existing integer column.

type ScoringQuestion = Pick<Question, "answerType" | "answers" | "correctAnswers">;

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
  const selected = decodeSelection(question.answerType, selectedAnswer);
  const correct = question.correctAnswers;
  if (question.answerType === "multiple") {
    if (selected.length !== correct.length) return false;
    const correctSet = new Set(correct);
    return selected.every((i) => correctSet.has(i));
  }
  return selected.length === 1 && correct.includes(selected[0]);
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
