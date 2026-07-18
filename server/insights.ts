// Pure aggregation core for quiz insights. Attributes each game's responses
// to the QUESTION TEXT the players actually saw (the game's frozen snapshot;
// current quiz as fallback for pre-0010 games) and merges across games keyed
// by trimmed text. Editing a question's text deliberately starts a new row —
// honest history beats fuzzy matching. Duplicate texts within one quiz merge
// into a single row (exact-text key). Question TEXT only — never answer keys.

export interface InsightAgg {
  total: number;
  correct: number;
  msSum: number;
}

export interface GameQuestionData {
  // Question texts this game was played with, by index. null → legacy game
  // (played before migration 0010): attribute via the current quiz's texts.
  snapshotTexts: string[] | null;
  byIndex: Map<number, InsightAgg>;
}

export function mergeInsightQuestions(
  currentTexts: string[],
  perGame: GameQuestionData[],
): Array<{ questionIndex: number; question: string; totalResponses: number; correctRate: number; avgResponseMs: number }> {
  const acc = new Map<string, { label: string; total: number; correct: number; msSum: number }>();
  const order: string[] = [];

  const ensure = (text: string) => {
    const key = text.trim();
    let row = acc.get(key);
    if (!row) {
      row = { label: key, total: 0, correct: 0, msSum: 0 };
      acc.set(key, row);
      order.push(key);
    }
    return row;
  };

  // Seed current-quiz rows first so output order mirrors the quiz as it
  // exists today (including zero-response questions).
  for (const text of currentTexts) ensure(text);

  for (const game of perGame) {
    const texts = game.snapshotTexts ?? currentTexts;
    game.byIndex.forEach((agg, index) => {
      const text = texts[index];
      // Defensive: a response index beyond the known question list has no
      // trustworthy identity — drop it rather than misattribute it.
      if (text === undefined) return;
      const row = ensure(text);
      row.total += agg.total;
      row.correct += agg.correct;
      row.msSum += agg.msSum;
    });
  }

  return order.map((key, questionIndex) => {
    const row = acc.get(key)!;
    return {
      questionIndex, // ordinal row number (API shape compatibility)
      question: row.label,
      totalResponses: row.total,
      correctRate: row.total > 0 ? row.correct / row.total : 0,
      avgResponseMs: row.total > 0 ? row.msSum / row.total : 0,
    };
  });
}
