import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { buildGameReport, buildQuizReport, buildGameReportXlsx, buildQuizReportXlsx, buildGameReportCsv, REPORT_STRINGS, reportSlug } = await import("./reports");

const Q = (question: string, over: Record<string, unknown> = {}) => ({
  question, type: "quiz", answerType: "single", answers: ["a", "b", "c"],
  correctAnswers: [0], timeLimit: 20, points: "standard", ...over,
});
const POLL = (question: string) => Q(question, { type: "poll", correctAnswers: [] });

const quiz = { id: 1, title: "Fire Safety", questions: [Q("q1?"), POLL("p1?"), Q("q2?")] } as any;
const game = (over: Record<string, unknown> = {}) =>
  ({ id: 10, quizId: 1, gamePin: "111111", hostId: 1, status: "completed", questionsSnapshot: null, createdAt: new Date("2026-07-19T10:00:00Z"), ...over }) as any;
const player = (name: string, score: number) => ({ id: 0, gameId: 10, name, score, joinedAt: null }) as any;
const resp = (playerName: string, questionIndex: number, over: Record<string, unknown> = {}) =>
  ({ id: 0, gameId: 10, playerName, questionIndex, selectedAnswer: 0, responseTime: 1000, isCorrect: false, pointsEarned: 0, ...over }) as any;

test("buildGameReport: ranks with shared ties, counts correct answers, computes accuracy over scored questions only", () => {
  const r = buildGameReport({
    quiz, game: game(),
    players: [player("amy", 500), player("bob", 900), player("cat", 500)],
    responses: [
      resp("bob", 0, { isCorrect: true }), resp("bob", 2, { isCorrect: true }),
      resp("amy", 0, { isCorrect: true }), resp("amy", 2, { isCorrect: false }),
      resp("cat", 0, { isCorrect: true }),
      resp("bob", 1, { selectedAnswer: 1 }), // poll response — never counted as correct
    ],
  });
  assert.deepEqual(r.playerRows.map((p) => [p.rank, p.name, p.score]), [[1, "bob", 900], [2, "amy", 500], [2, "cat", 500]]);
  const bob = r.playerRows[0];
  assert.equal(bob.correctCount, 2);
  assert.equal(bob.scoredCount, 2); // 3 questions, 1 is a poll
  assert.equal(bob.accuracy, 1);
  assert.equal(r.summary.playerCount, 3);
  assert.equal(r.summary.questionCount, 3);
  assert.equal(r.summary.avgScore, (900 + 500 + 500) / 3);
});

test("buildGameReport: matrix cells — correct/incorrect/none for scored, chosen label for polls", () => {
  const r = buildGameReport({
    quiz, game: game(),
    players: [player("amy", 100)],
    responses: [resp("amy", 0, { isCorrect: true }), resp("amy", 1, { selectedAnswer: 1 })],
  });
  assert.deepEqual(r.matrix[0][0], { kind: "correct" });
  assert.deepEqual(r.matrix[1][0], { kind: "poll", label: "b" });
  assert.deepEqual(r.matrix[2][0], { kind: "none" });
});

test("buildGameReport: multi-select poll bitmask decodes to joined labels", () => {
  const multiPollQuiz = { ...quiz, questions: [Q("mp?", { type: "poll", answerType: "multiple", correctAnswers: [] })] } as any;
  const r = buildGameReport({
    quiz: multiPollQuiz, game: game(),
    players: [player("amy", 0)],
    responses: [resp("amy", 0, { selectedAnswer: 0b101 })], // bits 0 and 2 → a, c
  });
  assert.deepEqual(r.matrix[0][0], { kind: "poll", label: "a; c" });
});

test("buildGameReport: uses the frozen snapshot when present (quiz has since been edited)", () => {
  const snapshot = [Q("original q1?"), Q("original q2?")];
  const r = buildGameReport({
    quiz: { ...quiz, questions: [Q("EDITED?")] } as any,
    game: game({ questionsSnapshot: snapshot }),
    players: [player("amy", 0)],
    responses: [resp("amy", 1, { isCorrect: true })],
  });
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[0].question, "original q1?");
  assert.deepEqual(r.matrix[1][0], { kind: "correct" });
});

test("buildGameReport: empty game (zero players) yields empty rows, zeroed summary", () => {
  const r = buildGameReport({ quiz, game: game(), players: [], responses: [] });
  assert.equal(r.playerRows.length, 0);
  assert.equal(r.summary.avgScore, 0);
  assert.equal(r.summary.avgAccuracy, 0);
});

test("buildQuizReport: sessions, flat player rows, unique names case-insensitive, date range", () => {
  const g1 = game({ id: 10, gamePin: "111111", createdAt: new Date("2026-07-01T08:00:00Z") });
  const g2 = game({ id: 20, gamePin: "222222", createdAt: new Date("2026-07-15T08:00:00Z") });
  const r = buildQuizReport({
    quiz,
    games: [g1, g2],
    playersByGame: new Map([
      [10, [player("Amy", 300)]],
      [20, [{ ...player("amy", 700), gameId: 20 }, { ...player("bob", 100), gameId: 20 }]],
    ]),
    responsesByGame: new Map([
      [10, [resp("Amy", 0, { isCorrect: true })]],
      [20, [{ ...resp("amy", 0, { isCorrect: true }), gameId: 20 }, { ...resp("bob", 0), gameId: 20 }]],
    ]),
  });
  assert.equal(r.summary.sessionCount, 2);
  assert.equal(r.summary.uniquePlayers, 2); // Amy/amy dedupe
  assert.equal(r.summary.from?.toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(r.summary.to?.toISOString(), "2026-07-15T08:00:00.000Z");
  assert.deepEqual(r.sessionRows.map((s) => [s.gamePin, s.playerCount]), [["111111", 1], ["222222", 2]]);
  assert.equal(r.playerRows.length, 3);
  assert.deepEqual(r.playerRows.map((p) => [p.gamePin, p.name, p.correctCount]), [["111111", "Amy", 1], ["222222", "amy", 1], ["222222", "bob", 0]]);
});

function sampleGameData() {
  return buildGameReport({
    quiz, game: game(),
    players: [player("amy", 500), player("bob", 900)],
    responses: [resp("bob", 0, { isCorrect: true }), resp("amy", 1, { selectedAnswer: 1 })],
  });
}

test("REPORT_STRINGS: AR covers exactly the EN keys", () => {
  assert.deepEqual(Object.keys(REPORT_STRINGS.ar).sort(), Object.keys(REPORT_STRINGS.en).sort());
  for (const v of Object.values(REPORT_STRINGS.ar)) assert.ok(String(v).length > 0);
});

test("game xlsx roundtrip: 3 sheets, frozen bold header, spot cells", async () => {
  const buf = await buildGameReportXlsx(sampleGameData(), "en");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  assert.deepEqual(wb.worksheets.map((w) => w.name), [REPORT_STRINGS.en.sheetSummary, REPORT_STRINGS.en.sheetPlayers, REPORT_STRINGS.en.sheetAnswers]);
  const players = wb.worksheets[1];
  assert.equal(players.getRow(1).getCell(2).text, REPORT_STRINGS.en.player);
  assert.equal(players.getRow(2).getCell(2).text, "bob"); // rank 1 first
  assert.equal(players.getRow(2).getCell(1).text, "1");
  const answers = wb.worksheets[2];
  assert.equal(answers.getRow(2).getCell(2).text, "✓"); // q1 × bob
  assert.equal(answers.getRow(3).getCell(3).text, "b"); // poll × amy chosen label
  assert.equal(answers.getRow(4).getCell(2).text, "—"); // q2 × bob no answer
});

test("quiz xlsx roundtrip: 3 sheets with session and flat player rows", async () => {
  const g1 = game({ id: 10, gamePin: "111111", createdAt: new Date("2026-07-01T08:00:00Z") });
  const data = buildQuizReport({
    quiz, games: [g1],
    playersByGame: new Map([[10, [player("amy", 300)]]]),
    responsesByGame: new Map([[10, [resp("amy", 0, { isCorrect: true })]]]),
  });
  const buf = await buildQuizReportXlsx(data, "ar");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  assert.deepEqual(wb.worksheets.map((w) => w.name), [REPORT_STRINGS.ar.sheetSummary, REPORT_STRINGS.ar.sheetSessions, REPORT_STRINGS.ar.sheetPlayerResults]);
  assert.equal(wb.worksheets[2].getRow(2).getCell(3).text, "amy");
});

test("csv builders: BOM escape prefix, quoting, expected columns", () => {
  const csv = buildGameReportCsv(sampleGameData(), "en");
  assert.ok(csv.startsWith("\uFEFF"));
  const lines = csv.slice(1).split("\r\n").filter(Boolean);
  assert.equal(lines[0].split(",")[1], REPORT_STRINGS.en.player);
  assert.equal(lines.length, 3); // header + 2 players
  assert.match(lines[1], /^1,bob,900,/);
});

test("csv builders neutralize formula-injection player names (OWASP prefix)", () => {
  const data = buildGameReport({
    quiz, game: game(),
    players: [player('=HYPERLINK("http://evil")', 10), player("+cmd", 5)],
    responses: [],
  });
  const csv = buildGameReportCsv(data, "en");
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'+cmd"));
});

test("reportSlug: ascii slug, arabic falls back", () => {
  assert.equal(reportSlug("Fire Safety 101!", "quiz-1"), "fire-safety-101");
  assert.equal(reportSlug("اختبار السلامة", "quiz-7"), "quiz-7");
});
