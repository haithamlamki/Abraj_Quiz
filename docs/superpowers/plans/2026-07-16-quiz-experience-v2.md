# Quiz Experience V2 — Remaining Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Kahoot-parity V2 rebuild — points, no-limit timer, a full custom-theme system applied everywhere, a polished editor with a settings modal and shared answer cards, and end-to-end visual/functional verification — on top of the already-built shared renderer.

**Architecture:** The shared `QuizQuestionRenderer` / `AnswerGrid` / `AnswerCard` stack (in `client/src/components/quiz/`) is the single stage used by editor, preview, host, and player, so the preview is pixel-identical to the live game. This plan extends the data model (per-question `points`, `timeLimit=0` no-limit sentinel, quiz-level `theme` jsonb), threads a CSS-variable theme through that one stage via a `QuizThemeProvider`, and finishes the editor. No answer-color changes — the fixed 6-color/6-shape palette is the game's identity; the theme controls background, accent, question-card, font, and answer-card radius/shadow only.

**Tech Stack:** React 18 + Vite + Wouter + TanStack Query (client), Express 4 + WebSocket + Drizzle/Postgres (server), Zod shared schemas, `node --test` (unit) + Vitest (integration), Tailwind + shadcn/ui, jsPDF (reports).

## Global Constraints

Copied verbatim from `CLAUDE.md` and the V2 spec. Every task's requirements implicitly include these.

- Server is authoritative for timing. Client renders, never decides.
- Never leak `correctAnswer`/`correctAnswers` in answer-submission responses before question close. `sanitizeQuizForCaller` (`server/routes.ts:288`) must keep stripping both.
- Never call storage methods without a `StorageCtx`. Request paths use `tctx(req)`; only the game engine and admin/registry code use `SYSTEM_CTX`.
- New business tables MUST have `tenant_id` + the `tenant_isolation` RLS policy pair. (Adding a nullable column to the existing `quizzes` table needs **no** new policy — the row policy already covers all columns.)
- Themes must be tenant-aware. Never hardcode Abraj or PDO branding into shared quiz themes.
- Backward compatibility is non-negotiable: 26 prod quizzes use the legacy question shape; existing quizzes must keep working with safe defaults and no data loss.
- Existing quizzes must keep working: `timeLimit` default `20`, `points` default `"standard"`, `theme` NULL → derived from `background`.
- Run `npm run check && npm test && npm run build` before any commit (workflow rule).
- New unit test files MUST be added to the `test` script's file list in `package.json` — the runner names files explicitly.
- Reference FR numbers from `PRODUCTION_MIGRATION_PRD.md` when relevant.
- Answer option colors/shapes are FIXED (`client/src/lib/answer-style.ts`, 6 entries). The theme never recolors them.

## Confirmed product decisions (2026-07-16)

- **No-limit timer:** `timeLimit === 0` means host-advances-manually. The engine skips the auto-close timer; the host's Next button closes the question. Scoring gives a flat (non-time) score for no-limit questions.
- **Custom theme builder:** full builder — background, accent, question-text, question-card, font, card style — stored as a quiz-level `theme` jsonb, applied everywhere (editor/preview/host/player/leaderboard/results/PDF) via CSS variables and a `QuizThemeProvider`.
- **Points:** per-question `standard` (1×) or `double` (2×) multiplier on the existing time-based score.
- **Settings modal:** implement title, description, and **visibility** (public/private). Cover image, language, and drag-and-drop reorder are explicitly **out of scope** for this plan (deferred).

## Out of scope (deferred)

- Quiz cover image, quiz language field, drag-and-drop question reorder.
- Any change to the answer-selection bitmask encoding or all-or-nothing multi-select scoring (already shipped in PR1).

## File Structure

**New files**
- `shared/quiz-theme.ts` — `QuizTheme` type, `DEFAULT_QUIZ_THEME`, `PRESET_QUIZ_THEMES`, `resolveQuizTheme(quiz)`, `themeToCssVars(theme)`. One responsibility: the theme model + resolver, shared by client and (PDF) server-free client code.
- `shared/quiz-theme.test.ts` — unit tests for the resolver and legacy fallback.
- `client/src/components/quiz/QuizThemeProvider.tsx` — wraps the renderer, injects CSS variables + background.
- `client/src/components/quiz/ThemeBuilder.tsx` — the custom-theme editing panel (colors/font/card style) used inside the editor's theme dialog.
- `client/src/components/quiz/QuizSettingsDialog.tsx` — the quiz-level settings modal (title/description/visibility).
- `migrations/0007_quiz_theme.sql` — `ALTER TABLE quizzes ADD COLUMN theme jsonb;` (nullable, backward-compatible).

**Modified files**
- `shared/schema.ts` — add `points` + relax `timeLimit`; add `theme` column + `insertQuizSchema.theme`.
- `shared/quiz-scoring.ts` — (no change expected; scoring multiplier lives in the engine). Verify only.
- `shared/ws-protocol.ts` — `question_started` allows `durationSeconds: 0` and nullable `closesAt`.
- `server/game-room-manager.ts` — no-limit timer handling + points multiplier in `calculatePoints`.
- `client/src/components/quiz/QuizQuestionRenderer.tsx`, `AnswerCard.tsx` — consume theme CSS vars; hide timer chip when no-limit.
- `client/src/pages/quiz-editor.tsx` — settings modal, points control, no-limit option, shared answer cards, theme builder, in-memory preview modal, pixel polish.
- `client/src/pages/quiz-preview.tsx` — wrap in `QuizThemeProvider`; classroom-bg fix.
- `client/src/pages/play-game.tsx`, `host-game.tsx` — wrap renderer in `QuizThemeProvider`; no-limit UI (hide countdown, host manual close).
- `client/src/utils/enhanced-pdf-generator.ts`, `quiz-pdf-generator.ts` — read the resolved theme for report branding.
- `package.json` — register new test files in the `test` script.

## Phase overview

- **Phase A — Data & engine foundation** (Tasks 1–4): schema, protocol, engine. Ships working scoring + no-limit.
- **Phase B — Theme system** (Tasks 5–9): model, provider, presets + builder, apply everywhere, PDF.
- **Phase C — Editor polish & settings** (Tasks 10–13): shared answer cards, settings modal + points + no-limit UI, pixel polish, classroom-bg fix, in-editor preview modal.
- **Phase D — Verification** (Task 14): exhaustive E2E + visual acceptance + final report.

Each phase produces working, independently testable software and can be its own PR (stacked on `feat/quiz-experience-v2` / PR #6).

---

## Phase A — Data & engine foundation

### Task 1: Schema — per-question `points` + no-limit `timeLimit` + quiz `theme` column

**Files:**
- Modify: `shared/schema.ts` (question schema ~194–260; quizzes table ~70–80; `insertQuizSchema` ~146–158)
- Create: `migrations/0007_quiz_theme.sql`
- Test: `shared/schema.test.ts` (new)

**Interfaces:**
- Consumes: existing `questionObjectSchema`, `normalizeLegacyQuestion`, `questionSchema`, `Question` type.
- Produces:
  - `questionPointsSchema = z.enum(["standard","double"])`, exported.
  - `Question` now has `points: "standard" | "double"` (default `"standard"`) and `timeLimit` accepting `0` (no limit) or `5..120`.
  - `quizzes.theme` jsonb column; `Quiz.theme` type is `unknown` (validated by `shared/quiz-theme.ts` at read time).
  - `insertQuizSchema` accepts optional `theme`.

- [ ] **Step 1: Write failing tests for the new fields**

Create `shared/schema.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { questionSchema, insertQuizSchema } from "./schema";

test("points defaults to standard for legacy questions", () => {
  const q = questionSchema.parse({ question: "Q", answers: ["a", "b", "c", "d"], correctAnswer: 1 });
  assert.equal(q.points, "standard");
  assert.deepEqual(q.correctAnswers, [1]);
});

test("points accepts double", () => {
  const q = questionSchema.parse({ question: "Q", answers: ["a", "b"], correctAnswers: [0], points: "double" });
  assert.equal(q.points, "double");
});

test("points rejects unknown values", () => {
  assert.throws(() => questionSchema.parse({ question: "Q", answers: ["a", "b"], correctAnswers: [0], points: "triple" }));
});

test("timeLimit accepts 0 as the no-limit sentinel", () => {
  const q = questionSchema.parse({ question: "Q", answers: ["a", "b"], correctAnswers: [0], timeLimit: 0 });
  assert.equal(q.timeLimit, 0);
});

test("timeLimit rejects values between 1 and 4", () => {
  assert.throws(() => questionSchema.parse({ question: "Q", answers: ["a", "b"], correctAnswers: [0], timeLimit: 3 }));
});

test("timeLimit still rejects over 120", () => {
  assert.throws(() => questionSchema.parse({ question: "Q", answers: ["a", "b"], correctAnswers: [0], timeLimit: 200 }));
});

test("insertQuizSchema accepts an optional theme object", () => {
  const parsed = insertQuizSchema.parse({ title: "T", questions: [], createdBy: 1, theme: { accent: "#123456" } });
  assert.deepEqual(parsed.theme, { accent: "#123456" });
});

test("insertQuizSchema tolerates a missing theme", () => {
  const parsed = insertQuizSchema.parse({ title: "T", questions: [], createdBy: 1 });
  assert.equal(parsed.theme, undefined);
});
```

- [ ] **Step 2: Register the new test file and run it to confirm it fails**

Edit `package.json` `test` script — append ` shared/schema.test.ts` to the file list:

```json
"test": "node --import tsx --test server/game-room-manager.test.ts server/websocket.test.ts server/tenant.test.ts server/storage.test.ts server/token.test.ts server/quiz-scoring.test.ts shared/schema.test.ts",
```

Run: `npm test`
Expected: FAIL — `points` is undefined, `timeLimit: 0` throws (`.min(5)`), `insertQuizSchema` has no `theme`.

- [ ] **Step 3: Add `points` + relax `timeLimit` in the question schema**

In `shared/schema.ts`, after `export const answerModeSchema` (~196) add:

```ts
export const questionPointsSchema = z.enum(["standard", "double"]);
```

In `questionObjectSchema` (~206), replace the `timeLimit` line and add `points`:

```ts
    // 0 = no limit (host advances manually); otherwise 5..120 seconds.
    timeLimit: z
      .number()
      .int()
      .min(0)
      .max(120)
      .refine((t) => t === 0 || t >= 5, {
        message: "Time limit must be 0 (no limit) or between 5 and 120 seconds",
      })
      .default(20),
    // Score multiplier: standard = 1x, double = 2x on the time-based score.
    points: questionPointsSchema.default("standard"),
```

(`points` and the relaxed `timeLimit` both use zod `.default(...)`, so legacy questions with neither field parse cleanly — no change to `normalizeLegacyQuestion` needed.)

- [ ] **Step 4: Add the `theme` column + `insertQuizSchema.theme`**

In `shared/schema.ts`, in the `quizzes` table (~77, after `background`):

```ts
  // Custom theme config (colors/font/card style). NULL → derive from `background`
  // preset (backward compatible). Validated by shared/quiz-theme.ts at read time.
  theme: jsonb("theme"),
```

In `insertQuizSchema.extend({...})` (~153) add:

```ts
  theme: z.record(z.any()).optional(),
```

- [ ] **Step 5: Create the migration**

Create `migrations/0007_quiz_theme.sql`:

```sql
-- Custom per-quiz theme config (colors/font/card style). Nullable and
-- backward-compatible: existing quizzes read as NULL and fall back to their
-- `background` preset. Covered by the existing quizzes tenant_isolation RLS
-- policy (row policy applies to all columns) — no new policy needed.
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS theme jsonb;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `shared/schema.test.ts` cases green; the existing 43 tests still pass.

- [ ] **Step 7: Type-check and sync the local dev DB schema**

Run: `npm run check`
Expected: no type errors.
Run: `npm run db:push`
Expected: drizzle adds the `theme` column to the dev DB (or reports it in sync). If `DATABASE_URL` is unset locally, skip and rely on the migration file (note for deploy).

- [ ] **Step 8: Commit**

```bash
git add shared/schema.ts shared/schema.test.ts migrations/0007_quiz_theme.sql package.json
git commit -m "feat(schema): per-question points + no-limit timeLimit + quiz theme column"
```

---

### Task 2: Engine — points multiplier + no-limit scoring/timer

**Files:**
- Modify: `server/game-room-manager.ts` (`calculatePoints` ~601–606; `startQuestion` ~387–426; `getTimeRemaining` ~608–611)
- Test: `server/game-room-manager.test.ts` (existing — add cases)

**Interfaces:**
- Consumes: `Question` (now with `points` + `timeLimit=0`), existing `RuntimeRoom`, `startQuestion`, `closeQuestion`.
- Produces: `calculatePoints(question, responseTime)` returns `base * (question.points === "double" ? 2 : 1)`; for `timeLimit === 0` the base is the flat floor (no time bonus). `startQuestion` schedules no auto-close timer when `timeLimit === 0`.

- [ ] **Step 1: Write failing tests for points + no-limit scoring**

Add to `server/game-room-manager.test.ts` (import `GameRoomManager` as the file already does; if `calculatePoints` is private, test it via a small cast — match the file's existing test style). Add:

```ts
test("calculatePoints doubles the score for double-points questions", () => {
  const mgr = new GameRoomManager(makeStorageStub());
  const base = (mgr as any).calculatePoints({ timeLimit: 20, points: "standard" }, 0);
  const doubled = (mgr as any).calculatePoints({ timeLimit: 20, points: "double" }, 0);
  assert.equal(doubled, base * 2);
});

test("calculatePoints gives a flat score for no-limit questions", () => {
  const mgr = new GameRoomManager(makeStorageStub());
  const fast = (mgr as any).calculatePoints({ timeLimit: 0, points: "standard" }, 0);
  const slow = (mgr as any).calculatePoints({ timeLimit: 0, points: "standard" }, 60_000);
  assert.equal(fast, slow); // no time bonus when there is no limit
  assert.ok(fast > 0);
});
```

(Reuse whatever storage stub / constructor the existing tests use — check the top of `game-room-manager.test.ts` and mirror it. If tests there construct via a helper, use that helper.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `double` is not yet applied (doubled === base); no-limit still applies the `|| 30` time bonus so `fast !== slow`.

- [ ] **Step 3: Implement points multiplier + no-limit flat score**

In `server/game-room-manager.ts`, replace `calculatePoints` (~601):

```ts
  private calculatePoints(question: Question, responseTime: number): number {
    const maxPoints = 1000;
    const multiplier = question.points === "double" ? 2 : 1;
    // No-limit questions (timeLimit === 0) have no time pressure → flat floor score.
    if (!question.timeLimit) {
      return Math.round(maxPoints * 0.5 * multiplier);
    }
    const timeLimit = question.timeLimit;
    const timeBonus = Math.max(0, (timeLimit - responseTime / 1000) / timeLimit);
    return Math.round(maxPoints * (0.5 + 0.5 * timeBonus) * multiplier);
  }
```

- [ ] **Step 4: Skip the auto-close timer for no-limit questions**

In `server/game-room-manager.ts` `startQuestion` (~395), replace the `questionClosesAt` assignment and the broadcast/timer block so no-limit sends `durationSeconds: 0` / `closesAt: null` and schedules no close timer:

```ts
    const noLimit = !question.timeLimit; // timeLimit === 0
    room.questionStartedAt = Date.now();
    room.questionClosesAt = noLimit ? null : room.questionStartedAt + question.timeLimit * 1000;
    this.touch(room);

    this.broadcast(room, {
      type: "question_started",
      gamePin: room.gamePin,
      questionIndex,
      durationSeconds: noLimit ? 0 : question.timeLimit,
      startedAt: room.questionStartedAt,
      closesAt: room.questionClosesAt ?? 0,
      timeRemaining: this.getTimeRemaining(room),
    });
    this.broadcast(room, { type: "game_updated", game });

    if (!noLimit) {
      room.tickTimer = setInterval(() => {
        if (!room.questionOpen) return;
        const timeRemaining = this.getTimeRemaining(room);
        this.broadcast(room, {
          type: "time_remaining",
          gamePin: room.gamePin,
          questionIndex: room.currentQuestion,
          timeRemaining,
        });
      }, 1000);
      room.tickTimer.unref();

      room.closeTimer = setTimeout(() => {
        void this.closeQuestion(room, "timer");
      }, Math.max(0, room.questionClosesAt! - Date.now()));
      room.closeTimer.unref();
    }
```

Update the `RuntimeRoom.questionClosesAt` type to `number | null` if it is currently `number` (search the interface near the top of the file). `getTimeRemaining` (~608) already returns `0` when `!room.questionClosesAt`, so it is safe with `null`.

- [ ] **Step 5: Fix `sendCurrentQuestionState` for reconnects into a no-limit question**

In `server/game-room-manager.ts` `sendCurrentQuestionState` (~548), the guard is `room.questionOpen && room.questionStartedAt && room.questionClosesAt`. A no-limit open question has `questionClosesAt === null` and would fall through. Change the guard to not require `questionClosesAt`:

```ts
    if (room.questionOpen && room.questionStartedAt) {
      const q = room.questions[room.currentQuestion];
      this.send(ws, {
        type: "question_started",
        gamePin: room.gamePin,
        questionIndex: room.currentQuestion,
        durationSeconds: q?.timeLimit || 0,
        startedAt: room.questionStartedAt,
        closesAt: room.questionClosesAt ?? 0,
        timeRemaining: this.getTimeRemaining(room),
      });
      return;
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — points doubling and no-limit flat score both hold; existing engine tests unaffected.

- [ ] **Step 7: Type-check**

Run: `npm run check`
Expected: no errors (confirm the `questionClosesAt: number | null` change type-checks against every use).

- [ ] **Step 8: Commit**

```bash
git add server/game-room-manager.ts
git commit -m "feat(engine): double-points multiplier + no-limit (host-advance) scoring/timer"
```

---

### Task 3: Protocol — allow no-limit in `question_started`

**Files:**
- Modify: `shared/ws-protocol.ts` (`question_started` ~63–71)
- Test: `server/websocket.test.ts` (existing — add a case) OR `shared/schema.test.ts`

**Interfaces:**
- Consumes: `wsServerMessageSchema`.
- Produces: `question_started` accepts `durationSeconds: 0` and `closesAt: 0` (no-limit sentinel).

- [ ] **Step 1: Write a failing test that a no-limit question_started validates**

Add to `server/websocket.test.ts` (or `shared/schema.test.ts` if simpler — it already imports zod schemas):

```ts
import { wsServerMessageSchema } from "@shared/ws-protocol"; // adjust to the file's existing import style

test("question_started accepts a no-limit (0-duration) message", () => {
  const msg = {
    type: "question_started",
    gamePin: "123456",
    questionIndex: 0,
    durationSeconds: 0,
    startedAt: 1,
    closesAt: 0,
    timeRemaining: 0,
  };
  assert.doesNotThrow(() => wsServerMessageSchema.parse(msg));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `durationSeconds: z.number().int().min(1)` rejects `0`.

- [ ] **Step 3: Relax `durationSeconds`**

In `shared/ws-protocol.ts` (~67), change:

```ts
    durationSeconds: z.number().int().min(0),
```

(`closesAt` is already `min(0)`, so `0` is accepted; the client treats `durationSeconds === 0` as "no limit".)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/ws-protocol.ts server/websocket.test.ts
git commit -m "feat(protocol): allow 0-duration (no-limit) question_started"
```

---

### Task 4: Verify correct-answer secrecy is unaffected

**Files:**
- Read/verify: `server/routes.ts` `sanitizeQuizForCaller` (~288)
- Test: `tests/integration/` (existing secrecy test) — run only

**Interfaces:**
- Consumes: existing sanitize behavior.
- Produces: confirmation that `points`/`theme` additions do not leak `correctAnswers`.

- [ ] **Step 1: Read `sanitizeQuizForCaller` and confirm it strips by key**

Read `server/routes.ts:288–305`. Confirm it removes `correctAnswer` and `correctAnswers` from each question for non-owners. `points` is safe to expose; `theme` is quiz-level and safe. No code change expected.

- [ ] **Step 2: Run the integration secrecy test**

Run: `npm run integration`
Expected: PASS — the existing "non-owner cannot see correct answers mid-game" test is green. If `DATABASE_URL`/integration DB is unavailable locally, note it and defer to CI.

- [ ] **Step 3: Commit (only if any change was needed)**

If no change, skip. Otherwise:

```bash
git add server/routes.ts
git commit -m "fix(routes): keep correctAnswers stripped after points/theme additions"
```

---

## Phase B — Theme system

### Task 5: Theme model + resolver (`shared/quiz-theme.ts`)

**Files:**
- Create: `shared/quiz-theme.ts`
- Test: `shared/quiz-theme.test.ts` (new)

**Interfaces:**
- Consumes: `PRESET_THEMES`/`GRADIENT_THEMES` ids conceptually (background strings), `Quiz` type (`{ background, theme }`).
- Produces:
  - `export interface QuizTheme { background: string; accent: string; questionText: string; questionCard: string; font: QuizFont; cardStyle: QuizCardStyle }`
  - `export type QuizFont = "sans" | "serif" | "rounded" | "mono"`
  - `export type QuizCardStyle = "solid" | "soft" | "outline"`
  - `export const DEFAULT_QUIZ_THEME: QuizTheme`
  - `export const PRESET_QUIZ_THEMES: Array<{ id: string; label: string; theme: QuizTheme }>`
  - `export function resolveQuizTheme(quiz: { background?: string | null; theme?: unknown }): QuizTheme`
  - `export function themeToCssVars(theme: QuizTheme): Record<string, string>` → `{ "--quiz-accent", "--quiz-question-text", "--quiz-question-card", "--quiz-font", "--quiz-card-radius", "--quiz-card-shadow" }`
  - `export const QUIZ_FONT_STACKS: Record<QuizFont, string>`

- [ ] **Step 1: Write failing tests**

Create `shared/quiz-theme.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveQuizTheme, themeToCssVars, DEFAULT_QUIZ_THEME, PRESET_QUIZ_THEMES } from "./quiz-theme";

test("resolves the default theme for a quiz with no theme and no background", () => {
  const t = resolveQuizTheme({});
  assert.equal(t.accent, DEFAULT_QUIZ_THEME.accent);
});

test("legacy quiz (background only, theme null) keeps its background", () => {
  const t = resolveQuizTheme({ background: "sunset", theme: null });
  assert.equal(t.background, "sunset");
});

test("custom theme overrides only the provided keys", () => {
  const t = resolveQuizTheme({ background: "aurora", theme: { accent: "#ff0000" } });
  assert.equal(t.accent, "#ff0000");
  assert.equal(t.background, "aurora"); // background still comes from the quiz field
  assert.equal(t.questionText, DEFAULT_QUIZ_THEME.questionText); // untouched key falls back
});

test("themeToCssVars emits the expected variable names", () => {
  const vars = themeToCssVars(DEFAULT_QUIZ_THEME);
  for (const key of ["--quiz-accent", "--quiz-question-text", "--quiz-question-card", "--quiz-font", "--quiz-card-radius", "--quiz-card-shadow"]) {
    assert.ok(key in vars, `missing ${key}`);
  }
});

test("every preset resolves to a full theme", () => {
  for (const p of PRESET_QUIZ_THEMES) {
    assert.ok(p.theme.accent && p.theme.questionText && p.theme.background);
  }
});
```

- [ ] **Step 2: Register the test file and run to verify failure**

Edit `package.json` `test` script — append ` shared/quiz-theme.test.ts`.
Run: `npm test`
Expected: FAIL — `shared/quiz-theme.ts` does not exist.

- [ ] **Step 3: Implement the theme model + resolver**

Create `shared/quiz-theme.ts`:

```ts
// The quiz theme model — shared by the client renderer, the editor's theme
// builder, and the PDF report branding. A theme controls the STAGE chrome
// (background, accent, question card, font, answer-card shape) only; the 6
// answer option colors/shapes are the game's fixed identity and are never
// themed (see client/src/lib/answer-style.ts).

export type QuizFont = "sans" | "serif" | "rounded" | "mono";
export type QuizCardStyle = "solid" | "soft" | "outline";

export interface QuizTheme {
  /** Gradient id | image id | https URL — resolved by utils/backgrounds.ts. */
  background: string;
  /** Progress pill, timer chip, selected ring. Hex. */
  accent: string;
  /** Question text color. Hex. */
  questionText: string;
  /** Question card background. Hex or rgba(). */
  questionCard: string;
  font: QuizFont;
  cardStyle: QuizCardStyle;
}

export const QUIZ_FONT_STACKS: Record<QuizFont, string> = {
  sans: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  rounded: "'Nunito', ui-rounded, 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
};

const CARD_RADIUS: Record<QuizCardStyle, string> = {
  solid: "0.75rem",
  soft: "1.25rem",
  outline: "0.5rem",
};

const CARD_SHADOW: Record<QuizCardStyle, string> = {
  solid: "0 4px 6px rgba(0,0,0,0.15)",
  soft: "0 10px 20px rgba(0,0,0,0.20)",
  outline: "0 0 0 2px rgba(255,255,255,0.6) inset",
};

export const DEFAULT_QUIZ_THEME: QuizTheme = {
  background: "aurora",
  accent: "#0f766e",
  questionText: "#1e293b",
  questionCard: "#ffffff",
  font: "sans",
  cardStyle: "solid",
};

export const PRESET_QUIZ_THEMES: Array<{ id: string; label: string; theme: QuizTheme }> = [
  { id: "aurora",   label: "Aurora",   theme: { ...DEFAULT_QUIZ_THEME, background: "aurora",   accent: "#6d28d9" } },
  { id: "sunset",   label: "Sunset",   theme: { ...DEFAULT_QUIZ_THEME, background: "sunset",   accent: "#db2777" } },
  { id: "mint",     label: "Mint",     theme: { ...DEFAULT_QUIZ_THEME, background: "mint",     accent: "#059669" } },
  { id: "grape",    label: "Grape",    theme: { ...DEFAULT_QUIZ_THEME, background: "grape",    accent: "#7c3aed" } },
  { id: "ember",    label: "Ember",    theme: { ...DEFAULT_QUIZ_THEME, background: "ember",    accent: "#ea580c" } },
  { id: "midnight", label: "Midnight", theme: { ...DEFAULT_QUIZ_THEME, background: "midnight", accent: "#38bdf8", questionText: "#0f172a", font: "rounded" } },
  { id: "classroom", label: "Classroom", theme: { ...DEFAULT_QUIZ_THEME, background: "classroom", accent: "#2563eb" } },
];

function isQuizTheme(value: unknown): value is Partial<QuizTheme> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// A quiz stores `background` (legacy single field) and optionally `theme` (the
// richer config). The theme's background falls back to the quiz.background so
// existing quizzes keep their look with no data migration.
export function resolveQuizTheme(quiz: { background?: string | null; theme?: unknown }): QuizTheme {
  const custom = isQuizTheme(quiz.theme) ? quiz.theme : {};
  return {
    ...DEFAULT_QUIZ_THEME,
    background: custom.background ?? quiz.background ?? DEFAULT_QUIZ_THEME.background,
    accent: custom.accent ?? DEFAULT_QUIZ_THEME.accent,
    questionText: custom.questionText ?? DEFAULT_QUIZ_THEME.questionText,
    questionCard: custom.questionCard ?? DEFAULT_QUIZ_THEME.questionCard,
    font: custom.font ?? DEFAULT_QUIZ_THEME.font,
    cardStyle: custom.cardStyle ?? DEFAULT_QUIZ_THEME.cardStyle,
  };
}

export function themeToCssVars(theme: QuizTheme): Record<string, string> {
  return {
    "--quiz-accent": theme.accent,
    "--quiz-question-text": theme.questionText,
    "--quiz-question-card": theme.questionCard,
    "--quiz-font": QUIZ_FONT_STACKS[theme.font],
    "--quiz-card-radius": CARD_RADIUS[theme.cardStyle],
    "--quiz-card-shadow": CARD_SHADOW[theme.cardStyle],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `shared/quiz-theme.test.ts` cases green.

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add shared/quiz-theme.ts shared/quiz-theme.test.ts package.json
git commit -m "feat(theme): shared quiz theme model + resolver + css-var mapping"
```

---

### Task 6: `QuizThemeProvider` + renderer consumes CSS vars

**Files:**
- Create: `client/src/components/quiz/QuizThemeProvider.tsx`
- Modify: `client/src/components/quiz/QuizQuestionRenderer.tsx`, `AnswerCard.tsx`
- Test: manual render verification (Task 14 covers browser); type-check gates here.

**Interfaces:**
- Consumes: `resolveQuizTheme`, `themeToCssVars` (Task 5), `getBackgroundStyle` (`utils/backgrounds.ts`).
- Produces:
  - `QuizThemeProvider({ theme, children, className, style })` — a `div` that applies `getBackgroundStyle(theme.background)` + the CSS vars + `fontFamily: var(--quiz-font)`.
  - `QuizQuestionRenderer` gains an optional `theme?: QuizTheme` prop; when present it wraps its stage in `QuizThemeProvider` and the question card reads `var(--quiz-question-card)` / `var(--quiz-question-text)`, the progress/timer pills read `var(--quiz-accent)`. When absent it behaves exactly as today (background-string path) — no regression.

- [ ] **Step 1: Create `QuizThemeProvider`**

Create `client/src/components/quiz/QuizThemeProvider.tsx`:

```tsx
import type { CSSProperties, ReactNode } from "react";
import type { QuizTheme } from "@shared/quiz-theme";
import { themeToCssVars } from "@shared/quiz-theme";
import { getBackgroundStyle } from "@/utils/backgrounds";

export interface QuizThemeProviderProps {
  theme: QuizTheme;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

// Injects the theme as CSS variables + background onto a wrapper element. Every
// surface (renderer, editor canvas, preview) wraps its stage in this so the
// theme is applied identically and cannot drift.
export function QuizThemeProvider({ theme, children, className = "", style }: QuizThemeProviderProps) {
  const vars = themeToCssVars(theme) as CSSProperties;
  return (
    <div
      className={className}
      style={{ ...getBackgroundStyle(theme.background), ...vars, fontFamily: "var(--quiz-font)", ...style }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Make `QuizQuestionRenderer` theme-aware (backward compatible)**

In `client/src/components/quiz/QuizQuestionRenderer.tsx`:
1. Add to the imports: `import type { QuizTheme } from "@shared/quiz-theme"; import { QuizThemeProvider } from "./QuizThemeProvider";`
2. Add `theme?: QuizTheme;` to `QuizQuestionRendererProps`.
3. Destructure `theme` in the signature.
4. Replace the outer `<div ... style={getBackgroundStyle(background)}>` (both the `shapeOnly` branch and the main branch) so that WHEN `theme` is provided the wrapper is `QuizThemeProvider` (which owns background + vars) and when it is not, the existing `getBackgroundStyle(background)` path is kept unchanged.

Main branch becomes:

```tsx
  const stageClass = `h-full w-full rounded-2xl overflow-hidden flex flex-col p-3 sm:p-5 gap-3 sm:gap-4 ${className}`;
  const stageInner = (
    <>
      {/* Progress + timer bar */}
      {(questionNumber != null || timeRemaining != null) && (
        <div className="flex items-center justify-between shrink-0">
          {questionNumber != null ? (
            <span
              className="text-white text-xs sm:text-sm font-semibold rounded-full px-3 py-1"
              style={{ backgroundColor: theme ? "var(--quiz-accent)" : "rgba(255,255,255,0.9)", color: theme ? "#fff" : "#1e293b" }}
            >
              Question {questionNumber}{totalQuestions ? ` of ${totalQuestions}` : ""}
            </span>
          ) : <span />}
          {timeRemaining != null && (
            <span className={`flex items-center gap-1 text-white font-bold rounded-full px-3 py-1 ${timeRemaining <= 5 ? "bg-red-600" : "bg-black/40"}`}>
              <Clock className="w-4 h-4" /> {timeRemaining}
            </span>
          )}
        </div>
      )}

      {/* Question text */}
      <div
        className="shrink-0 rounded-xl px-4 sm:px-6 py-3 sm:py-4 text-center shadow"
        style={{ backgroundColor: theme ? "var(--quiz-question-card)" : "#fff" }}
      >
        <h2
          className="font-bold text-base sm:text-xl md:text-2xl leading-snug line-clamp-3"
          style={{ color: theme ? "var(--quiz-question-text)" : "#1e293b" }}
        >
          {question.question || "Untitled question"}
        </h2>
      </div>

      {/* Media */}
      {question.imageUrl && (
        <div className="shrink-0 flex justify-center">
          <div className="w-full max-w-md aspect-[16/9] rounded-xl overflow-hidden bg-black/10 flex items-center justify-center">
            <img src={question.imageUrl} alt="Question" className="w-full h-full object-contain" />
          </div>
        </div>
      )}

      {/* Answers */}
      <AnswerGrid
        answers={question.answers}
        selectedIndices={selectedIndices}
        disabled={disabled}
        onSelect={onSelect}
        correctAnswers={correctAnswers}
        reveal={reveal}
        distribution={distribution}
        className="flex-1 min-h-0"
      />
    </>
  );

  if (theme) {
    return <QuizThemeProvider theme={theme} className={stageClass}>{stageInner}</QuizThemeProvider>;
  }
  return <div className={stageClass} style={getBackgroundStyle(background)}>{stageInner}</div>;
```

Apply the same conditional-wrapper change to the `shapeOnly` branch (wrap in `QuizThemeProvider` when `theme` is set, else keep `getBackgroundStyle(background)`).

- [ ] **Step 3: Make `AnswerCard` radius/shadow theme-aware (with fallback)**

In `client/src/components/quiz/AnswerCard.tsx`, on the `<button>`, allow the theme's card radius/shadow to override when the CSS vars are present. Add an inline style that reads the vars with a fallback so non-themed usage is unchanged:

```tsx
      style={{ borderRadius: "var(--quiz-card-radius, 0.75rem)", boxShadow: "var(--quiz-card-shadow, 0 4px 6px rgba(0,0,0,0.15))" }}
```

Remove the hardcoded `rounded-xl shadow-md` from the className string (they are now driven by the vars, which default to the same values). Keep everything else (the fixed `ANSWER_CARD_MIN_H`, the `style.bg` color class, icons) exactly as-is.

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 5: Build to confirm the client compiles**

Run: `npm run build`
Expected: client + server build succeed.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/quiz/QuizThemeProvider.tsx client/src/components/quiz/QuizQuestionRenderer.tsx client/src/components/quiz/AnswerCard.tsx
git commit -m "feat(theme): QuizThemeProvider + renderer/answer-card consume theme css vars"
```

---

### Task 7: Expanded preset gallery + custom theme builder in the editor

**Files:**
- Create: `client/src/components/quiz/ThemeBuilder.tsx`
- Modify: `client/src/pages/quiz-editor.tsx` (theme dialog ~589–621; `QuizForm` type ~25–30; save payload ~270–280; edit-load ~121–126)
- Test: type-check + Task 14 browser pass.

**Interfaces:**
- Consumes: `PRESET_QUIZ_THEMES`, `QuizTheme`, `resolveQuizTheme`, `DEFAULT_QUIZ_THEME`, `QUIZ_FONT_STACKS`, `themeToCssVars` (Task 5); `getBackgroundStyle`/`getThemeSwatchStyle` (`utils/backgrounds.ts`); the editor's `uploadThemeImage`.
- Produces:
  - `QuizForm` gains `theme: QuizTheme` (resolved on load).
  - `ThemeBuilder({ theme, onChange, onUploadBackground, uploading })` — presets grid + custom controls (background upload, accent/question-text/question-card color inputs, font select, card-style select) with a live mini-preview via `QuizQuestionRenderer`.
  - Editor save payload includes `theme` and keeps `background: quiz.theme.background` for back-compat.

- [ ] **Step 1: Create the `ThemeBuilder` component**

Create `client/src/components/quiz/ThemeBuilder.tsx`:

```tsx
import type { QuizTheme, QuizFont, QuizCardStyle } from "@shared/quiz-theme";
import { PRESET_QUIZ_THEMES } from "@shared/quiz-theme";
import { getThemeSwatchStyle, PRESET_THEMES } from "@/utils/backgrounds";
import { QuizQuestionRenderer } from "./QuizQuestionRenderer";
import { ImagePlus } from "lucide-react";

const FONTS: QuizFont[] = ["sans", "serif", "rounded", "mono"];
const CARD_STYLES: QuizCardStyle[] = ["solid", "soft", "outline"];

export interface ThemeBuilderProps {
  theme: QuizTheme;
  onChange: (theme: QuizTheme) => void;
  onUploadBackground: (file: File) => void;
  uploading?: boolean;
}

export function ThemeBuilder({ theme, onChange, onUploadBackground, uploading }: ThemeBuilderProps) {
  const set = (patch: Partial<QuizTheme>) => onChange({ ...theme, ...patch });
  const previewQuestion = {
    question: "Sample question preview",
    answers: ["Answer A", "Answer B", "Answer C", "Answer D"],
    answerType: "single" as const,
    type: "quiz" as const,
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-4">
      <div className="space-y-4">
        {/* Presets */}
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-1">Preset themes</div>
          <div className="grid grid-cols-4 gap-2">
            {PRESET_QUIZ_THEMES.map((p) => {
              const swatch = PRESET_THEMES.find((t) => t.id === p.theme.background);
              return (
                <button
                  key={p.id}
                  onClick={() => onChange(p.theme)}
                  className={`h-12 rounded-lg border-2 relative ${theme.background === p.theme.background ? "border-abraj-primary" : "border-transparent"}`}
                  style={swatch ? getThemeSwatchStyle(swatch) : { background: p.theme.accent }}
                  title={p.label}
                />
              );
            })}
          </div>
        </div>

        {/* Custom background upload */}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <ImagePlus className="w-4 h-4" /> {uploading ? "Uploading…" : "Custom background image"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadBackground(f); e.target.value = ""; }} />
        </label>

        {/* Colors */}
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs text-gray-500">Accent
            <input type="color" value={theme.accent} onChange={(e) => set({ accent: e.target.value })} className="block w-full h-8 mt-1" />
          </label>
          <label className="text-xs text-gray-500">Question text
            <input type="color" value={theme.questionText} onChange={(e) => set({ questionText: e.target.value })} className="block w-full h-8 mt-1" />
          </label>
          <label className="text-xs text-gray-500">Question card
            <input type="color" value={theme.questionCard} onChange={(e) => set({ questionCard: e.target.value })} className="block w-full h-8 mt-1" />
          </label>
        </div>

        {/* Font + card style */}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">Font
            <select value={theme.font} onChange={(e) => set({ font: e.target.value as QuizFont })} className="block w-full mt-1 border rounded p-1 text-sm">
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Card style
            <select value={theme.cardStyle} onChange={(e) => set({ cardStyle: e.target.value as QuizCardStyle })} className="block w-full mt-1 border rounded p-1 text-sm">
              {CARD_STYLES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Live preview — the real renderer */}
      <div className="h-72">
        <div className="text-xs font-semibold text-gray-500 mb-1">Live preview</div>
        <div className="h-64">
          <QuizQuestionRenderer question={previewQuestion} theme={theme} questionNumber={1} totalQuestions={5} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Thread `theme` through the editor's form state**

In `client/src/pages/quiz-editor.tsx`:
1. Import: `import { resolveQuizTheme, type QuizTheme } from "@shared/quiz-theme"; import { ThemeBuilder } from "@/components/quiz/ThemeBuilder";`
2. Extend `QuizForm` (~25):

```ts
interface QuizForm {
  title: string;
  description: string;
  background: string;
  isPublic: boolean;
  theme: QuizTheme;
  questions: Question[];
}
```

3. Initialize state (~77):

```ts
  const [quiz, setQuiz] = useState<QuizForm>({
    title: "",
    description: "",
    background: "aurora",
    isPublic: true,
    theme: resolveQuizTheme({ background: "aurora" }),
    questions: [blankQuestion()],
  });
```

4. In the edit-mode load `setQuiz(...)` (~121), add `isPublic: loaded.isPublic ?? true,` and `theme: resolveQuizTheme(loaded),` and keep `background: loaded.background || "aurora"`.

- [ ] **Step 3: Replace the theme dialog body with `ThemeBuilder`**

In `client/src/pages/quiz-editor.tsx`, replace the `<DialogContent>` grid inside the Theme picker (~596–619) with:

```tsx
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Quiz theme</DialogTitle></DialogHeader>
                <ThemeBuilder
                  theme={quiz.theme}
                  uploading={uploading}
                  onChange={(theme) => setQuiz((p) => ({ ...p, theme, background: theme.background }))}
                  onUploadBackground={uploadThemeImage}
                />
              </DialogContent>
```

Update the dialog trigger button's `style` (~594) to preview the themed background: `style={getBackgroundStyle(quiz.theme.background)}`.

Update `uploadThemeImage` (~237) to also patch the theme background: after `setQuiz((prev) => ({ ...prev, background: url }))`, change it to:

```ts
      setQuiz((prev) => ({ ...prev, background: url, theme: { ...prev.theme, background: url } }));
```

- [ ] **Step 4: Include `theme` + `isPublic` in the save payload**

In `saveMutation.mutationFn` payload (~270), change `background` and add `theme`/`isPublic`:

```ts
      const payload: any = {
        title: quiz.title.trim(),
        description: quiz.description.trim(),
        background: quiz.theme.background,
        theme: quiz.theme,
        questions: quiz.questions,
        isPublic: quiz.isPublic,
        createdBy: (isEditMode ? loaded?.createdBy : undefined) ?? user?.id,
      };
```

- [ ] **Step 5: Point the editor canvas background at the themed background**

The center `<main>` `style={getBackgroundStyle(quiz.background)}` (~457) → `style={getBackgroundStyle(quiz.theme.background)}`.

- [ ] **Step 6: Type-check + build**

Run: `npm run check && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/quiz/ThemeBuilder.tsx client/src/pages/quiz-editor.tsx
git commit -m "feat(theme): custom theme builder + expanded presets in the editor"
```

---

### Task 8: Apply the theme across preview, host, and player

**Files:**
- Modify: `client/src/pages/quiz-preview.tsx`, `client/src/pages/play-game.tsx` (renderer usage ~577), `client/src/pages/host-game.tsx` (renderer usage ~529)
- Test: type-check + Task 14 browser pass.

**Interfaces:**
- Consumes: `resolveQuizTheme` (Task 5), the theme-aware `QuizQuestionRenderer` (Task 6).
- Produces: preview/host/player all pass `theme={resolveQuizTheme(quiz)}` to the renderer, so the themed look is identical across all three.

- [ ] **Step 1: Preview passes the resolved theme**

In `client/src/pages/quiz-preview.tsx`:
1. Import `resolveQuizTheme`.
2. Compute `const theme = resolveQuizTheme(quiz);` after the quiz loads (~40).
3. Pass `theme={theme}` to BOTH `<QuizQuestionRenderer>` usages (host view ~59 and participant/shape-only ~74). Keep `background={bg}` as a harmless fallback or drop it (theme owns background now).

- [ ] **Step 2: Player passes the resolved theme**

In `client/src/pages/play-game.tsx`:
1. Import `resolveQuizTheme`. The page already has the game/quiz — find where `quiz` (or `game.quiz`) is available. Compute `const theme = resolveQuizTheme(game?.quiz ?? {})` (adjust to the page's actual quiz source; grep for `background` usage in the file to find it).
2. Pass `theme={theme}` to the `<QuizQuestionRenderer>` at ~577.

- [ ] **Step 3: Host passes the resolved theme**

In `client/src/pages/host-game.tsx`, same as Step 2 but for the `<QuizQuestionRenderer>` at ~529.

- [ ] **Step 4: Type-check + build**

Run: `npm run check && npm run build`
Expected: no errors; build succeeds. (If the quiz object shape on play/host lacks `theme`, `resolveQuizTheme` still works — it reads `background` + optional `theme`.)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/quiz-preview.tsx client/src/pages/play-game.tsx client/src/pages/host-game.tsx
git commit -m "feat(theme): apply resolved theme across preview, host, and player"
```

---

### Task 9: Theme-branded PDF reports

**Files:**
- Modify: `client/src/utils/enhanced-pdf-generator.ts` (theme block ~37–62)
- Test: type-check + a smoke render in Task 14.

**Interfaces:**
- Consumes: `resolveQuizTheme` (Task 5), the quiz's `background`/`theme`.
- Produces: the PDF's header/accent color derives from `resolveQuizTheme(quiz).accent` (hex → RGB) instead of the fixed `themes` lookup keyed only by background. Answer option colors stay the fixed 6-palette (unchanged).

- [ ] **Step 1: Derive the report accent from the resolved theme**

In `client/src/utils/enhanced-pdf-generator.ts`, add a small hex→RGB helper and use the resolved theme's `accent` for the header/accent color. Near the top of the generator function (~37):

```ts
import { resolveQuizTheme } from "@shared/quiz-theme";

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

const resolvedTheme = resolveQuizTheme(game.quiz ?? {});
const accentRgb = hexToRgb(resolvedTheme.accent);
```

Where the current code picks `currentTheme` from the `themes` record by background (~55–62), keep the background-image handling but override the header/accent fill/draw colors with `accentRgb` (replace the `currentTheme.primary`/header color usages with `accentRgb`). Do NOT touch the `answerColors` used for option boxes (~307) — those remain the fixed palette.

- [ ] **Step 2: Type-check + build**

Run: `npm run check && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/enhanced-pdf-generator.ts
git commit -m "feat(theme): brand PDF reports with the resolved quiz accent"
```

---

## Phase C — Editor polish & settings

### Task 10: Editor answer tiles use the shared fixed-size sizing

**Files:**
- Modify: `client/src/pages/quiz-editor.tsx` (answers grid ~497–536)
- Test: type-check + Task 14 visual pass.

**Interfaces:**
- Consumes: `ANSWER_STYLES`/`answerStyle` (`lib/answer-style.ts`), `ANSWER_CARD_MIN_H` (`components/quiz/AnswerCard.tsx`).
- Produces: editor answer tiles are the SAME fixed height as the live cards (`ANSWER_CARD_MIN_H`), laid out on the same 2-col `auto-rows-fr` grid, with the color/shape from `answerStyle(index)` — but they stay editable (contain the `<Input>` + correct toggle + remove). Long text never resizes a tile.

- [ ] **Step 1: Rework the answers grid to fixed-size editable tiles**

In `client/src/pages/quiz-editor.tsx`, replace the answers `<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">` block (~498–528) with a fixed grid mirroring `AnswerGrid`:

```tsx
            <div className="grid grid-cols-2 auto-rows-fr gap-2 sm:gap-3">
              {current.answers.map((answer, index) => {
                const style = answerStyle(index);
                const Icon = style.icon;
                const isCorrect = current.correctAnswers.includes(index);
                return (
                  <div key={index} className={`${style.bg} ${ANSWER_CARD_MIN_H} rounded-xl p-2 sm:p-3 flex items-center gap-2 text-white`}>
                    <Icon className="w-5 h-5 shrink-0" fill="white" strokeWidth={0} />
                    <Input
                      value={answer}
                      onChange={(e) => setAnswerText(index, e.target.value)}
                      placeholder={`Answer ${index + 1}`}
                      disabled={current.type === "true_false"}
                      className="bg-white/90 text-gray-900 border-0 h-9"
                    />
                    <button
                      title={isCorrect ? "Correct" : "Mark correct"}
                      onClick={() => toggleCorrect(index)}
                      aria-pressed={isCorrect}
                      className={`shrink-0 w-7 h-7 rounded-full border-2 border-white flex items-center justify-center ${isCorrect ? "bg-white" : "bg-transparent"}`}
                    >
                      {isCorrect && <Check className="w-4 h-4 text-green-600" />}
                    </button>
                    {current.type !== "true_false" && current.answers.length > 2 && (
                      <button title="Remove answer" aria-label={`Remove answer ${index + 1}`} onClick={() => removeAnswer(index)}>
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
```

Add the import: `import { ANSWER_CARD_MIN_H } from "@/components/quiz/AnswerCard";`

- [ ] **Step 2: Type-check + build**

Run: `npm run check && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/quiz-editor.tsx
git commit -m "refactor(editor): fixed-size answer tiles matching the shared grid"
```

---

### Task 11: Settings modal + Points control + No-limit timer option

**Files:**
- Create: `client/src/components/quiz/QuizSettingsDialog.tsx`
- Modify: `client/src/pages/quiz-editor.tsx` (top bar ~376–427; TIME_OPTIONS ~32; properties panel ~541–631; `blankQuestion`/`trueFalseQuestion`/`fromGenerated` ~34–67)
- Test: type-check + Task 14.

**Interfaces:**
- Consumes: shadcn `Dialog`, `Input`, `Textarea`, `Select`, `Switch` (or a checkbox), the editor's `quiz` state + setters.
- Produces:
  - `QuizSettingsDialog({ open, onOpenChange, title, description, isPublic, onChange })` — title, description, visibility (public/private) controls.
  - Editor top bar gets a Settings button opening it.
  - `TIME_OPTIONS` includes all spec values; a `0` "No limit" entry is added to the time select.
  - Question properties panel gets a Points control (Standard / Double).
  - `blankQuestion()`/`trueFalseQuestion()`/`fromGenerated()` set `points: "standard"`.

- [ ] **Step 1: Add `points` to the question factories**

In `client/src/pages/quiz-editor.tsx`, add `points: "standard",` to the objects returned by `blankQuestion` (~35), `trueFalseQuestion` (~46), and `fromGenerated` (~59), and to the mapped questions in the edit-load `map` (~108) add `points: q.points ?? "standard",`.

- [ ] **Step 2: Extend the time options with No limit**

Replace `const TIME_OPTIONS = [5, 10, 20, 30, 60, 90, 120];` (~32) with:

```ts
const TIME_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
```

In the Time-limit `<Select>` (~557), render a "No limit" option using `0`:

```tsx
              <SelectContent>
                <SelectItem value="0">No limit</SelectItem>
                {TIME_OPTIONS.map((t) => <SelectItem key={t} value={String(t)}>{t} seconds</SelectItem>)}
              </SelectContent>
```

(The `onValueChange` already does `parseInt(v, 10)`, so `"0"` → `0`.)

- [ ] **Step 3: Add the Points control to the properties panel**

In the properties panel, after the Answer-options block (~587), add:

```tsx
          <div>
            <label className="text-xs text-gray-500">Points</label>
            <Select value={current.points} onValueChange={(v) => patchQuestion(currentIndex, { points: v as Question["points"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="double">Double points</SelectItem>
              </SelectContent>
            </Select>
          </div>
```

- [ ] **Step 4: Create `QuizSettingsDialog`**

Create `client/src/components/quiz/QuizSettingsDialog.tsx`:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface QuizSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  isPublic: boolean;
  onChange: (patch: { title?: string; description?: string; isPublic?: boolean }) => void;
}

export function QuizSettingsDialog({ open, onOpenChange, title, description, isPublic, onChange }: QuizSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Quiz settings</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500">Title</label>
            <Input value={title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Quiz title" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Description</label>
            <Textarea value={description} onChange={(e) => onChange({ description: e.target.value })} rows={3} placeholder="Optional description" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Visibility</label>
            <Select value={isPublic ? "public" : "private"} onValueChange={(v) => onChange({ isPublic: v === "public" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public — anyone can host</SelectItem>
                <SelectItem value="private">Private — only you</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Wire the Settings button into the top bar**

In `client/src/pages/quiz-editor.tsx`, add `import { QuizSettingsDialog } from "@/components/quiz/QuizSettingsDialog"; import { Settings } from "lucide-react";` and a `const [settingsOpen, setSettingsOpen] = useState(false);`. In the top-bar action group (~376), before "Create with AI", add:

```tsx
          <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings className="w-4 h-4 mr-1" /> Settings</Button>
```

and render the dialog once (near the header close):

```tsx
      <QuizSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={quiz.title}
        description={quiz.description}
        isPublic={quiz.isPublic}
        onChange={(patch) => setQuiz((p) => ({ ...p, ...patch }))}
      />
```

The description block in the right panel (~623) is now redundant — remove it (title/description live in Settings; title stays in the top-bar input too).

- [ ] **Step 6: Type-check + build**

Run: `npm run check && npm run build`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/quiz/QuizSettingsDialog.tsx client/src/pages/quiz-editor.tsx
git commit -m "feat(editor): settings modal (visibility), points control, no-limit timer option"
```

---

### Task 12: No-limit UI in host + player; sidebar thumbnails reflect structure

**Files:**
- Modify: `client/src/pages/host-game.tsx` (timer usage ~534, Next button ~509–521), `client/src/pages/play-game.tsx` (timer ~582), `client/src/pages/quiz-editor.tsx` (sidebar rail ~432–450)
- Test: type-check + Task 14.

**Interfaces:**
- Consumes: `durationSeconds === 0` / `timeRemaining` semantics from Task 2–3; the renderer's `timeRemaining` prop (null hides the chip).
- Produces:
  - Host + player hide the countdown chip for no-limit questions (pass `timeRemaining={null}`), and the host's Next button remains the way to close/advance (already true).
  - Editor sidebar thumbnail shows the answer-shape mini-grid + type + time (or ∞), reflecting the actual question structure per spec §2.

- [ ] **Step 1: Hide the countdown for no-limit on host + player**

In `client/src/pages/host-game.tsx` and `play-game.tsx`, the timer comes from `runtimeState.timeRemaining` / `timeLeft` derived from `question_started`. When `durationSeconds === 0`, the client should treat it as no-limit and pass `timeRemaining={null}` to the renderer. Where each page stores the started message, capture `durationSeconds` (add a `noLimit` flag: `durationSeconds === 0`). Then at the renderer call sites:
- host `~534`: `timeRemaining={!showResults && !noLimit ? timeLeft : null}`
- play `~582`: `timeRemaining={noLimit ? null : timeLeft}`

(Grep each page for where `question_started` / `durationSeconds` is handled to set `noLimit`. If the page doesn't yet read `durationSeconds`, add it alongside the existing `timeRemaining` handling.)

- [ ] **Step 2: Editor sidebar thumbnail reflects structure**

In `client/src/pages/quiz-editor.tsx` sidebar rail (~433–449), replace the thumbnail body so it shows a mini shape grid + type + time (∞ for no-limit):

```tsx
              <div className="flex items-center justify-between mb-1 text-gray-500">
                <span>{i + 1} · {q.type === "true_false" ? "T/F" : "Quiz"}</span>
                <div className="flex gap-1">
                  <button title="Duplicate" onClick={(e) => { e.stopPropagation(); duplicateQuestion(i); }}><Copy className="w-3 h-3" /></button>
                  {quiz.questions.length > 1 && (
                    <button title="Delete" onClick={(e) => { e.stopPropagation(); removeQuestion(i); }}><Trash2 className="w-3 h-3 text-red-500" /></button>
                  )}
                </div>
              </div>
              <div className="line-clamp-2 font-medium text-gray-800">{q.question || "Untitled"}</div>
              <div className="mt-1 flex items-center justify-between">
                <div className="grid grid-cols-2 gap-0.5">
                  {q.answers.slice(0, 6).map((_, ai) => {
                    const Icon = answerStyle(ai).icon;
                    return <span key={ai} className={`${answerStyle(ai).bg} w-3 h-3 rounded-sm flex items-center justify-center`}><Icon className="w-2 h-2" fill="white" strokeWidth={0} /></span>;
                  })}
                </div>
                <span className="text-[10px] text-gray-400">{q.timeLimit === 0 ? "∞" : `${q.timeLimit}s`}</span>
              </div>
```

- [ ] **Step 3: Type-check + build**

Run: `npm run check && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/host-game.tsx client/src/pages/play-game.tsx client/src/pages/quiz-editor.tsx
git commit -m "feat(session): no-limit UI (hide countdown) + structure-reflecting sidebar thumbnails"
```

---

### Task 13: Fix the classroom background not rendering + in-editor preview modal

**Files:**
- Verify/fix: `client/src/utils/backgrounds.ts` (classroom path ~25), asset presence under `client/public/attached_assets/` (or wherever static assets resolve)
- Modify: `client/src/pages/quiz-editor.tsx` (Preview button ~418–422)
- Test: Task 14 browser pass confirms the fix.

**Interfaces:**
- Consumes: `getBackgroundStyle` (already returns `url(/attached_assets/classroom-background.jpg)` for `classroom`).
- Produces: the classroom (and other image themes) actually render in preview/host/player; the editor Preview works from in-memory state (create mode too) via a modal using the shared renderer.

- [ ] **Step 1: Diagnose the classroom asset path (systematic-debugging)**

Use `superpowers:systematic-debugging`. Confirm where static assets are served from and whether `/attached_assets/classroom-background.jpg` resolves:

```bash
ls client/public/attached_assets/ 2>/dev/null || ls attached_assets/ 2>/dev/null || find . -name "classroom-background.*" -not -path "./node_modules/*"
```

Then check the running dev server: `curl -sI http://localhost:5000/attached_assets/classroom-background.jpg` (start `npm run dev` if needed). Identify whether the file is missing, in the wrong directory, or the URL prefix is wrong. Fix the mismatch (move/rename the asset into the served static dir, or correct the `IMAGE_THEMES` `css` paths in `backgrounds.ts`). Do not guess — confirm the served path first.

- [ ] **Step 2: Verify the fix renders**

Reload the preview page for a classroom-themed quiz; the classroom image shows (not a dark fallback). Confirm the other four image themes (`space`, `ocean`, `forest`, `city`) resolve too.

- [ ] **Step 3: In-editor Preview modal from live state**

In `client/src/pages/quiz-editor.tsx`, replace the edit-only Preview button (~418) with a modal that previews the CURRENT in-memory quiz (works in create mode and reflects unsaved changes, satisfying spec §9). Add a `const [previewOpen, setPreviewOpen] = useState(false)` and `const [previewIdx, setPreviewIdx] = useState(0)`, a Preview button always visible in the top bar, and a dialog:

```tsx
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Preview</DialogTitle></DialogHeader>
          <div className="h-[460px]">
            <QuizQuestionRenderer
              question={quiz.questions[Math.min(previewIdx, quiz.questions.length - 1)]}
              theme={quiz.theme}
              questionNumber={Math.min(previewIdx, quiz.questions.length - 1) + 1}
              totalQuestions={quiz.questions.length}
              reveal
              correctAnswers={quiz.questions[Math.min(previewIdx, quiz.questions.length - 1)]?.correctAnswers}
            />
          </div>
          <div className="flex items-center justify-center gap-4">
            <Button variant="ghost" size="sm" disabled={previewIdx === 0} onClick={() => setPreviewIdx((i) => i - 1)}>Prev</Button>
            <span className="text-sm text-gray-500">{Math.min(previewIdx, quiz.questions.length - 1) + 1} / {quiz.questions.length}</span>
            <Button variant="ghost" size="sm" disabled={previewIdx >= quiz.questions.length - 1} onClick={() => setPreviewIdx((i) => i + 1)}>Next</Button>
          </div>
        </DialogContent>
      </Dialog>
```

Add `import { QuizQuestionRenderer } from "@/components/quiz/QuizQuestionRenderer";` and make the top-bar Preview button `onClick={() => { setPreviewIdx(currentIndex); setPreviewOpen(true); }}` (drop the `isEditMode &&` guard). Keep the standalone `/preview/:quizId` route (Task 8) for sharing a saved quiz.

- [ ] **Step 4: Type-check + build**

Run: `npm run check && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/backgrounds.ts client/src/pages/quiz-editor.tsx
git commit -m "fix(theme): resolve image-theme asset path + in-editor live preview modal"
```

(Include the moved/renamed asset in the `git add` if Step 1 relocated it.)

---

## Phase D — Verification

### Task 14: Exhaustive functional + visual acceptance and final report

**Files:**
- Read/verify only; produce `docs/superpowers/plans/2026-07-16-quiz-experience-v2-report.md`
- Uses: `superpowers:verification-before-completion`, `claude-in-chrome` (browser E2E), `superpowers:requesting-code-review`

**Interfaces:**
- Consumes: everything above.
- Produces: a completed acceptance checklist + the spec §18/final-report deliverable, and a green `check && test && build`.

- [ ] **Step 1: Full automated gate (verification-before-completion)**

Run and capture output — do not claim success without it:

```bash
npm run check && npm test && npm run build
```

Expected: type-check clean; all unit tests pass (43 existing + new schema/theme/engine cases); client+server build succeed. Run `npm run integration` if the integration DB is reachable (else note deferral to CI).

- [ ] **Step 2: Browser E2E — creation flow (claude-in-chrome)**

Start `npm run dev` (`:5000`, prod DB, test user `haitham900`). Load the browser tools (single `ToolSearch` select call). Drive and screenshot:
- Create a new quiz; open **Settings**, set title/description, toggle **Private** then **Public**.
- Add a 6-answer quiz question (image upload → Supabase URL renders), a **True/False** question, and a **multi-select** question.
- Set one question to **Double points** and one to **No limit** (timer shows ∞ in the rail).
- Open the **Theme** builder: pick a preset, then customize accent/question-card/font/card-style; confirm the live preview updates.
- Click **Preview** (top bar) — confirm it reflects unsaved changes and matches the themed look.
- Save; reload via `/edit-quiz/:id` — all fields (answers, points, no-limit, theme, visibility) persist.

- [ ] **Step 3: Browser E2E — host/play flow**

Host the saved quiz; join as a player in a second tab. Verify, with screenshots:
- Theme background/accent/font identical across host and player and matching the preview.
- Fixed-size answer cards with long text (no grid growth); 6 colors/shapes.
- Multi-select submit posts the bitmask; scoring is all-or-nothing.
- Double-points question awards ~2× a comparable standard question.
- No-limit question shows **no countdown**; the host **Next** button closes/advances it.
- Classroom (and other image) themes render (regression fixed).
- Results/leaderboard reflect the theme; generate the PDF report — accent matches the theme, multi-correct answers and up to 6 options render correctly.
- Check the console/network: no errors, no `correctAnswers` leaked to the player mid-question (inspect the answer-submit response).

- [ ] **Step 4: Responsive pass**

Resize to tablet and mobile widths; confirm the editor (sidebar/canvas/panel), preview, host, and player remain usable and the answer grid stays balanced at 2/3/4/5/6 answers with short and long text.

- [ ] **Step 5: Write the final report**

Create `docs/superpowers/plans/2026-07-16-quiz-experience-v2-report.md` covering the spec's 13 required items: summary, root causes of the prior mismatch, architecture changes, DB/API changes (theme column + migration 0007, points/no-limit), files changed, features added, visual comparison results (attach screenshot paths), functional test results, browser+mobile verification, known limitations (cover image/language/drag-reorder deferred), migration & deploy steps (**run `0007_quiz_theme.sql` before the code deploy**; `SUPABASE_URL`/`SERVICE_ROLE_KEY` already set), rollback plan (revert commits; the `theme` column is nullable and ignored by old code), production-readiness verdict.

- [ ] **Step 6: Request code review**

Use `superpowers:requesting-code-review` (or `/code-review high`) on the branch diff. Address findings, re-run the Step 1 gate, then update memory `kahoot-revamp.md` with the V2-remaining status and open the PR without merging (per spec §19).

- [ ] **Step 7: Update the test-cleanup + deploy notes**

Confirm the deploy checklist in the report includes: apply migration `0007`; the prod test artifacts to clean up (quiz "Prime Numbers Quiz" id 265 + its game, per memory); and that PRs merge in order #4 → #5 → #6.

---

## Self-Review

**1. Spec coverage (19 sections):**
- §1 audit — done last session (shared renderer). §2 editor layout — Tasks 10, 11, 12 (+ §2 done partially). §3 image support — already shipped (PR1/PR2); verified in Task 14. §4 answers 2–6 — shipped; editor tiles fixed in Task 10. §5 True/False — shipped; verified Task 14. §6 single/multi — shipped; verified Task 14. §7 time limit incl. No-limit — Tasks 2, 3, 11, 12. §8 theme system + custom builder — Tasks 5–9. §9 preview — Tasks 8, 13. §10 live session — Tasks 8, 12. §11 fixed sizing — shipped (AnswerCard/Grid) + editor Task 10. §12 shared architecture — done; extended (QuizThemeProvider) Task 6. §13 data model — Task 1 (+ points/theme/no-limit). §14 functional verification — Task 14. §15 error handling — upload/save errors already toast-handled (verify Task 14). §16 accessibility — `aria-pressed`/labels added in Tasks 6/10/11 (verify Task 14). §17 testing — Tasks 1–5 unit + Task 14 E2E. §18 visual acceptance — Task 14. §19 process — phased tasks + PR-without-merge (Task 14).
- **Points** (spec §2/§6 settings) — Tasks 1, 2, 11. **Visibility** — Task 11. Gaps: cover image, language, drag-reorder — intentionally deferred (documented in "Out of scope").

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — each code step carries real code. Two steps intentionally require in-file grepping (Task 8 play/host quiz source; Task 12 `durationSeconds` handling) because those exact line numbers weren't read; each says exactly what to grep for and why.

**3. Type consistency:** `QuizTheme` fields (`background`, `accent`, `questionText`, `questionCard`, `font`, `cardStyle`) are identical across Tasks 5→6→7→8→9. CSS var names (`--quiz-accent`, `--quiz-question-text`, `--quiz-question-card`, `--quiz-font`, `--quiz-card-radius`, `--quiz-card-shadow`) match between `themeToCssVars` (Task 5), `QuizThemeProvider`/renderer/`AnswerCard` (Task 6). `questionPointsSchema`/`points: "standard"|"double"` consistent across schema (Task 1), engine (Task 2), editor factories + control (Task 11). `timeLimit === 0` sentinel consistent across schema (Task 1), engine (Task 2), protocol (Task 3), UI (Tasks 11, 12). `resolveQuizTheme(quiz)` signature `{ background?, theme? }` matches every call site.
