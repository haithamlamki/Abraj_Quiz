# Reporting (Compliance Exports) — Design Spec (2026-07-19)

Trainer-compliance reporting: server-side Excel/CSV exports of who played and how they
scored, at game level and quiz level. Roadmap Phase 8, next subsystem after the Import
pipeline. Approved via brainstorming 2026-07-19.

## Decisions (user-approved)

- **Audience/job: trainer compliance.** The host needs shareable evidence of who played
  and how they scored (corporate safety-training attendance + scores). Quiz-quality
  analytics (trends, comparisons) are OUT of scope for this iteration.
- **Formats: Excel (.xlsx) + CSV.** Server-side generation; exceljs reused from the
  Import wave (zero new dependencies). PDF deferred.
- **Identity: join nickname as-is.** Reports carry the self-reported player name; the
  Summary sheet includes a note that identity is self-reported. No join-flow changes.
- **Granularity: game level + quiz level.** Single-session roster report AND
  cross-session quiz report.
- **Architecture: Approach A** — pure `server/reports.ts` assembly + thin DI routes,
  reusing existing storage reads and the frozen question snapshots.

## Architecture

### Data assembly — `server/reports.ts` (pure)

Mirrors `insights.ts`: no HTTP, no storage calls — receives already-fetched rows,
returns report structures. Unit-testable without files or DB.

- `buildGameReport({ game, quiz, players, responses })` →
  `{ summary, playerRows, questionMatrix }`
  - **summary**: quiz title, game PIN, date, player count, question count, average
    score, average correct-rate.
  - **playerRows**: per player — name, final score, correct count / total, accuracy %,
    rank (score-ordered; ties share a rank).
  - **questionMatrix**: per question × per player: correct / incorrect / no-answer.
    Poll questions appear but are marked as polls — the cell shows the chosen option,
    never correct/incorrect.
  - Question set comes from the game's **frozen `questionsSnapshot`**, falling back to
    the current quiz questions for pre-0010 games (same rule as `insights.ts`).
- `buildQuizReport({ quiz, games, playersByGame, responsesByGame })` →
  `{ summary, sessionRows, playerRows }` (responses are needed for per-player correct
  counts/accuracy — `game_players` rows carry only the score)
  - **summary**: quiz title, total sessions, total unique player-names, overall average
    score, date range.
  - **sessionRows**: per completed game — date, PIN, player count, average score.
  - **playerRows**: flat, pivot-friendly — one row per (game, player): date, session
    PIN, player name, score, correct count, accuracy.
- Quiz-level reports include **completed games only**. A game-level report on an
  unfinished game is rejected at the route layer (409) — an incomplete session is
  misleading as compliance evidence.
- **No answer keys anywhere**: `correctAnswers` / `explanation` never appear in any
  cell. Reports carry outcomes (correct/incorrect) and, in the answer matrix, what the
  player chose — the completed-game reveal boundary already exposes that.

### File building — also `server/reports.ts`

- **xlsx (exceljs)**:
  - Game report, 3 sheets: *Summary* (label/value pairs), *Players* (bold frozen
    header, one row per player), *Answers* (question rows × player columns, ✓/✗/—
    cells; poll rows show the chosen option text).
  - Quiz report, 3 sheets: *Summary*, *Sessions*, *Player Results* (flat rows).
  - Column widths set; header rows bold + frozen.
- **csv**: flat rows only (Players for game reports, Player Results for quiz reports).
  BOM-prefixed, CRLF, quoting per the same escape rules as the Import template CSV.
- **Header language**: `?lang=ar` selects Arabic headers from a ~20-entry
  `REPORT_STRINGS.en/.ar` dictionary in the module (default `en`). Data cells stay in
  whatever language they already are. A test asserts EN/AR key parity.
- **Filenames**: `{quiz-title-slug}-game-{pin}-report.xlsx` /
  `{quiz-title-slug}-report.xlsx`. ASCII-safe slug; when the title slugs to empty
  (Arabic titles will), fall back to `quiz-{id}`.

### Routes — `server/report-routes.ts` (DI, like bank/import routes)

`registerReportRoutes(app, { storage, requireAuth, tctx })`, registered next to
`registerImportRoutes` in `routes.ts`.

- `GET /api/games/:pin/report.xlsx` and `.csv` — `requireAuth`; 404 unknown pin;
  **403 unless `game.hostId === authUserId`** (hard host-only rule); 409 if the game
  is not completed.
- `GET /api/quizzes/:id/report.xlsx` and `.csv` — `requireAuth`; quiz ownership check
  identical to the insights route (same 403 message).
- Content-Disposition attachment + correct mimetypes, same as the template endpoints.
- No rate limiter (cheap authenticated reads — same posture as insights).

## Client

One surface, download buttons only — no new pages. (Amended during planning: the
`quiz-history` page lists QUIZZES, not game sessions — per-game rows only exist in the
insights page's Recent Games table, so both report levels live on `quiz-insights`.)

- **`quiz-insights` header**: a "Download report" button group (Excel / CSV) — the
  quiz-level report.
- **`quiz-insights` Recent Games table**: a new trailing column with compact Excel/CSV
  actions per row — the game-level report. (The insights aggregation already includes
  completed games only, so no in-progress guard is needed client-side; the 409 remains
  the server-side backstop.)
- Downloads via fetch → blob → objectURL with an error toast — the third use of this
  pattern, so it is extracted to a shared `client/src/lib/download.ts` and
  `ImportDialog.downloadTemplate` is refactored to use it.
- `lang` query param filled from `i18n.language` (Arabic UI → Arabic headers).
- New `reports.*` i18n keys (button labels, toasts), full EN+AR; no plurals needed.

## Errors, security

- Host/owner-gated on every endpoint (player names + scores are PII-adjacent; only the
  game's host or the quiz's owner can pull them). Tenant isolation via the existing
  `tctx(req)` + RLS path. Storage calls always take a StorageCtx.
- 404 unknown pin/quiz · 403 non-owner · 409 incomplete game (clear message) · 500
  only for genuine failures, Sentry-captured (`http.game-report` / `http.quiz-report`).
- No new tables, **no migration**, no new dependencies.

## Testing

- **Unit (`npm test` gate), `reports.ts` without files:** rank ties; no-answer vs
  wrong-answer cells; poll handling; snapshot-vs-current-quiz question sourcing;
  empty game (zero players); unique-player counting; EN/AR header dictionary parity.
- **Route tests (MemStorage ephemeral express):** auth / ownership / 409 matrix; full
  xlsx roundtrip (generate → `exceljs` parse → assert sheet names + spot cells); CSV
  BOM + quoting.
- **Browser QA before merge:** real exports from played-game data in both UI
  languages, files opened in Excel; verify Arabic headers and Arabic player names
  render correctly.

## Out of scope (deferred)

- Quiz-quality analytics: trends over time, game/cohort comparison, improvement views.
- PDF export (new dependency + RTL font embedding).
- Player identity hardening (staff-ID field at join) — candidate for the Enterprise
  wave alongside RBAC.
- Scheduled/emailed reports, async job pipeline.
