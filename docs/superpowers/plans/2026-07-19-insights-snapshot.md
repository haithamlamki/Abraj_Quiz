# Insights Question-Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-game question snapshots so editing a quiz stops misattributing historical insights stats, per `docs/superpowers/specs/2026-07-19-insights-snapshot-design.md`.

**Architecture:** Additive `games.questions_snapshot` jsonb column (migration 0010), written ONCE at runtime-room hydration (`game-room-manager.ts` — the exact questions played); rooms prefer an existing snapshot on rehydration. A new pure module `server/insights.ts` merges per-game aggregates keyed by trimmed question text (current-quiz rows first, historical rows appended); both `getQuizInsights` implementations delegate to it. API shape unchanged → zero client changes.

**Tech Stack:** Drizzle ORM + hand-written SQL migration, node:test (unit), Vitest (integration), TypeScript.

## Global Constraints

- Additive-only schema; the new column rides the existing `games` `tenant_isolation` RLS policy (row policy covers all columns — same rationale as migration 0008). NO backfill.
- Never write to DB on timer ticks — the one new write happens once, at room hydration, inside `getOrCreateRoom`.
- Game engine uses `SYSTEM_CTX` (existing pattern in `game-room-manager.ts`); request paths keep `tctx(req)`.
- `QuizInsights` response shape is UNCHANGED (same field names/types; `questionIndex` becomes the ordinal row number). Zero client changes.
- Aggregation key = **trimmed question text**. Row order: current quiz's questions in quiz order (zero-response rows included), then historical texts in first-seen order. NULL snapshot → attribute that game via the current quiz by index (legacy fallback).
- Question TEXT only in insights — never answer keys.
- Run `npm run check && npm test && npm run build` before EVERY commit. One PR: branch `feat/insights-question-snapshot`.
- Windows; the Bash tool runs Git Bash. Repo root: `C:\projects\PDO Quiz\Abraj_Quiz`.

---

### Task 1: Schema + migration 0010 + Mem createGame default + integration column test

**Files:**
- Modify: `shared/schema.ts` (games table, ~line 92–108)
- Create: `migrations/0010_game_question_snapshot.sql`
- Modify: `server/storage.ts` MemStorage `createGame` (~line 1115)
- Create: `tests/integration/game-snapshot-migration.test.ts`

**Interfaces:**
- Produces: `Game.questionsSnapshot: Question[] | null` (Drizzle `$type`) — consumed by Tasks 3–5 via `game.questionsSnapshot` reads and `updateGame(ctx, id, { questionsSnapshot })` writes (no `updateGame` signature change; it already takes `Partial<Game>`).

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/insights-question-snapshot
```

- [ ] **Step 2: Add the column to the `games` table in `shared/schema.ts`** — after the `players` column (line ~106), add:

```ts
  // Frozen copy of the quiz's questions captured ONCE at first runtime-room
  // hydration — the exact set this game's players saw. Insights attribute
  // historical responses against THIS, not the live (editable) quiz row, and
  // room rehydration after a restart replays it so a mid-game quiz edit can't
  // swap questions under an in-flight game. NULL for games played before
  // migration 0010 (insights fall back to current-quiz index attribution).
  questionsSnapshot: jsonb("questions_snapshot").$type<Question[] | null>(),
```

(`Question` is defined lower in the file — fine, type positions don't require declaration order. `jsonb` is already imported.)

- [ ] **Step 3: Write `migrations/0010_game_question_snapshot.sql`**

```sql
-- 0010_game_question_snapshot.sql — per-game frozen question set.
-- Captured once at runtime-room hydration (game-room-manager.ts); insights
-- attribute historical responses against this instead of the live quiz row.
-- Nullable and backward-compatible: pre-0010 games read as NULL (insights
-- fall back to current-quiz index attribution — the old behavior). Covered
-- by the existing games tenant_isolation RLS policy (row policy applies to
-- all columns), same rationale as 0008.
ALTER TABLE games ADD COLUMN IF NOT EXISTS questions_snapshot jsonb;
```

- [ ] **Step 4: MemStorage `createGame` (server/storage.ts ~line 1115): add the field to the constructed Game** — inside the object literal after `players: [],`:

```ts
      questionsSnapshot: null,
```

- [ ] **Step 5: Write `tests/integration/game-snapshot-migration.test.ts`** (mirrors the 0009 test's structure; schema assertion only, no data writes):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { endPool } from "./helpers";

// Verifies migration 0010_game_question_snapshot.sql. Run AFTER applying:
//   psql "$DATABASE_URL" -f migrations/0010_game_question_snapshot.sql
// then:  npm run integration

async function sys<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.role', 'system', true)");
    const res = await client.query(sql, params);
    await client.query("commit");
    return res.rows as T[];
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

describe("migration 0010_game_question_snapshot — schema", () => {
  beforeAll(async () => {
    const [{ present }] = await sys<{ present: boolean }>(
      `select to_regclass('public.games') is not null as present`,
    );
    if (!present) throw new Error("games table not found — wrong database?");
  });

  afterAll(async () => {
    await endPool();
  });

  it("games has a nullable jsonb questions_snapshot column", async () => {
    const rows = await sys<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'games' and column_name = 'questions_snapshot'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("jsonb");
    expect(rows[0].is_nullable).toBe("YES");
  });
});
```

- [ ] **Step 6: Verify**

Run: `npm run check && npm test`
Expected: tsc clean (Game type gains the field; DatabaseStorage needs no change — Drizzle selects include it automatically); 107/107 unit tests still pass (integration file stays outside the unit glob).

- [ ] **Step 7: Commit**

```bash
git add shared/schema.ts migrations/0010_game_question_snapshot.sql server/storage.ts tests/integration/game-snapshot-migration.test.ts
git commit -m "feat(insights): games.questions_snapshot column (migration 0010) + integration schema test"
```

---

### Task 2: `server/insights.ts` — pure text-keyed merge helper (TDD)

**Files:**
- Create: `server/insights.ts`
- Test: `server/insights.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3 and 4):

```ts
export interface InsightAgg { total: number; correct: number; msSum: number; }
export interface GameQuestionData {
  snapshotTexts: string[] | null;            // null → legacy game: attribute via currentTexts
  byIndex: Map<number, InsightAgg>;          // response aggregates per questionIndex
}
export function mergeInsightQuestions(
  currentTexts: string[],
  perGame: GameQuestionData[],
): Array<{ questionIndex: number; question: string; totalResponses: number; correctRate: number; avgResponseMs: number }>;
```

- [ ] **Step 1: Write the failing tests** — `server/insights.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot find module `./insights`.

- [ ] **Step 3: Implement `server/insights.ts`**

```ts
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
    for (const [index, agg] of game.byIndex) {
      const text = texts[index];
      // Defensive: a response index beyond the known question list has no
      // trustworthy identity — drop it rather than misattribute it.
      if (text === undefined) continue;
      const row = ensure(text);
      row.total += agg.total;
      row.correct += agg.correct;
      row.msSum += agg.msSum;
    }
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check && npm test`
Expected: tsc clean; all pass including the 5 new tests.

- [ ] **Step 5: Commit**

```bash
git add server/insights.ts server/insights.test.ts
git commit -m "feat(insights): pure text-keyed merge helper for snapshot-attributed question stats"
```

---

### Task 3: MemStorage `getQuizInsights` rewrite + regression tests (TDD)

**Files:**
- Modify: `server/storage.ts` MemStorage `getQuizInsights` (~lines 1049–1101) and the `QuizInsights` interface comment (~line 77)
- Test: `server/storage.test.ts` (append)

**Interfaces:**
- Consumes: `mergeInsightQuestions`, `GameQuestionData`, `InsightAgg` from `./insights` (Task 2); `Game.questionsSnapshot` (Task 1).
- Produces: unchanged `getQuizInsights` signature; new attribution semantics that Task 4 must mirror exactly.

- [ ] **Step 1: Write the failing tests** — append to `server/storage.test.ts` (a canonical question factory keeps them readable):

```ts
const SNAP_Q = (text: string, correct: number): any => ({
  question: text,
  type: "quiz",
  answerType: "single",
  answers: ["1", "2"],
  correctAnswers: [correct],
  timeLimit: 10,
  points: "standard",
});

test("insights: snapshot attribution survives quiz reorder/edit/delete", async () => {
  const s = new MemStorage();
  const quiz = await s.createQuiz(T1, {
    title: "Snap", description: "", background: "classroom", isPublic: true, createdBy: 1,
    questions: [SNAP_Q("Q-A", 0), SNAP_Q("Q-B", 1)],
  });
  const game = await s.createGame(T1, { quizId: quiz.id, gamePin: "424242", hostId: 1, status: "waiting" });
  // Freeze the played set (what room hydration does) and complete the game.
  await s.updateGame(T1, game.id, { questionsSnapshot: quiz.questions as any, status: "completed" });
  // One response per question: Q-A answered correctly, Q-B incorrectly.
  await s.createGameResponses(T1, [
    { tenantId: 1, gameId: game.id, playerName: "P", questionIndex: 0, selectedAnswer: 0, responseTime: 1000, isCorrect: true, pointsEarned: 100 },
    { tenantId: 1, gameId: game.id, playerName: "P", questionIndex: 1, selectedAnswer: 0, responseTime: 2000, isCorrect: false, pointsEarned: 0 },
  ]);
  // Now REORDER + EDIT the quiz: B moves first, A's text is edited away, new C added.
  await s.updateQuiz(T1, quiz.id, { questions: [SNAP_Q("Q-B", 1), SNAP_Q("Q-C", 0)] });

  const insights = await s.getQuizInsights(T1, quiz.id);
  const rows = insights!.questions;
  // Current-quiz order first (Q-B, Q-C), then the historical Q-A row.
  assert.deepEqual(rows.map((r) => r.question), ["Q-B", "Q-C", "Q-A"]);
  const byText = Object.fromEntries(rows.map((r) => [r.question, r]));
  assert.equal(byText["Q-B"].totalResponses, 1);   // via snapshot index 1 — did NOT follow the reorder
  assert.equal(byText["Q-B"].correctRate, 0);
  assert.equal(byText["Q-A"].totalResponses, 1);   // edited-away text keeps its history
  assert.equal(byText["Q-A"].correctRate, 1);
  assert.equal(byText["Q-A"].avgResponseMs, 1000);
  assert.equal(byText["Q-C"].totalResponses, 0);   // new question, no plays yet
});

test("insights: NULL-snapshot legacy game falls back to current-index attribution", async () => {
  const s = new MemStorage();
  const quiz = await s.createQuiz(T1, {
    title: "Legacy", description: "", background: "classroom", isPublic: true, createdBy: 1,
    questions: [SNAP_Q("L-1", 0), SNAP_Q("L-2", 1)],
  });
  const game = await s.createGame(T1, { quizId: quiz.id, gamePin: "434343", hostId: 1, status: "waiting" });
  await s.updateGame(T1, game.id, { status: "completed" }); // questionsSnapshot stays null
  await s.createGameResponses(T1, [
    { tenantId: 1, gameId: game.id, playerName: "P", questionIndex: 0, selectedAnswer: 0, responseTime: 500, isCorrect: true, pointsEarned: 100 },
  ]);
  const rows = (await s.getQuizInsights(T1, quiz.id))!.questions;
  assert.deepEqual(rows.map((r) => r.question), ["L-1", "L-2"]);
  assert.equal(rows[0].totalResponses, 1); // index 0 → current first question (old behavior)
  assert.equal(rows[0].correctRate, 1);
  assert.equal(rows[1].totalResponses, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the reorder test FAILS (current code attributes index 1 to the current second question "Q-C" and lists only 2 rows); the legacy test may already pass — that's fine, it pins the fallback.

- [ ] **Step 3: Rewrite MemStorage `getQuizInsights`'s question block** — replace lines ~1077–1089 (`// Question TEXT only…` through the `questions` map) with:

```ts
    // Attribute each game's responses to the question texts its players
    // actually saw (frozen snapshot; current quiz for pre-0010 games), then
    // merge across games by trimmed text. Question TEXT only — never keys.
    const currentTexts = ((quiz.questions as any[]) || []).map((q) => String(q?.question ?? ""));
    const perGame: GameQuestionData[] = completedGames.map((g) => {
      const snapshotTexts = Array.isArray(g.questionsSnapshot)
        ? (g.questionsSnapshot as any[]).map((q) => String(q?.question ?? ""))
        : null;
      const byIndex = new Map<number, InsightAgg>();
      for (const r of responses) {
        if (r.gameId !== g.id) continue;
        const agg = byIndex.get(r.questionIndex) ?? { total: 0, correct: 0, msSum: 0 };
        agg.total += 1;
        if (r.isCorrect) agg.correct += 1;
        agg.msSum += r.responseTime;
        byIndex.set(r.questionIndex, agg);
      }
      return { snapshotTexts, byIndex };
    });
    const questions = mergeInsightQuestions(currentTexts, perGame);
```

Add the import at the top of `server/storage.ts` with the other local imports:

```ts
import { mergeInsightQuestions, type GameQuestionData, type InsightAgg } from "./insights";
```

Also update the `QuizInsights` interface comment (line ~77):

```ts
    question: string;             // text from the game's frozen snapshot (current quiz for pre-0010 games) — never answer keys
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check && npm test`
Expected: tsc clean; both new tests pass; the two pre-existing insights tests ("aggregates completed games only…", "zero completed games…") still pass — their quizzes have unique texts and no snapshots, so the fallback preserves their expectations.

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts server/storage.test.ts
git commit -m "feat(insights): MemStorage snapshot-attributed question stats (text-keyed, reorder/edit-proof)"
```

---

### Task 4: DatabaseStorage `getQuizInsights` rewrite (same semantics)

**Files:**
- Modify: `server/storage.ts` DatabaseStorage `getQuizInsights` (~lines 438–465: the `questionAggRows` query and the `questions` map)

**Interfaces:**
- Consumes: `mergeInsightQuestions`/`GameQuestionData`/`InsightAgg` (Task 2; import added in Task 3); `games.questionsSnapshot` column (Task 1).
- Produces: identical observable semantics to Task 3's MemStorage version.

- [ ] **Step 1: Replace the aggregation block** — swap the `questionAggRows` query (lines ~438–452) and the `questions` map (lines ~454–465) with per-(game, questionIndex) SUMS plus snapshot fetch, merged by the shared helper:

```ts
      // Per-(game, question) SUMS (not rates) so cross-game merging stays
      // weighted correctly, plus each game's frozen snapshot. Attribution and
      // text-keyed merging live in mergeInsightQuestions (shared with
      // MemStorage so the two backends cannot drift).
      const snapshotRows = gameIds.length > 0
        ? await tx
            .select({ id: games.id, questionsSnapshot: games.questionsSnapshot })
            .from(games)
            .where(and(inArray(games.id, gameIds), tenantFilter(ctx, games.tenantId)))
        : [];
      const respAggRows = gameIds.length > 0
        ? await tx
            .select({
              gameId: gameResponses.gameId,
              questionIndex: gameResponses.questionIndex,
              total: sql<number>`count(*)::int`,
              correct: sql<number>`count(*) filter (where ${gameResponses.isCorrect})::int`,
              msSum: sql<number>`coalesce(sum(${gameResponses.responseTime}), 0)::float`,
            })
            .from(gameResponses)
            .where(and(
              inArray(gameResponses.gameId, gameIds),
              tenantFilter(ctx, gameResponses.tenantId),
            ))
            .groupBy(gameResponses.gameId, gameResponses.questionIndex)
        : [];

      const aggsByGame = new Map<number, Map<number, InsightAgg>>();
      for (const r of respAggRows) {
        let byIndex = aggsByGame.get(r.gameId);
        if (!byIndex) {
          byIndex = new Map();
          aggsByGame.set(r.gameId, byIndex);
        }
        byIndex.set(r.questionIndex, { total: r.total, correct: r.correct, msSum: r.msSum });
      }

      // Question TEXT only — never answer keys.
      const currentTexts = ((quiz.questions as any[]) || []).map((q) => String(q?.question ?? ""));
      const perGame: GameQuestionData[] = snapshotRows.map((g) => ({
        snapshotTexts: Array.isArray(g.questionsSnapshot)
          ? (g.questionsSnapshot as any[]).map((q) => String(q?.question ?? ""))
          : null,
        byIndex: aggsByGame.get(g.id) ?? new Map<number, InsightAgg>(),
      }));
      const questions = mergeInsightQuestions(currentTexts, perGame);
```

(`inArray`, `sql`, `and`, `desc` are already imported; the `./insights` import landed in Task 3.)

- [ ] **Step 2: Verify**

Run: `npm run check && npm test`
Expected: tsc clean; full suite passes. (DatabaseStorage has no direct unit tests — repo convention; semantics parity is enforced by sharing `mergeInsightQuestions`, and the live integration pass covers the SQL.)

- [ ] **Step 3: Commit**

```bash
git add server/storage.ts
git commit -m "feat(insights): DatabaseStorage snapshot-attributed question stats via shared merge helper"
```

---

### Task 5: Room hydration — freeze snapshot once, prefer it on rehydration (TDD)

**Files:**
- Modify: `server/game-room-manager.ts` `getOrCreateRoom` (~lines 371–379)
- Test: `server/game-room-manager.test.ts` (append)

**Interfaces:**
- Consumes: `Game.questionsSnapshot` (Task 1), existing `storage.updateGame(SYSTEM_CTX, …)`, existing `quizQuestionsSchema` import.
- Produces: rooms whose `questions` come from the frozen snapshot; games gain a snapshot on first hydration.

- [ ] **Step 1: Write the failing test** — append to `server/game-room-manager.test.ts` (reuses the file's `FakeSocket`; `MemStorage`'s seeded quiz id 1 has 3 sample questions):

```ts
test("room hydration freezes a questions snapshot; rehydration replays it after a quiz edit", async () => {
  const [{ GameRoomManager }, { MemStorage }] = await Promise.all([
    import("./game-room-manager"),
    import("./storage"),
  ]);
  const storage = new MemStorage();
  await storage.createGame({ tenantId: 1 }, { quizId: 1, gamePin: "778899", hostId: 1, status: "waiting" });
  await storage.joinGame({ tenantId: 1 }, "778899", "Alice");

  // First hydration persists the snapshot exactly once.
  const manager1 = new GameRoomManager(storage);
  await manager1.registerClient({ ws: new FakeSocket() as any, gamePin: "778899", userId: 1, wantsHostRole: true });
  const gameAfter = await storage.getGameByPin({ tenantId: 1 }, "778899");
  assert.ok(Array.isArray(gameAfter!.questionsSnapshot));
  const snapshot = gameAfter!.questionsSnapshot as any[];
  assert.ok(snapshot.length > 0);
  const originalFirstText = snapshot[0].question;

  // Edit the quiz out from under the game.
  await storage.updateQuiz({ tenantId: 1 }, 1, {
    questions: [{
      question: "EDITED-QUESTION", type: "quiz", answerType: "single",
      answers: ["a", "b"], correctAnswers: [0], timeLimit: 10, points: "standard",
    }] as any,
  });

  // Simulate a restart: a fresh manager (empty room map) rehydrates from storage.
  const manager2 = new GameRoomManager(storage);
  const hostSocket = new FakeSocket();
  await manager2.registerClient({ ws: hostSocket as any, gamePin: "778899", userId: 1, wantsHostRole: true });
  await manager2.startGame("778899", 1);

  // The room plays the FROZEN snapshot, not the edited quiz.
  const started = hostSocket.sent.find((m: any) => m.type === "question_started");
  assert.ok(started, "expected a question_started broadcast");
  assert.equal(started.question.question, originalFirstText);
  assert.notEqual(started.question.question, "EDITED-QUESTION");

  // And the stored snapshot was not overwritten by the second hydration.
  const gameFinal = await storage.getGameByPin({ tenantId: 1 }, "778899");
  assert.equal((gameFinal!.questionsSnapshot as any[])[0].question, originalFirstText);
});
```

NOTE: if `question_started`'s payload nests the question differently (check an existing test's `hostSocket.sent` usage in this file — e.g. the "starts a server-authoritative question" test), match that access path instead of `started.question.question`, keeping the same assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — the room replays the EDITED quiz (`started.question.question === "EDITED-QUESTION"`) and `questionsSnapshot` is null.

- [ ] **Step 3: Implement in `getOrCreateRoom`** — replace lines ~371–379 (quiz load + normalize) with:

```ts
    // Prefer the frozen per-game snapshot (the questions this game's players
    // actually saw) over the live quiz row: a quiz edit combined with a
    // server restart must not swap questions under an in-flight game, and
    // insights attribute historical responses against this exact set.
    let normalizedQuestions: Question[];
    if (Array.isArray(game.questionsSnapshot) && game.questionsSnapshot.length > 0) {
      normalizedQuestions = quizQuestionsSchema.parse(game.questionsSnapshot);
    } else {
      const quiz = await this.storage.getQuiz(SYSTEM_CTX, game.quizId);
      if (!quiz || !Array.isArray(quiz.questions)) {
        throw new RoomError("ROOM_NOT_FOUND", "Quiz not found", 404);
      }
      // Normalize stored questions to the canonical shape (correctAnswers /
      // type / answerType). Legacy quizzes hold only `correctAnswer` — the
      // engine's scoring reads `correctAnswers`, so this must run before play.
      normalizedQuestions = quizQuestionsSchema.parse(quiz.questions);
      // Freeze the played set ONCE. One write per game at hydration — never
      // on timer ticks (hard rule).
      await this.storage.updateGame(SYSTEM_CTX, game.id, { questionsSnapshot: normalizedQuestions });
    }
```

(`Question` may need adding to the existing `@shared/schema` type import in this file if not already imported — check the top of the file; `RuntimeRoom.questions: Question[]` at line 33 means it almost certainly is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check && npm test`
Expected: tsc clean; the new test passes; ALL existing game-room-manager tests still pass (they hydrate fresh games whose snapshot is null → quiz path + one write, then in-room behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add server/game-room-manager.ts server/game-room-manager.test.ts
git commit -m "feat(engine): freeze per-game question snapshot at hydration; rehydration replays it"
```

---

### Task 6: PR gate

- [ ] **Step 1: Full gate**

Run: `npm run check && npm test && npm run build`
Expected: all green.

- [ ] **Step 2: Push and open the PR (never auto-merge)**

```bash
git push -u origin feat/insights-question-snapshot
gh pr create --title "feat(insights): per-game question snapshots — trustworthy stats across quiz edits" --body "$(cat <<'EOF'
## Summary
- New additive `games.questions_snapshot` jsonb (migration 0010, NULL for historical games; rides the existing games RLS policy).
- Runtime room freezes the normalized question set ONCE at first hydration and replays it on rehydration — a quiz edit + server restart can no longer swap questions under an in-flight game.
- Insights attribute each game's responses to its snapshot (current quiz by index for pre-0010 games) and merge across games keyed by trimmed question text: current-quiz rows first, historical (edited-away/deleted) rows appended. Shared pure helper (`server/insights.ts`) keeps MemStorage and DatabaseStorage semantics identical.
- API shape unchanged — zero client changes.

## Spec
docs/superpowers/specs/2026-07-19-insights-snapshot-design.md

## Tests
- 5 unit tests on the pure merge helper (ordering, weighted merge, trim-collapse, NULL fallback, out-of-range drop).
- 2 MemStorage regression tests (reorder/edit/delete attribution; legacy NULL fallback).
- 1 room-engine test (snapshot frozen once; rehydration replays it after a quiz edit).
- Integration schema test for migration 0010.

## Security / performance impact
No new endpoints. One extra DB write per game (at hydration — not on timer ticks). Insights adds one small SELECT (game id + snapshot) per request.

## Rollback
Revert the PR; column is additive (`ALTER TABLE games DROP COLUMN questions_snapshot` if desired).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After merge, apply migration 0010 to the target DB and run `npm run integration`.**

---

## Self-review checklist (done at plan-writing time)

- **Spec coverage:** §2 data model → Task 1; §2 capture/prefer → Task 5; §2 aggregation → Tasks 2–4; §4 testing → each task's tests + Task 1's integration file; §5 rollout → Task 6. No gaps.
- **Placeholders:** none; every code step carries full code.
- **Type consistency:** `mergeInsightQuestions(currentTexts, perGame)` / `GameQuestionData` / `InsightAgg` identical across Tasks 2/3/4; `questionsSnapshot` name identical across Tasks 1/3/4/5; `updateGame(ctx, id, { questionsSnapshot })` relies on the existing `Partial<Game>` signature (no interface change).
- **Known judgment calls (documented in code comments):** duplicate texts within one quiz merge into one row; out-of-range response indexes are dropped; text edits start a new row (honest history, no fuzzy matching).
