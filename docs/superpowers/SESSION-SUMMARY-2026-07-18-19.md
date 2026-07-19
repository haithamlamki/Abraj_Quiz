# Session Summary — 2026-07-18 → 2026-07-19

Handoff doc for continuing in a new session. Four roadmap subsystems shipped end-to-end
(brainstorm → spec → plan → subagent execution with per-task + whole-branch reviews →
browser QA → merge). Everything below is **merged to `main`** unless noted.

**`main` tip:** `d0ec05f`. Standard gate on main: `npm run check` clean, `npm test` 132/132, `npm run build` OK.
**Migrations applied to the live Supabase DB (project `bvtbjijbebhubowvhbrp`):** 0009 and 0010 (verified via `npm run integration`).

---

## 1. Question Bank (PRs #25 → #26 → #27, all merged)

A per-tenant library of reusable questions.

- **Data model:** `bank_questions` table (migration **0009**) — `tenant_id` + `tenant_isolation` RLS pair + FORCE RLS + `quiz_app` grants, GIN index on `tags`. Stores the canonical question JSON + `subject` (text) + `tags` (jsonb) + soft-delete (`deleted_at`).
- **Copy + provenance model:** adding a bank question to a quiz **copies** its JSON into the quiz's inline `questions` array and stamps a `sourceQuestionId` (new optional field on the question schema). Snapshot semantics; a future "re-sync" prompt can key off the id. Gameplay untouched (still reads inline jsonb).
- **Server:** 7 bank methods on `IStorage` (both MemStorage + DatabaseStorage) — list/get/create/update/archive/restore + `getBankSubjectsAndTags`. New `server/bank-routes.ts` uses **dependency injection** (`{storage, requireAuth, tctx}`) so routes are HTTP-testable against MemStorage on an ephemeral express server (the repo's first route-level tests). ILIKE search escapes `%`/`_` to match MemStorage's literal semantics.
- **Client:** `/question-bank` page (search / subject filter / tag chips / archived toggle / create-edit-archive-restore), shared `QuestionForm` + `TagInput` + `BankQuestionDialog`, editor integration — "Save to bank" (strips stale provenance) and "Add from bank" picker (deep copy + `sourceQuestionId` stamp). Full EN+AR.
- **Reviews caught 2 real bugs the plan itself authored:** (a) ILIKE wildcard-escape parity gap; (b) `trueFalseQuestion` dropping `sourceQuestionId` on a type switch (merge→replace regression). Both fixed + tested.
- **Key facts:** browser-QA'd (provenance verified in Postgres). Ownership is tenant-shared (`created_by` = attribution only; per-user gating waits for the RBAC/Enterprise wave).

## 2. Integration-suite repair (PR #28, merged)

Found while verifying migration 0009: 4 of 7 `tests/integration/` files asserted the **legacy** `{correctAnswer}` question shape — they predated the Kahoot revamp's normalize-on-write migration and the energy-pack streak feature, and the suite needs a live DB so it never runs in the `npm test` gate (silent rot).

- Updated expectations to canonical `correctAnswers[]`; sanitized views now assert **both** answer-key fields absent (stronger leak guard); answer ACK asserts exact `{success, streak}`.
- Result: `npm run integration` → **7/7 files, 26 passed / 1 skipped** against the live DB.
- **BACKLOG:** wire `npm run integration` into a scheduled/pre-deploy check so it can't rot again.

## 3. Insights question-snapshot fix (PR #29, merged)

Editing a quiz used to misattribute historical per-question insights (index-based grouping against the live quiz).

- **Data model:** `games.questions_snapshot` jsonb (migration **0010**, nullable, no backfill; rides the existing games RLS policy).
- **Engine:** the runtime room **freezes** the normalized question set ONCE at first hydration (`game-room-manager.ts`, `updateGame(SYSTEM_CTX, …)` — not on timer ticks) and **replays it on rehydration** — a quiz edit + server restart can no longer swap questions under an in-flight game.
- **Insights:** `server/insights.ts` (pure, unit-tested) attributes each game's responses to its snapshot texts (current quiz as fallback for pre-0010 games) and merges across games keyed by trimmed question text — current-quiz rows first, historical (edited-away/deleted) rows appended. Both storage backends delegate to it (parity by construction). API shape unchanged → zero client changes.
- **The opus whole-branch review caught a Critical the spec + plan + 5 per-task reviews all missed:** the snapshot column carries answer keys, and every pre-existing `...game` spread (2 unauthenticated HTTP endpoints + 4 WS broadcasts) would have shipped them to players mid-game. **Fixed** with a `toClientGame()` strip helper at every client boundary + `ClientGame` return-type narrowing + a broadcast-scan regression test.
- **LESSON (in memory):** adding a column to a client-visible row (`games`) requires auditing every `...spread` to clients.

## 4. AI content upgrade (PRs #30 → #31, all merged)

Migrated the 5 AI generators off the legacy `{correctAnswer}` shape.

- **Schema (additive):** optional `difficulty` (`easy|medium|hard`) + `explanation` (string ≤500) on the question schema; new `generatedQuizSchema` validates AI output.
- **Generation (`server/openai-service.ts`):** canonical-native prompts emit mixed types (single-select / true-false / multi-select) + per-question difficulty/explanation + quiz-level subject/tags; validated by Zod with **one error-fed retry**; ~80 lines of hand-rolled validation deleted; pure `parseGeneratedQuiz`/`buildGenerationPrompt` helpers unit-tested without live OpenAI; `gpt-4o` pinned; `generateBackgroundImage` untouched.
- **Security:** `explanation` is answer-key-equivalent → stripped in `sanitizeQuizForCaller` alongside `correctAnswers`. Whole-branch review re-traced the full leak surface (incl. the game snapshot, covered by `toClientGame`) — clear.
- **Bank persistence:** new `POST /api/bank/questions/bulk` (atomic, 1..50, per-item validated, `createdBy` stamped) + `createBankQuestions` on both backends — **built to be the Import wave's foundation**. Editor AI dialog has an "Also save to Question Bank" checkbox (default on, fire-and-forget).
- **Client:** `normalizeGeneratedQuestions` (schema-validated passthrough, drops invalid); `QuestionForm` gains difficulty select + explanation textarea; bank cards show a difficulty badge. Full EN+AR incl. Arabic CLDR plurals.
- **Browser QA passed** against live GPT-4o: mixed types (single + 2× true-false + multi-select "fire triangle"), auto-title, bulk-save with difficulty badges + Fire Safety subject + tags, editable difficulty/explanation.

---

## Open BACKLOG items (from this session, in `BACKLOG.md`)

1. **Product decision:** AI `explanation` is exposed in the COMPLETED-game `/api/games/:pin/results` payload (the intended answer-reveal boundary, same as `correctAnswers`). Decide whether explanations should instead wait for a dedicated post-question reveal — if so, strip `explanation` from the completed-results quiz too.
2. Wire `npm run integration` into a scheduled/pre-deploy check (can't rot silently again).
3. `mapOpenAiError` fallback echoes raw `error.message` (pre-existing) — map unknown errors to a generic string.
4. Minor cleanups: `applyGenerated` calls `normalizeGeneratedQuestions` twice; `subject` trim-transform idiom duplicated between two schemas.

## Recommended next subsystem — Import pipeline (roadmap Wave 4+ item 4)

Excel/CSV/Word/PPT → strict validation → never-corrupt guarantee. **Its foundation already exists**: `POST /api/bank/questions/bulk` (atomic, per-item validated) and `generatedQuizSchema` validation were built with Import in mind. Likely new deps: `xlsx`/SheetJS, `mammoth` (docx), a pptx parser — each vetted against `npm audit --omit=dev`. Start with `superpowers:brainstorming`.

## Working method that worked well this session

`superpowers:brainstorming` (1 question at a time) → spec (committed) → `superpowers:writing-plans` (complete code per task) → `superpowers:subagent-driven-development`: cheap-model implementers for transcription tasks, sonnet for judgment, **opus for the final whole-branch review** (it caught the Criticals per-task reviews missed) → browser QA with the user clicking login → ordered merge of stacked PRs (retarget each child to main BEFORE deleting its parent — deleting a parent branch closes stacked children). Progress tracked in `.superpowers/sdd/progress.md` (recovery ledger).
