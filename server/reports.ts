// Pure assembly core for compliance reports (mirrors insights.ts: no HTTP, no
// storage — receives already-fetched rows, returns report structures). A
// game's question set is its frozen snapshot (current quiz as fallback for
// pre-0010 games), so historical reports stay honest after quiz edits.
// NEVER include answer keys: cells carry outcomes (✓/✗/—) or, for polls, the
// option the player chose — the completed-game reveal boundary.
import type { Game, GamePlayer, GameResponse, Question, Quiz } from "@shared/schema";
import ExcelJS from "exceljs";
import { csvEscape } from "./import-service";

export interface PlayerRow { rank: number; name: string; score: number; correctCount: number; scoredCount: number; accuracy: number }
export type MatrixCell = { kind: "correct" | "incorrect" | "none" } | { kind: "poll"; label: string };

export interface GameReportData {
  summary: { quizTitle: string; gamePin: string; playedAt: Date | null; playerCount: number; questionCount: number; avgScore: number; avgAccuracy: number };
  playerRows: PlayerRow[];
  // Full Question objects (incl. answer keys) for INTERNAL builder use only —
  // never serialize GameReportData itself to a client (questions_snapshot lesson).
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

export type ReportLang = "en" | "ar";

// Report header/label strings. Data cells (names, question text) stay in
// whatever language they already are — this dictionary covers ONLY the
// generated file's own labels. A test asserts EN/AR key parity.
export const REPORT_STRINGS: Record<ReportLang, Record<string, string>> = {
  en: {
    sheetSummary: "Summary", sheetPlayers: "Players", sheetAnswers: "Answers",
    sheetSessions: "Sessions", sheetPlayerResults: "Player Results",
    quizTitle: "Quiz", gamePin: "Game PIN", playedAt: "Date",
    playerCount: "Players", questionCount: "Questions",
    avgScore: "Average score", avgAccuracy: "Average accuracy",
    sessionCount: "Sessions", uniquePlayers: "Unique players", dateRange: "Date range",
    rank: "Rank", player: "Player", score: "Score", correct: "Correct",
    accuracy: "Accuracy", question: "Question", session: "Session",
    identityNote: "Player names are self-reported at join time.",
  },
  ar: {
    sheetSummary: "الملخص", sheetPlayers: "اللاعبون", sheetAnswers: "الإجابات",
    sheetSessions: "الجلسات", sheetPlayerResults: "نتائج اللاعبين",
    quizTitle: "الاختبار", gamePin: "رمز اللعبة", playedAt: "التاريخ",
    playerCount: "اللاعبون", questionCount: "الأسئلة",
    avgScore: "متوسط النقاط", avgAccuracy: "متوسط الدقة",
    sessionCount: "الجلسات", uniquePlayers: "اللاعبون الفريدون", dateRange: "الفترة الزمنية",
    rank: "الترتيب", player: "اللاعب", score: "النقاط", correct: "إجابات صحيحة",
    accuracy: "الدقة", question: "السؤال", session: "الجلسة",
    identityNote: "أسماء اللاعبين مُدخلة ذاتيًا عند الانضمام.",
  },
};

const CELL_MARK = { correct: "✓", incorrect: "✗", none: "—" } as const;

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : "—";
}
function fmtPct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function addHeaderRow(ws: ExcelJS.Worksheet, cells: string[]): void {
  const row = ws.addRow(cells);
  row.font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function addSummarySheet(wb: ExcelJS.Workbook, s: Record<string, string>, pairs: Array<[string, string]>, note: string): void {
  const ws = wb.addWorksheet(s.sheetSummary);
  for (const [label, value] of pairs) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  ws.addRow([]);
  ws.addRow([note]);
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 40;
}

export async function buildGameReportXlsx(data: GameReportData, lang: ReportLang): Promise<Buffer> {
  const s = REPORT_STRINGS[lang];
  const wb = new ExcelJS.Workbook();

  addSummarySheet(wb, s, [
    [s.quizTitle, data.summary.quizTitle],
    [s.gamePin, data.summary.gamePin],
    [s.playedAt, fmtDate(data.summary.playedAt)],
    [s.playerCount, String(data.summary.playerCount)],
    [s.questionCount, String(data.summary.questionCount)],
    [s.avgScore, String(Math.round(data.summary.avgScore))],
    [s.avgAccuracy, fmtPct(data.summary.avgAccuracy)],
  ], s.identityNote);

  const players = wb.addWorksheet(s.sheetPlayers);
  addHeaderRow(players, [s.rank, s.player, s.score, s.correct, s.accuracy]);
  for (const p of data.playerRows) {
    players.addRow([p.rank, p.name, p.score, `${p.correctCount}/${p.scoredCount}`, fmtPct(p.accuracy)]);
  }
  players.columns.forEach((c) => { c.width = 16; });
  players.getColumn(2).width = 28;

  const answers = wb.addWorksheet(s.sheetAnswers);
  addHeaderRow(answers, [s.question, ...data.playerRows.map((p) => p.name)]);
  data.questions.forEach((q, qi) => {
    answers.addRow([q.question, ...data.matrix[qi].map((cell) => (cell.kind === "poll" ? cell.label : CELL_MARK[cell.kind]))]);
  });
  answers.getColumn(1).width = 50;
  for (let c = 2; c <= data.playerRows.length + 1; c++) answers.getColumn(c).width = 14;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildQuizReportXlsx(data: QuizReportData, lang: ReportLang): Promise<Buffer> {
  const s = REPORT_STRINGS[lang];
  const wb = new ExcelJS.Workbook();

  addSummarySheet(wb, s, [
    [s.quizTitle, data.summary.quizTitle],
    [s.sessionCount, String(data.summary.sessionCount)],
    [s.uniquePlayers, String(data.summary.uniquePlayers)],
    [s.avgScore, String(Math.round(data.summary.avgScore))],
    [s.dateRange, `${fmtDate(data.summary.from)} – ${fmtDate(data.summary.to)}`],
  ], s.identityNote);

  const sessions = wb.addWorksheet(s.sheetSessions);
  addHeaderRow(sessions, [s.playedAt, s.gamePin, s.playerCount, s.avgScore]);
  for (const row of data.sessionRows) {
    sessions.addRow([fmtDate(row.playedAt), row.gamePin, row.playerCount, Math.round(row.avgScore)]);
  }
  sessions.columns.forEach((c) => { c.width = 18; });

  const results = wb.addWorksheet(s.sheetPlayerResults);
  addHeaderRow(results, [s.playedAt, s.session, s.player, s.score, s.correct, s.accuracy]);
  for (const p of data.playerRows) {
    results.addRow([fmtDate(p.playedAt), p.gamePin, p.name, p.score, `${p.correctCount}/${p.scoredCount}`, fmtPct(p.accuracy)]);
  }
  results.columns.forEach((c) => { c.width = 18; });
  results.getColumn(3).width = 28;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// OWASP CSV-injection mitigation: Excel evaluates cells beginning with
// = + - @ even when quoted, and player names are player-controlled. Prefix
// a leading apostrophe (Excel's text marker). The xlsx path is immune \u2014
// exceljs writes inline strings, never formulas.
function csvCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvLines(rows: string[][]): string {
  return "\uFEFF" + rows.map((r) => r.map((c) => csvEscape(csvCell(c))).join(",")).join("\r\n") + "\r\n";
}

export function buildGameReportCsv(data: GameReportData, lang: ReportLang): string {
  const s = REPORT_STRINGS[lang];
  return csvLines([
    [s.rank, s.player, s.score, s.correct, s.accuracy],
    ...data.playerRows.map((p) => [String(p.rank), p.name, String(p.score), `${p.correctCount}/${p.scoredCount}`, fmtPct(p.accuracy)]),
  ]);
}

export function buildQuizReportCsv(data: QuizReportData, lang: ReportLang): string {
  const s = REPORT_STRINGS[lang];
  return csvLines([
    [s.playedAt, s.session, s.player, s.score, s.correct, s.accuracy],
    ...data.playerRows.map((p) => [fmtDate(p.playedAt), p.gamePin, p.name, String(p.score), `${p.correctCount}/${p.scoredCount}`, fmtPct(p.accuracy)]),
  ]);
}

// ASCII-safe filename slug; Arabic titles slug to empty → fallback.
export function reportSlug(title: string, fallback: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}
