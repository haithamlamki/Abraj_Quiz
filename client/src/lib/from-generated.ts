import { questionSchema, type Question } from "@shared/schema";

// AI generations are already canonical (server validates generatedQuizSchema).
// Parse each through questionSchema — this also normalizes any legacy
// {correctAnswer} shape from a cached older server response during deploy
// overlap — and drop anything that fails rather than crashing the dialog.
export function normalizeGeneratedQuestions(raw: unknown[]): Question[] {
  if (!Array.isArray(raw)) return [];
  const out: Question[] = [];
  for (const item of raw) {
    const parsed = questionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
