import type { Question } from "@shared/schema";

export function blankQuestion(): Question {
  return {
    question: "",
    type: "quiz",
    answerType: "single",
    answers: ["", "", "", ""],
    correctAnswers: [0],
    timeLimit: 20,
    points: "standard",
  };
}

export function trueFalseQuestion(existing?: Partial<Question>): Question {
  return {
    question: existing?.question ?? "",
    imageUrl: existing?.imageUrl,
    type: "true_false",
    answerType: "single",
    answers: ["True", "False"],
    correctAnswers: [0],
    timeLimit: existing?.timeLimit ?? 20,
    points: existing?.points ?? "standard",
    // Preserve bank provenance across type switches (old patchQuestion-merge
    // behavior); dropping it would sever the copied-from-bank link.
    sourceQuestionId: existing?.sourceQuestionId,
  };
}

export function withAnswerText(q: Question, answerIndex: number, value: string): Question {
  return { ...q, answers: q.answers.map((a, i) => (i === answerIndex ? value : a)) };
}

export function withAddedAnswer(q: Question): Question {
  if (q.answers.length >= 6 || q.type === "true_false") return q;
  return { ...q, answers: [...q.answers, ""] };
}

export function withRemovedAnswer(q: Question, answerIndex: number): Question {
  if (q.answers.length <= 2 || q.type === "true_false") return q;
  const answers = q.answers.filter((_, i) => i !== answerIndex);
  // Re-map correct indices after removal.
  const correctAnswers = q.correctAnswers
    .filter((ci) => ci !== answerIndex)
    .map((ci) => (ci > answerIndex ? ci - 1 : ci));
  return {
    ...q,
    answers,
    // Polls must never have correct answers; never backfill [0] for them.
    correctAnswers: q.type === "poll" ? [] : correctAnswers.length ? correctAnswers : [0],
  };
}

export function withToggledCorrect(q: Question, answerIndex: number): Question {
  if (q.answerType === "single") {
    return { ...q, correctAnswers: [answerIndex] };
  }
  const set = new Set(q.correctAnswers);
  if (set.has(answerIndex)) set.delete(answerIndex);
  else set.add(answerIndex);
  const next = Array.from(set).sort((a, b) => a - b);
  return { ...q, correctAnswers: next.length ? next : [answerIndex] };
}

export function withType(q: Question, type: Question["type"]): Question {
  if (type === "true_false") return trueFalseQuestion(q);
  if (type === "poll") {
    return { ...q, type: "poll", answers: q.answers.length >= 2 ? q.answers : ["", "", "", ""], correctAnswers: [] };
  }
  return {
    ...q,
    type: "quiz",
    answers: q.answers.length >= 2 ? q.answers : ["", "", "", ""],
    correctAnswers: q.correctAnswers.length ? q.correctAnswers : [0],
  };
}

export function withAnswerMode(q: Question, answerType: Question["answerType"]): Question {
  if (q.type === "poll") {
    // Polls must never have correct answers, regardless of answer mode.
    return { ...q, answerType, correctAnswers: [] };
  }
  if (answerType === "single") {
    return { ...q, answerType, correctAnswers: [q.correctAnswers[0] ?? 0] };
  }
  return { ...q, answerType };
}

export type QuestionValidationKey =
  | "needsText"
  | "needsTwoAnswers"
  | "emptyAnswer"
  | "needsCorrectAnswer"
  | "singleSelectOneCorrect";

// Mirrors the editor's per-question save validation, returning the FIRST
// violated rule so callers map it to a localized message.
export function validateQuestion(q: Question): QuestionValidationKey | null {
  if (!q.question.trim()) return "needsText";
  if (q.answers.length < 2) return "needsTwoAnswers";
  if (q.answers.some((a) => !a.trim())) return "emptyAnswer";
  if (q.type !== "poll") {
    if (q.correctAnswers.length === 0) return "needsCorrectAnswer";
    if (q.answerType === "single" && q.correctAnswers.length !== 1) return "singleSelectOneCorrect";
  }
  return null;
}
