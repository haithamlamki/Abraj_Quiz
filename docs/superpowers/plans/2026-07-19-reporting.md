# Reporting (Compliance Exports) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side Excel/CSV compliance exports of who played and how they scored, at game level and quiz level, downloadable from the quiz-insights page.

**Architecture:** Pure assembly module `server/reports.ts` (mirrors `insights.ts`: receives already-fetched rows, returns report structures + file buffers) behind a thin DI route module `server/report-routes.ts` (the bank/import-routes pattern). One new storage method (`getCompletedQuizGames`). Client is download buttons on `quiz-insights` via a new shared fetch→blob helper. No migration, no new tables, no new dependencies (exceljs reused).

**Tech Stack:** Express 4, exceljs (already installed), Zod-validated existing rows, React 18 + TanStack Query + react-i18next.

**Spec:** `docs/superpowers/specs/2026-07-19-reporting-design.md` — read it before starting.

## Global Constraints

- Work on branch `feat/reporting` (create from `main` in Task 1).
- Gate before every commit: `npm run check && npm test && npm run build` — all pass.
- **No new dependencies.** exceljs is already in package.json from the Import wave. `npm audit --omit=dev` must stay at main's 10 pre-existing advisories.
- **No answer keys in any report cell**: `correctAnswers` / `explanation` never appear. Matrix cells show ✓/✗/— for scored questions; poll cells show the chosen option text only.
- Question set for a game = its frozen `questionsSnapshot`, falling back to the current quiz questions when null (pre-0010 games) — same rule as `insights.ts`.
- Quiz-level reports include **completed games only**. Game-level report on a non-completed game → 409.
- Host/owner gates: game report requires `game.hostId === authUserId`; quiz report reuses the insights ownership check message: `"You can only view insights for your own quizzes"`.
- Storage calls always take a `StorageCtx` via `tctx(req)`.
- Header language via `?lang=ar` (default `en`) from `REPORT_STRINGS` in `server/reports.ts`; a test asserts EN/AR key parity. All new client strings in BOTH `en.json` and `ar.json` (no plurals needed).
- BOM in CSV output is written as the 6-character escape sequence `\uFEFF` in source — NEVER a literal invisible character (recurring transcription hazard; verify with `grep -c 'FEFF' server/reports.ts` after writing).
- Do not modify game engine / websocket / player-facing routes.

---

### Task 1: Branch + storage method `getCompletedQuizGames`

**Files:**
- Modify: `server/storage.ts` (IStorage interface ~line 172; DatabaseStorage games section ~line 535; MemStorage games section ~line 1166)
- Test: `server/storage.test.ts`

**Interfaces:**
- Produces: `getCompletedQuizGames(ctx: StorageCtx, quizId: number): Promise<Game[]>` on IStorage and BOTH implementations — completed games for the quiz, oldest first. Task 4's routes depend on this exact name.

- [ ] **Step 1: Create branch**

```bash
git checkout main && git pull && git checkout -b feat/reporting
```

- [ ] **Step 2: Write the failing test**

Append to `server/storage.test.ts` (it already imports `MemStorage` and has a tenant-1 ctx idiom — reuse the file's existing setup helpers/constants; if it defines a `CTX` or `ctx` constant use that, otherwise `const ctx = { tenantId: 1 } as const;`):

```ts
test("getCompletedQuizGames: only completed games for the quiz, oldest first, tenant-scoped", async () => {
  const s = new MemStorage();
  const ctx = { tenantId: 1 };
  const quiz = await s.createQuiz(ctx, {
    title: "Report quiz", description: "", createdBy: 1, isPublic: false,
    questions: [{ question: "q?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" }],
  } as any);
  const other = await s.createQuiz(ctx, { title: "Other", description: "", createdBy: 1, isPublic: false, questions: [] } as any);

  const g1 = await s.createGame(ctx, { quizId: quiz.id, gamePin: "RPT001", hostId: 1, status: "completed" } as any);
  const g2 = await s.createGame(ctx, { quizId: quiz.id, gamePin: "RPT002", hostId: 1, status: "waiting" } as any);
  const g3 = await s.createGame(ctx, { quizId: quiz.id, gamePin: "RPT003", hostId: 1, status: "completed" } as any);
  await s.createGame(ctx, { quizId: other.id, gamePin: "RPT004", hostId: 1, status: "completed" } as any);

  const rows = await s.getCompletedQuizGames(ctx, quiz.id);
  assert.deepEqual(rows.map((g) => g.gamePin), ["RPT001", "RPT003"]);
  assert.ok(!rows.some((g) => g.id === g2.id));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test server/storage.test.ts`
Expected: FAIL — `getCompletedQuizGames is not a function`.

- [ ] **Step 4: Implement**

In the IStorage interface, directly after `quizHasLiveGame` (~line 172):

```ts
  // Completed games for a quiz, oldest first. Reporting reads these together
  // with each game's players/responses to build compliance exports.
  getCompletedQuizGames(ctx: StorageCtx, quizId: number): Promise<Game[]>;
```

In `DatabaseStorage`, after `getGameByPin` (~line 534), following its exact idiom:

```ts
  async getCompletedQuizGames(ctx: StorageCtx, quizId: number): Promise<Game[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(games)
        .where(and(eq(games.quizId, quizId), eq(games.status, "completed"), tenantFilter(ctx, games.tenantId)))
        .orderBy(games.createdAt);
    });
  }
```

(`orderBy` needs `asc` semantics — Drizzle's default for a bare column is ascending; if the file's other `orderBy` calls use `asc(...)`, import and match that style.)

In `MemStorage`, after its `getGameByPin` (~line 1166):

```ts
  async getCompletedQuizGames(ctx: StorageCtx, quizId: number): Promise<Game[]> {
    return Array.from(this.games.values())
      .filter((g) => g.quizId === quizId && g.status === "completed" && this.inTenant(ctx, g))
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id - b.id);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test server/storage.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the gate and commit**

Run: `npm run check && npm test && npm run build` — all pass, then:

```bash
git add server/storage.ts server/storage.test.ts
git commit -m "feat(reports): getCompletedQuizGames storage method"
```

---

### Task 2: Report data assembly (`buildGameReport`, `buildQuizReport`)

**Files:**
- Create: `server/reports.ts`
- Test: `server/reports.test.ts` (create)

**Interfaces:**
- Consumes: `Game`, `Quiz`, `GamePlayer`, `GameResponse`, `Question` types from `@shared/schema`.
- Produces (exact shapes Tasks 3-4 rely on):

```ts
export interface PlayerRow { rank: number; name: string; score: number; correctCount: number; scoredCount: number; accuracy: number }
export type MatrixCell = { kind: "correct" | "incorrect" | "none" } | { kind: "poll"; label: string };
export interface GameReportData {
  summary: { quizTitle: string; gamePin: string; playedAt: Date | null; playerCount: number; questionCount: number; avgScore: number; avgAccuracy: number };
  playerRows: PlayerRow[];       // rank-ordered
  questions: Question[];          // resolved set (snapshot ?? current quiz)
  matrix: MatrixCell[][];         // [questionIdx][playerRowIdx] — same order as playerRows
}
export interface QuizPlayerRow { playedAt: Date | null; gamePin: string; name: string; score: number; correctCount: number; scoredCount: number; accuracy: number }
export interface QuizReportData {
  summary: { quizTitle: string; sessionCount: number; uniquePlayers: number; avgScore: number; from: Date | null; to: Date | null };
  sessionRows: Array<{ playedAt: Date | null; gamePin: string; playerCount: number; avgScore: number }>;
  playerRows: QuizPlayerRow[];
}
export function buildGameReport(input: { game: Game; quiz: Quiz; players: GamePlayer[]; responses: GameResponse[] }): GameReportData;
export function buildQuizReport(input: { quiz: Quiz; games: Game[]; playersByGame: Map<number, GamePlayer[]>; responsesByGame: Map<number, GameResponse[]> }): QuizReportData;
```

- [ ] **Step 1: Write the failing tests**

Create `server/reports.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { buildGameReport, buildQuizReport } = await import("./reports");

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test server/reports.test.ts`
Expected: FAIL — `./reports` module not found.

- [ ] **Step 3: Implement**

Create `server/reports.ts`:

```ts
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
  for (const r of responses) byPlayerAndQuestion.set(`${r.playerName} ${r.questionIndex}`, r);

  const matrix: MatrixCell[][] = questions.map((q, qi) =>
    playerRows.map((p) => {
      const r = byPlayerAndQuestion.get(`${p.name} ${qi}`);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test server/reports.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the gate and commit**

Run: `npm run check && npm test && npm run build` — all pass, then:

```bash
git add server/reports.ts server/reports.test.ts
git commit -m "feat(reports): pure game/quiz report assembly with snapshot-honest questions"
```

---

### Task 3: File builders (xlsx + csv + header strings)

**Files:**
- Modify: `server/reports.ts`, `server/import-service.ts` (export `csvEscape`)
- Test: `server/reports.test.ts`

**Interfaces:**
- Consumes: Task 2's `GameReportData` / `QuizReportData`; `csvEscape` from `./import-service` (currently module-private — add `export` to it).
- Produces (Task 4 relies on these exact names):
  - `type ReportLang = "en" | "ar"` and `const REPORT_STRINGS: Record<ReportLang, Record<string, string>>`
  - `async function buildGameReportXlsx(data: GameReportData, lang: ReportLang): Promise<Buffer>`
  - `async function buildQuizReportXlsx(data: QuizReportData, lang: ReportLang): Promise<Buffer>`
  - `function buildGameReportCsv(data: GameReportData, lang: ReportLang): string`
  - `function buildQuizReportCsv(data: QuizReportData, lang: ReportLang): string`
  - `function reportSlug(title: string, fallback: string): string`

- [ ] **Step 1: Write the failing tests**

Append to `server/reports.test.ts` (extend the dynamic import destructure with `buildGameReportXlsx, buildQuizReportXlsx, buildGameReportCsv, buildQuizReportCsv, REPORT_STRINGS, reportSlug`):

```ts
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

test("reportSlug: ascii slug, arabic falls back", () => {
  assert.equal(reportSlug("Fire Safety 101!", "quiz-1"), "fire-safety-101");
  assert.equal(reportSlug("اختبار السلامة", "quiz-7"), "quiz-7");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test server/reports.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Export `csvEscape` from import-service**

In `server/import-service.ts`, change `function csvEscape(` to `export function csvEscape(` (no other change).

- [ ] **Step 4: Implement in `server/reports.ts`**

Add `import ExcelJS from "exceljs";` and `import { csvEscape } from "./import-service";` at the top, then append:

```ts
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

function csvLines(rows: string[][]): string {
  return "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
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
```

- [ ] **Step 5: BOM check and run tests**

Run: `grep -c 'FEFF' server/reports.ts` — expected output `1` (the escape text, not an invisible char); also `grep -c 'FEFF' server/reports.test.ts` — expected `1`.
Run: `npx tsx --test server/reports.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Run the gate and commit**

Run: `npm run check && npm test && npm run build` — all pass, then:

```bash
git add server/reports.ts server/reports.test.ts server/import-service.ts
git commit -m "feat(reports): xlsx/csv builders with EN+AR header dictionary"
```

---

### Task 4: Report routes + registration

**Files:**
- Create: `server/report-routes.ts`
- Modify: `server/routes.ts` (registration after `registerImportRoutes`, ~line 692)
- Test: `server/report-routes.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 1-3 exports; `IStorage`, `StorageCtx` from `./storage`; `captureError` from `./instrument`.
- Produces:

```ts
export interface ReportRouteDeps { storage: IStorage; requireAuth: RequestHandler; tctx: (req: any) => StorageCtx }
export function registerReportRoutes(app: Express, deps: ReportRouteDeps): void;
// GET /api/games/:pin/report.xlsx | report.csv   (host-gated, 409 unless completed)
// GET /api/quizzes/:id/report.xlsx | report.csv  (owner-gated)
// ?lang=ar for Arabic headers (default en)
```

- [ ] **Step 1: Write the failing tests**

Create `server/report-routes.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { MemStorage } = await import("./storage");
const { registerReportRoutes } = await import("./report-routes");
const { REPORT_STRINGS } = await import("./reports");

function makeApp(storage: InstanceType<typeof MemStorage>) {
  const app = express();
  const requireAuth = (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ message: "Authentication required" });
    req.authUserId = parseInt(String(uid), 10);
    next();
  };
  registerReportRoutes(app, { storage, requireAuth, tctx: () => ({ tenantId: 1 }) });
  return app;
}

async function withServer(app: express.Express, fn: (base: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const AUTH = { "x-test-user": "1" };

// Seed: quiz owned by user 1 with one completed, played game.
async function seed(s: InstanceType<typeof MemStorage>) {
  const ctx = { tenantId: 1 };
  const quiz = await s.createQuiz(ctx, {
    title: "Report Quiz", description: "", createdBy: 1, isPublic: false,
    questions: [
      { question: "q1?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" },
      { question: "q2?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [1], timeLimit: 20, points: "standard" },
    ],
  } as any);
  const done = await s.createGame(ctx, { quizId: quiz.id, gamePin: "700001", hostId: 1, status: "completed" } as any);
  const open = await s.createGame(ctx, { quizId: quiz.id, gamePin: "700002", hostId: 1, status: "active" } as any);
  const foreign = await s.createGame(ctx, { quizId: quiz.id, gamePin: "700003", hostId: 2, status: "completed" } as any);
  await s.joinGame(ctx, "700001", "amy");
  await s.joinGame(ctx, "700001", "bob");
  await s.setGamePlayerScores(ctx, done.id, [{ name: "amy", score: 800 }, { name: "bob", score: 300 }]);
  await s.createGameResponse(ctx, { gameId: done.id, playerName: "amy", questionIndex: 0, selectedAnswer: 0, responseTime: 900, isCorrect: true, pointsEarned: 800 } as any);
  await s.createGameResponse(ctx, { gameId: done.id, playerName: "bob", questionIndex: 0, selectedAnswer: 1, responseTime: 1200, isCorrect: false, pointsEarned: 0 } as any);
  return { quiz, done, open, foreign };
}

test("report routes: 401 without auth on all four endpoints", async () => {
  const s = new MemStorage();
  const { quiz } = await seed(s);
  await withServer(makeApp(s), async (base) => {
    for (const path of [
      "/api/games/700001/report.xlsx", "/api/games/700001/report.csv",
      `/api/quizzes/${quiz.id}/report.xlsx`, `/api/quizzes/${quiz.id}/report.csv`,
    ]) {
      assert.equal((await fetch(base + path)).status, 401, path);
    }
  });
});

test("game report: 404 unknown pin, 403 non-host, 409 not completed", async () => {
  const s = new MemStorage();
  await seed(s);
  await withServer(makeApp(s), async (base) => {
    assert.equal((await fetch(`${base}/api/games/999999/report.xlsx`, { headers: AUTH })).status, 404);
    assert.equal((await fetch(`${base}/api/games/700003/report.xlsx`, { headers: AUTH })).status, 403);
    assert.equal((await fetch(`${base}/api/games/700002/report.xlsx`, { headers: AUTH })).status, 409);
  });
});

test("game report xlsx: attachment with parseable workbook, ranked players", async () => {
  const s = new MemStorage();
  await seed(s);
  await withServer(makeApp(s), async (base) => {
    const res = await fetch(`${base}/api/games/700001/report.xlsx`, { headers: AUTH });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /spreadsheetml/);
    assert.match(res.headers.get("content-disposition") ?? "", /report-quiz-game-700001-report\.xlsx/);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
    assert.equal(wb.worksheets.length, 3);
    const players = wb.worksheets[1];
    assert.equal(players.getRow(2).getCell(2).text, "amy"); // 800 ranks first
    assert.equal(players.getRow(2).getCell(4).text, "1/2");
  });
});

test("game report csv honors ?lang=ar headers", async () => {
  const s = new MemStorage();
  await seed(s);
  await withServer(makeApp(s), async (base) => {
    const res = await fetch(`${base}/api/games/700001/report.csv?lang=ar`, { headers: AUTH });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    const text = await res.text();
    assert.ok(text.includes(REPORT_STRINGS.ar.player));
  });
});

test("quiz report: 404 unknown, 403 non-owner, xlsx includes only completed games", async () => {
  const s = new MemStorage();
  const { quiz } = await seed(s);
  await withServer(makeApp(s), async (base) => {
    assert.equal((await fetch(`${base}/api/quizzes/424242/report.xlsx`, { headers: AUTH })).status, 404);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/report.xlsx`, { headers: { "x-test-user": "9" } })).status, 403);
    const res = await fetch(`${base}/api/quizzes/${quiz.id}/report.xlsx`, { headers: AUTH });
    assert.equal(res.status, 200);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
    const sessions = wb.worksheets[1];
    const pins: string[] = [];
    sessions.eachRow((row, n) => { if (n > 1) pins.push(row.getCell(2).text); });
    assert.deepEqual(pins.sort(), ["700001", "700003"]); // completed only; active 700002 excluded
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test server/report-routes.test.ts`
Expected: FAIL — `./report-routes` module not found.

- [ ] **Step 3: Implement `server/report-routes.ts`**

```ts
import type { Express, RequestHandler, Response } from "express";
import type { IStorage, StorageCtx } from "./storage";
import {
  buildGameReport, buildQuizReport,
  buildGameReportXlsx, buildQuizReportXlsx,
  buildGameReportCsv, buildQuizReportCsv,
  reportSlug, type GameReportData, type QuizReportData, type ReportLang,
} from "./reports";
import { captureError } from "./instrument";

// Compliance-report routes (bank/import-routes DI pattern). Reads only —
// no new tables; host/owner gates guard the PII-adjacent roster data.
export interface ReportRouteDeps {
  storage: IStorage;
  requireAuth: RequestHandler;
  tctx: (req: any) => StorageCtx;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function langOf(req: any): ReportLang {
  return req.query?.lang === "ar" ? "ar" : "en";
}

function sendFile(res: Response, body: Buffer | string, filename: string, mime: string): void {
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

export function registerReportRoutes(app: Express, { storage, requireAuth, tctx }: ReportRouteDeps): void {
  // Shared loader: resolves + authorizes a game report or writes the error
  // response and returns null.
  async function loadGameReport(req: any, res: Response): Promise<{ data: GameReportData; slug: string } | null> {
    const game = await storage.getGameByPin(tctx(req), req.params.pin);
    if (!game) { res.status(404).json({ message: "Game not found" }); return null; }
    if (game.hostId !== req.authUserId) { res.status(403).json({ message: "Only the game host can download this report" }); return null; }
    if (game.status !== "completed") { res.status(409).json({ message: "This game is not finished yet — reports are available after completion" }); return null; }
    const quiz = await storage.getQuiz(tctx(req), game.quizId);
    if (!quiz) { res.status(404).json({ message: "Quiz not found" }); return null; }
    const [players, responses] = await Promise.all([
      storage.getGamePlayers(tctx(req), game.id),
      storage.getGameResponses(tctx(req), game.id),
    ]);
    return {
      data: buildGameReport({ game, quiz, players, responses }),
      slug: `${reportSlug(quiz.title, `quiz-${quiz.id}`)}-game-${game.gamePin}-report`,
    };
  }

  async function loadQuizReport(req: any, res: Response): Promise<{ data: QuizReportData; slug: string } | null> {
    const quizId = parseInt(req.params.id, 10);
    if (!Number.isInteger(quizId) || quizId <= 0) { res.status(400).json({ message: "Invalid quiz id" }); return null; }
    const quiz = await storage.getQuiz(tctx(req), quizId);
    if (!quiz) { res.status(404).json({ message: "Quiz not found" }); return null; }
    if (quiz.createdBy !== req.authUserId) { res.status(403).json({ message: "You can only view insights for your own quizzes" }); return null; }
    const games = await storage.getCompletedQuizGames(tctx(req), quizId);
    const playersByGame = new Map<number, Awaited<ReturnType<IStorage["getGamePlayers"]>>>();
    const responsesByGame = new Map<number, Awaited<ReturnType<IStorage["getGameResponses"]>>>();
    await Promise.all(games.map(async (g) => {
      const [players, responses] = await Promise.all([
        storage.getGamePlayers(tctx(req), g.id),
        storage.getGameResponses(tctx(req), g.id),
      ]);
      playersByGame.set(g.id, players);
      responsesByGame.set(g.id, responses);
    }));
    return {
      data: buildQuizReport({ quiz, games, playersByGame, responsesByGame }),
      slug: `${reportSlug(quiz.title, `quiz-${quiz.id}`)}-report`,
    };
  }

  app.get("/api/games/:pin/report.xlsx", requireAuth, async (req: any, res) => {
    try {
      const loaded = await loadGameReport(req, res);
      if (!loaded) return;
      sendFile(res, await buildGameReportXlsx(loaded.data, langOf(req)), `${loaded.slug}.xlsx`, XLSX_MIME);
    } catch (error) {
      captureError(error, { scope: "http.game-report" });
      res.status(500).json({ message: "Failed to build the report" });
    }
  });

  app.get("/api/games/:pin/report.csv", requireAuth, async (req: any, res) => {
    try {
      const loaded = await loadGameReport(req, res);
      if (!loaded) return;
      sendFile(res, buildGameReportCsv(loaded.data, langOf(req)), `${loaded.slug}.csv`, "text/csv; charset=utf-8");
    } catch (error) {
      captureError(error, { scope: "http.game-report" });
      res.status(500).json({ message: "Failed to build the report" });
    }
  });

  app.get("/api/quizzes/:id/report.xlsx", requireAuth, async (req: any, res) => {
    try {
      const loaded = await loadQuizReport(req, res);
      if (!loaded) return;
      sendFile(res, await buildQuizReportXlsx(loaded.data, langOf(req)), `${loaded.slug}.xlsx`, XLSX_MIME);
    } catch (error) {
      captureError(error, { scope: "http.quiz-report" });
      res.status(500).json({ message: "Failed to build the report" });
    }
  });

  app.get("/api/quizzes/:id/report.csv", requireAuth, async (req: any, res) => {
    try {
      const loaded = await loadQuizReport(req, res);
      if (!loaded) return;
      sendFile(res, buildQuizReportCsv(loaded.data, langOf(req)), `${loaded.slug}.csv`, "text/csv; charset=utf-8");
    } catch (error) {
      captureError(error, { scope: "http.quiz-report" });
      res.status(500).json({ message: "Failed to build the report" });
    }
  });
}
```

- [ ] **Step 4: Register in `server/routes.ts`**

Add to the route-module imports (next to `registerImportRoutes`, ~line 21):

```ts
import { registerReportRoutes } from "./report-routes";
```

Directly after the `registerImportRoutes(app, { ... });` call block (~line 692):

```ts
  registerReportRoutes(app, { storage, requireAuth, tctx });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test server/report-routes.test.ts` then `npm test`
Expected: PASS — all report-route tests green, nothing else broken. (If `joinGame`/`setGamePlayerScores` signatures differ from the seed helper's assumptions, check `server/storage.ts` lines 164-188 and adapt the SEED ONLY — never the route code.)

- [ ] **Step 6: Run the gate and commit**

Run: `npm run check && npm test && npm run build` — all pass, then:

```bash
git add server/report-routes.ts server/report-routes.test.ts server/routes.ts
git commit -m "feat(reports): game/quiz report endpoints (xlsx/csv, host/owner gated)"
```

---

### Task 5: Shared download helper + i18n strings

**Files:**
- Create: `client/src/lib/download.ts`
- Modify: `client/src/components/bank/ImportDialog.tsx` (refactor `downloadTemplate` to use it)
- Modify: `client/src/locales/en.json`, `client/src/locales/ar.json`

**Interfaces:**
- Produces: `downloadFile(path: string, filename: string): Promise<boolean>` — fetches `buildApiUrl(path)` with credentials, triggers a browser download, returns false on any failure (caller toasts). Task 6 consumes it. New i18n keys `reports.excel`, `reports.csv`, `reports.downloadTitle`, `reports.failedTitle` in both locales.

- [ ] **Step 1: Implement `client/src/lib/download.ts`**

```ts
import { buildApiUrl } from "@/lib/queryClient";

// Fetch an authenticated file endpoint and trigger a browser download.
// fetch→blob→objectURL (not a bare <a href>) so cross-origin cookies work.
// Returns false on ANY failure — including fetch-level rejection — so the
// caller can toast; never throws.
export async function downloadFile(path: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(buildApiUrl(path), { credentials: "include" });
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Refactor `ImportDialog.downloadTemplate`**

In `client/src/components/bank/ImportDialog.tsx`, add `import { downloadFile } from "@/lib/download";` and replace the whole `downloadTemplate` function body with:

```tsx
  const downloadTemplate = async (kind: "xlsx" | "csv") => {
    const ok = await downloadFile(`/api/import/template.${kind}`, `question-import-template.${kind}`);
    if (!ok) toast({ title: t("bank.import.parseFailedTitle"), variant: "destructive" });
  };
```

(If `buildApiUrl` is now unused in the file's imports, remove it from the import statement; it is still used by `runParse` — check before removing.)

- [ ] **Step 3: Add i18n keys**

In `client/src/locales/en.json`, add a new TOP-LEVEL `"reports"` object (alongside `"insights"`):

```json
"reports": {
  "downloadTitle": "Download report",
  "excel": "Excel",
  "csv": "CSV",
  "failedTitle": "Could not download the report"
}
```

In `client/src/locales/ar.json`, same position:

```json
"reports": {
  "downloadTitle": "تنزيل التقرير",
  "excel": "Excel",
  "csv": "CSV",
  "failedTitle": "تعذّر تنزيل التقرير"
}
```

(Mind JSON commas. The locale-parity test enforces identical key sets.)

- [ ] **Step 4: Run the gate and commit**

Run: `npm run check && npm test && npm run build` — all pass (parity test covers the new keys), then:

```bash
git add client/src/lib/download.ts client/src/components/bank/ImportDialog.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(reports): shared download helper + reports i18n strings"
```

---

### Task 6: Insights-page report buttons

**Files:**
- Modify: `client/src/pages/quiz-insights.tsx`

**Interfaces:**
- Consumes: `downloadFile` (Task 5), `reports.*` keys, the four endpoints (Task 4). The insights payload's `recentGames[].gamePin` provides the per-game pins.

- [ ] **Step 1: Implement**

In `client/src/pages/quiz-insights.tsx`:

1. Extend imports:

```tsx
import { ArrowLeft, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadFile } from "@/lib/download";
```

2. Inside the component, after the `useQuery` call, add:

```tsx
  const { toast } = useToast();
  const lang = i18n.language.startsWith("ar") ? "ar" : "en";
  const download = async (path: string, filename: string) => {
    const ok = await downloadFile(`${path}?lang=${lang}`, filename);
    if (!ok) toast({ title: t("reports.failedTitle"), variant: "destructive" });
  };
```

3. In the header row (the `div` with the back button and `<h1>`), append after the `<h1>`:

```tsx
          <div className="ms-auto flex items-center gap-2">
            <span className="text-sm text-gray-500 hidden sm:inline">{t("reports.downloadTitle")}</span>
            <Button variant="outline" size="sm" data-testid="button-quiz-report-xlsx"
              onClick={() => download(`/api/quizzes/${quizId}/report.xlsx`, `quiz-${quizId}-report.xlsx`)}>
              <Download className="w-4 h-4 me-1" /> {t("reports.excel")}
            </Button>
            <Button variant="outline" size="sm" data-testid="button-quiz-report-csv"
              onClick={() => download(`/api/quizzes/${quizId}/report.csv`, `quiz-${quizId}-report.csv`)}>
              <Download className="w-4 h-4 me-1" /> {t("reports.csv")}
            </Button>
          </div>
```

4. In the Recent Games table: add a fourth `<th className="py-2 text-end">{t("reports.downloadTitle")}</th>` after the avg-score header, and in each row after the avg-score `<td>`:

```tsx
                      <td className="py-2 text-end whitespace-nowrap">
                        <Button variant="ghost" size="sm" className="h-7 px-2" data-testid={`button-game-report-xlsx-${g.id}`}
                          onClick={() => download(`/api/games/${g.gamePin}/report.xlsx`, `game-${g.gamePin}-report.xlsx`)}>
                          {t("reports.excel")}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2" data-testid={`button-game-report-csv-${g.id}`}
                          onClick={() => download(`/api/games/${g.gamePin}/report.csv`, `game-${g.gamePin}-report.csv`)}>
                          {t("reports.csv")}
                        </Button>
                      </td>
```

(The server's Content-Disposition supplies the real slugged filename; the `a.download` value here is only the fallback name.)

- [ ] **Step 2: Run the gate and commit**

Run: `npm run check && npm test && npm run build` — all pass, then:

```bash
git add client/src/pages/quiz-insights.tsx
git commit -m "feat(reports): download buttons on quiz insights (quiz + per-game)"
```

---

### Task 7: Push branch + PR

- [ ] **Step 1: Final audit check**

Run: `npm audit --omit=dev`
Expected: the same 10 pre-existing advisories as main — nothing new (no deps were added).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/reporting
gh pr create --title "feat: Reporting — compliance Excel/CSV exports (game + quiz level)" --body "Implements docs/superpowers/specs/2026-07-19-reporting-design.md.

- Pure server/reports.ts assembly (snapshot-honest questions, rank ties, poll-aware matrix) + exceljs xlsx / BOM csv builders with EN+AR header dictionary
- GET /api/games/:pin/report.{xlsx,csv} (host-gated, 409 unless completed) and /api/quizzes/:id/report.{xlsx,csv} (owner-gated), completed games only
- Download buttons on quiz-insights (header = quiz report, Recent Games rows = per-game)
- Shared client download helper (ImportDialog refactored onto it)
- No migration, no new tables, no new deps; no answer keys in any cell

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Report for review**

Whole-branch review + browser QA (real exports in both UI languages, opened in Excel) happen OUTSIDE this plan per the session working method, before merge.
