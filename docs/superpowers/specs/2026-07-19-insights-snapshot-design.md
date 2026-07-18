# Insights Question-Snapshot Fix — Design Spec

> **Status:** Approved design, pre-implementation.
> **Date:** 2026-07-19
> **Source roadmap:** `docs/superpowers/plans/2026-07-18-product-polish-enterprise-audit.md` §4 Wave 4+ item 2 ("unblocks trustworthy Reporting").
> **Constraints (CLAUDE.md hard rules):** additive-only schema; never write to DB on timer ticks (the one new write happens once, at room hydration); server authoritative; game engine uses SYSTEM_CTX (existing pattern); no client changes required.

## 1. Problem

`getQuizInsights` (both `MemStorage` and `DatabaseStorage`) groups `game_responses` by `questionIndex` and joins against the **current** `quizzes.questions` array by position. Editing a quiz after games were played misattributes history:

- **Reorder** → stats swap between questions.
- **Edit text** → old stats attach to the new text.
- **Delete** → that index's stats attach to whatever question slid into the slot (or vanish).

Any future Reporting/trends feature inherits this corruption; the audit gates Reporting on this fix.

## 2. Solution — snapshot at room hydration

### Data model (migration `0010_game_question_snapshot.sql`)

```sql
ALTER TABLE games ADD COLUMN IF NOT EXISTS questions_snapshot jsonb;
```

- Nullable, additive; covered by the existing `games` `tenant_isolation` policy (row policy applies to all columns — same rationale as 0008).
- Drizzle: `questionsSnapshot: jsonb("questions_snapshot")` on `games` (typed `Question[] | null` via `$type`).
- NO backfill: historical games cannot be reconstructed. `NULL` = "attribute by index against the current quiz" (today's behavior), a documented limitation that decays as new games accrue snapshots.

### Capture (game-room-manager.ts, room hydration ~line 371)

Where the room currently loads and normalizes `quiz.questions`:

1. If `game.questionsSnapshot` is a non-empty array → the room plays from the **snapshot** (parsed through `quizQuestionsSchema`), not the current quiz. Side benefit: a server restart mid-game after a quiz edit no longer swaps questions mid-flight.
2. Otherwise → normalize current `quiz.questions` as today, then persist it once: `storage.updateGame(SYSTEM_CTX, game.id, { questionsSnapshot: normalizedQuestions })`. One write per game at hydration — not a timer-tick write.

### Aggregation (`getQuizInsights`, both implementations, identical semantics)

For each completed game: attribute each response to `snapshot[questionIndex]` (fallback to current `quiz.questions[questionIndex]` when the snapshot is NULL). Aggregate across games keyed by **trimmed question text**.

Row ordering in the response:
1. Current quiz's questions, in quiz order (including zero-response rows) — so the page still mirrors the quiz as it exists today.
2. Then historical texts no longer in the quiz (edited-away or deleted), in first-seen order.

`questionIndex` in the API response becomes the ordinal row number. The response shape is unchanged (`QuizInsights.questions[]` fields identical) → **zero client changes** (the client renders only "Q{n}" + text; verified `quiz-insights.tsx:59`).

Semantics are deliberately honest: editing a question's text starts a new row (the old text keeps its history); a text present in both old and new games merges (exact trimmed match); reordering no longer scrambles stats; deleted questions keep their rows.

## 3. Out of scope (YAGNI)

- Stable per-question ids (survives text edits) — layer later if Reporting needs it.
- Backfilling snapshots for historical games.
- Client UI changes (e.g. "removed question" badges).
- Fuzzy text matching for near-identical edits.

## 4. Testing

- **Storage (MemStorage, both regression directions):** play a game (create responses) → then reorder + edit the quiz's questions → insights still attribute stats to the ORIGINAL texts via the snapshot; a NULL-snapshot game falls back to current-index behavior; merged rows when the same text appears in snapshot and current quiz; removed-question rows appended after current-quiz rows.
- **Room engine (game-room-manager tests, existing harness):** first hydration persists the snapshot exactly once; rehydration with an existing snapshot plays from it even when the quiz row has changed.
- **Migration:** assertion added to the integration suite (column present on `games`).
- No timer-tick writes introduced (the write happens in room creation, verified by reading the call site).

## 5. Rollout

One PR (`feat/insights-question-snapshot`): migration 0010 + schema + engine capture/prefer + both `getQuizInsights` rewrites + tests. Standard gate before commit; migration applied to the live DB at deploy time (or pre-QA, as with 0009).

## 6. Risks

| Risk | Mitigation |
|---|---|
| Snapshot write races with concurrent room creation | Room creation is single-process and per-pin serialized in the manager (existing design); the write is guarded by "only when NULL" |
| Large quizzes bloat games rows | Same order of magnitude as the quizzes row itself; jsonb, one per game — acceptable |
| Text-keyed grouping splits stats on typo fixes | Accepted, documented ("honest semantics"); per-question ids are the future fix if Reporting needs it |
| Legacy NULL-snapshot games keep today's misattribution | Accepted, documented; decays naturally |
