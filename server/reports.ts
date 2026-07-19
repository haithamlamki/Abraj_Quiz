// Pure assembly core for compliance reports (mirrors insights.ts: no HTTP, no
// storage — receives already-fetched rows, returns report structures). A
// game's question set is its frozen snapshot (current quiz as fallback for
// pre-0010 games), so historical reports stay honest after quiz edits.
// NEVER include answer keys: cells carry outcomes (✓/✗/—) or, for polls, the
// option the player chose — the completed-game reveal boundary.
import type { Game, GamePlayer, GameResponse, Question, Quiz } from "@shared/schema";

export interface PlayerRow { rank: number; name: string; score: number; correctCount: number; scoredCount: number; accuracy: number }
export type MatrixCell = { kind: "correct" | "incorrect" | "none" } | { kind: "poll"; label: string };

export interface GameReportData {
  summary: { quizTitle: string; gamePin: string; playedAt: Date | null; playerCount: number; questionCount: number; avgScore: number; avgAccuracy: number };
  playerRows: PlayerRow[];
  questions: Question[];
  matrix: MatrixCell[][];
}

export interface QuizPlayerRow { playedAt: Date | null; gamePin: string; name: string; score: number; correctCount: number; scoredCount: number; accuracy: number }

export interface QuizReportData {
  summary: { quizTitle: string; sessionCount: number; uniquePlayers: number; avgScore: number; from: Date | null; to: Date | null };
  sessionRows: Array<{ playedAt: Date | null; gamePin: string; playerCount: number; avgScore: number }>;
  playerRows: QuizPlayerRow[];
}

function resolveQuestions(game: Game, quiz: Quiz): Question[] {
  const snap = game.questionsSnapshot;
  if (Array.isArray(snap) && snap.length > 0) return snap as Question[];
  return Array.isArray(quiz.questions) ? (quiz.questions as Question[]) : [];
}

// What the player picked, as option text. Multi-select answers are stored as
// a bitmask; single-select as an index.
function selectionLabel(q: Question, selected: number): string {
  if (q.answerType === "multiple") {
    const picked = q.answers.filter((_, i) => (selected & (1 << i)) !== 0);
    return picked.length > 0 ? picked.join("; ") : String(selected);
  }
  return q.answers[selected] ?? String(selected);
}

// Standard competition ranking over descending score: 1,2,2,4.
function rankRows<T extends { score: number }>(rows: T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  let lastScore: number | null = null;
  let lastRank = 0;
  return sorted.map((row, i) => {
    const rank = row.score === lastScore ? lastRank : i + 1;
    lastScore = row.score;
    lastRank = rank;
    return { ...row, rank };
  });
}

function perPlayerCorrect(questions: Question[], responses: GameResponse[]): Map<string, number> {
  const correct = new Map<string, number>();
  for (const r of responses) {
    const q = questions[r.questionIndex];
    if (!q || q.type === "poll" || !r.isCorrect) continue;
    correct.set(r.playerName, (correct.get(r.playerName) ?? 0) + 1);
  }
  return correct;
}

export function buildGameReport(input: { game: Game; quiz: Quiz; players: GamePlayer[]; responses: GameResponse[] }): GameReportData {
  const { game, quiz, players, responses } = input;
  const questions = resolveQuestions(game, quiz);
  const scoredCount = questions.filter((q) => q.type !== "poll").length;
  const correctByName = perPlayerCorrect(questions, responses);

  const playerRows = rankRows(
    players.map((p) => {
      const correctCount = correctByName.get(p.name) ?? 0;
      return {
        name: p.name,
        score: p.score,
        correctCount,
        scoredCount,
        accuracy: scoredCount > 0 ? correctCount / scoredCount : 0,
      };
    }),
  );

  const byPlayerAndQuestion = new Map<string, GameResponse>();
  for (const r of responses) byPlayerAndQuestion.set(`${r.playerName} ${r.questionIndex}`, r);

  const matrix: MatrixCell[][] = questions.map((q, qi) =>
    playerRows.map((p) => {
      const r = byPlayerAndQuestion.get(`${p.name} ${qi}`);
      if (!r) return { kind: "none" as const };
      if (q.type === "poll") return { kind: "poll" as const, label: selectionLabel(q, r.selectedAnswer) };
      return { kind: r.isCorrect ? ("correct" as const) : ("incorrect" as const) };
    }),
  );

  const avg = (nums: number[]) => (nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
  return {
    summary: {
      quizTitle: quiz.title,
      gamePin: game.gamePin,
      playedAt: game.createdAt ?? null,
      playerCount: players.length,
      questionCount: questions.length,
      avgScore: avg(playerRows.map((p) => p.score)),
      avgAccuracy: avg(playerRows.map((p) => p.accuracy)),
    },
    playerRows,
    questions,
    matrix,
  };
}

export function buildQuizReport(input: { quiz: Quiz; games: Game[]; playersByGame: Map<number, GamePlayer[]>; responsesByGame: Map<number, GameResponse[]> }): QuizReportData {
  const { quiz, games, playersByGame, responsesByGame } = input;
  const sessionRows: QuizReportData["sessionRows"] = [];
  const playerRows: QuizPlayerRow[] = [];
  const uniqueNames = new Set<string>();

  for (const game of games) {
    const players = playersByGame.get(game.id) ?? [];
    const responses = responsesByGame.get(game.id) ?? [];
    const questions = resolveQuestions(game, quiz);
    const scoredCount = questions.filter((q) => q.type !== "poll").length;
    const correctByName = perPlayerCorrect(questions, responses);

    const avgScore = players.length > 0 ? players.reduce((a, p) => a + p.score, 0) / players.length : 0;
    sessionRows.push({ playedAt: game.createdAt ?? null, gamePin: game.gamePin, playerCount: players.length, avgScore });

    for (const p of players) {
      uniqueNames.add(p.name.trim().toLowerCase());
      const correctCount = correctByName.get(p.name) ?? 0;
      playerRows.push({
        playedAt: game.createdAt ?? null,
        gamePin: game.gamePin,
        name: p.name,
        score: p.score,
        correctCount,
        scoredCount,
        accuracy: scoredCount > 0 ? correctCount / scoredCount : 0,
      });
    }
  }

  const dates = games.map((g) => g.createdAt).filter((d): d is Date => d instanceof Date);
  return {
    summary: {
      quizTitle: quiz.title,
      sessionCount: games.length,
      uniquePlayers: uniqueNames.size,
      avgScore: playerRows.length > 0 ? playerRows.reduce((a, p) => a + p.score, 0) / playerRows.length : 0,
      from: dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
      to: dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
    },
    sessionRows,
    playerRows,
  };
}
