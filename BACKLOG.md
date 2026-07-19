# Backlog — Post Phase 1

Tracked follow-ups after `PRODUCTION_MIGRATION_PRD.md` Phase 1 was closed (commits `6e41920`, `617db04`). Last refreshed 2026-04-27.

## Phase 1 — Production Migration COMPLETE ✅ (2026-04-27)

- Migrated from Replit dev to Render + Vercel + Supabase production
- All 9 FRs from `PRODUCTION_MIGRATION_PRD.md` verified
- 29/29 API smoke tests pass (`tests/smoke/api-contract.md`)
- 10/10 unit tests, 12/12 integration tests pass
- End-to-end signup + login verified in production
- Custom domain `abrajquiz.com` operational with first-party cookies
- Production stack:
  - Frontend: Vercel (`https://abrajquiz.com`)
  - Backend: Render Starter $7/mo, Frankfurt EU Central (`https://api.abrajquiz.com`)
  - Database: Supabase eu-north-1 (Session Pooler)
  - DNS: Hostinger

## Recently shipped (post-Phase 1)

- [x] Phase 2 WebSocket integration test suite (`tests/integration/`) — 12 cases (`885e99a`)
- [x] **`correctAnswer` leak** on `GET /api/quizzes/:id` and `GET /api/quizzes` — closed; creator-aware via `sanitizeQuizForCaller` (`ca92d4d`); smoke contract updated (`f04f6ea`)
- [x] **WebSocket session-hydration race** — closed; `'message'` listener now attached synchronously, messages buffered until hydrate completes, `SESSION_HYDRATION_FAILED` close code added (`681eba8`)
- [x] Lock-file `optional` flag drift on nested platform binaries — patched 26 entries under `vitest/node_modules/@esbuild/*` (`2fd4881`)
- [x] OpenAI client lazy-init — boot no longer crashes when `OPENAI_API_KEY` is unset (`c7cdb35`)
- [x] Round 1 cleanup:
  - Removed `cookies.txt` + Replit cruft (`replit.md`, `metadata.json`, `files/`); hardened `.gitignore` (`d2ade5f`)
  - `/api/healthz` (DB-free liveness) + `/api/readyz` (DB-ping readiness with 2s timeout) (`7396147`)
  - GitHub Actions CI: typecheck + unit + integration + build, on push/PR to main, with concurrency cancel + npm cache (`8429820` → green by `c7cdb35`)

## Arabic follow-ups

- [ ] **Arabic PDF reports**: jsPDF renders Arabic as disconnected LTR glyphs; needs an embedded Arabic font + RTL shaping (or a different generation approach). Blocks localized PDF exports. (Phase B deliberately kept PDFs English.)
- [ ] `admin-tenants.tsx` remains English (super-admin-only internal tooling — deliberate Phase B exclusion).

## Reliability follow-ups (from feat/reliability-quick-wins final review)

- [ ] Error boundary doesn't cover `Navigation` (renders above it in App.tsx) — a crash there still blank-screens; move the boundary up or add a thin one around Navigation.
- [ ] play-game shows "Game not found" while the quiz query is still retrying (transient flash a player might act on) — gate the not-found card on the quiz query's fetch status.
- [ ] `retryTransient` retries definitive 400s; consider failing fast on all 4xx except 408/429. Dedupe the copy-pasted retryDelay into queryClient.ts.
- [ ] PIN-exhaustion 500 (routes.ts "Failed to generate unique game PIN") is not a catch and thus not Sentry-captured — one-line captureError candidate.

## Insights follow-up

- [ ] **Question-identity in insights**: `game_responses` are keyed by `questionIndex` only, so editing a quiz (removing/reordering questions) makes historical per-question stats attach to the wrong question text, and out-of-range indexes drop silently. Real fix needs per-game question snapshots (migration). Flagged by the feat/quiz-insights final review.

## Code consolidation

- [ ] Consolidate origin parsing util — currently duplicated at `server/index.ts:11-18` and `server/routes.ts:34-52`. Both fail-closed correctly; this is cleanup, not a bug.
- [ ] Generalize host-only / ownership middleware — open-coded as `if (resource.createdBy/hostId !== session.userId) return 403` in 4+ routes (`PUT /api/quizzes/:id`, `POST /api/games/:pin/start`, `POST /api/games/:pin/next-question`, `GET /api/games/:pin/question-results/:idx`). One `requireGameHost(pinParam)` middleware would shrink ~40 lines and reduce drift risk.
- [ ] Resolve `client/src/pages/create-quiz.tsx` (1144 LOC) vs `create-quiz-simple.tsx` (481 LOC). Only `create-quiz.tsx` is routed in `App.tsx:42`; `create-quiz-simple.tsx` is dead code or an incomplete refactor. Decide and delete one.
- [ ] Replace `(req as any).session.userId` casts (~17 occurrences in `server/routes.ts`) with a typed session augmentation via `declare module "express-session"`.

## Hardening warnings from FR-8 review (deferred)

- [ ] Treat `CLIENT_ORIGIN="*"` as explicit wildcard rather than literal string match (`server/websocket.ts:240`).
- [ ] Decide whether headerless WS upgrades should be allowed for internal tooling/health probes; document the decision either way.
- [ ] Normalize origins at parse time: lowercase + strip trailing slash.
- [ ] Whitelist Vercel preview deployments in `CLIENT_ORIGIN` (currently only production URLs).
- [ ] Add length limits on quiz `title` / `description` / `answers` at the API boundary — DB columns are unbounded `TEXT`, no Zod `.max()` clamp today. A pathological payload could blow up later renders.

## Accessibility — contrast (Wave 3)

- [ ] **Per-tenant brand contrast**: `--primary`/`--ring` follow each tenant's `branding.colors.primary` (set at runtime by tenant.tsx). White is the primary-foreground, so a tenant's brand must be ≥3:1 vs white (UI/large text) — ideally ≥4.5:1. Wave 3 fixed the static default; audit the Abraj + PDO tenant brand colors in the DB and, if any fail, update tenant config (or add a runtime luminance-based foreground). Full AA-normal (4.5:1) for brand-on-white is a follow-up.

## Dependency security (surfaced by Wave 0 final review, 2026-07-18)

- [ ] **Production-dependency advisories**: `npm audit --omit=dev` reports 10 vulnerabilities (1 critical, 5 high) in the production tree, including `ws` (GHSA-96hv-2xvq-fx4p). These pre-date Wave 0 (which added only devDependencies and bumped no prod dep). Triage + upgrade the affected prod deps in a dedicated security PR (fits Wave 9 / security pass). Until then, do NOT describe `npm audit --omit=dev` as "clean" in any PR.

## UX resilience

- [ ] React error boundary at the root of `client/src/App.tsx`. Currently wraps lazy routes in `Suspense` only — a render-time exception in any page produces a blank screen, no toast, no fallback.
- [x] Client-side WebSocket reconnect for `play-game.tsx` and `host-game.tsx` — full-jitter backoff, wake-up reconnect on visibility/online, status banner (`ws-reconnect.ts`, `use-game-websocket.ts`, `connection-banner.tsx`).

## Test coverage gaps

- [ ] Smoke test for late-answer rejection (FR-5 acceptance).
- [ ] Smoke test for production origin rejection (FR-8 acceptance).
- [ ] Unit tests for `server/storage.ts`, `server/openai-service.ts`, route-handler logic in `server/routes.ts` (currently zero).
- [ ] Integration coverage gaps: login (only register tested), logout, `GET /api/games/:pin/results`, `GET /api/games/:pin/question-results/:idx`, the four `/api/generate-quiz/*` routes, `PUT /api/quizzes/:id`.
- [ ] No client-side tests at all (no Playwright / RTL). Lowest priority — the integration suite covers the WebSocket flow that matters most.

## Repo hygiene

- [ ] **`attached_assets/` cleanup** — 84 files / 38 MB in repo. Only 5 brand background JPGs are used (referenced from `client/src/utils/backgrounds.ts:11-15` and `vite.config.ts:23` `@assets` alias). Move the 5 used files to `client/public/backgrounds/`, update the references, delete the rest. Saves ~38 MB of clone bloat.
- [ ] Add `.env.example` so onboarding has a fast path and `DEPLOYMENT.md`'s env-var contract is checkable.
- [ ] Branch protection on `main` requiring CI checks (Type check, Unit tests, Integration tests, Build) before merging. Done via GitHub Settings → Branches → add ruleset; UI-only, can't be done from a PR.

## Phase 2+ from PRD §17 (deferred / scale)

- [ ] **Phase 2** — Local production-like smoke script (mentioned PRD §17 line 455).
- [ ] **Phase 2** — Cleanup of obsolete WebSocket legacy broadcast code (PRD §17 line 456).
- [ ] **Phase 2** — Structured logging for room events; replace `console.log` / `console.error` (PRD §17 line 457).
- [ ] **Phase 3** — DB indexes + foreign keys (PRD §17 lines 461-462).
- [ ] **Phase 3** — Possible split of player records into a dedicated `game_players` table (PRD §17 line 463).
- [ ] **Phase 3** — Migration review for Supabase performance (PRD §17 line 464).
- [ ] **Phase 4** — Redis / managed pub/sub for shared room state (PRD §17 lines 467-468).
- [ ] **Phase 4** — Multi-instance backend support behind sticky routing (PRD §17 line 469).
- [ ] **Phase 4** — Durable reconnect state (PRD §17 line 470).
- [ ] **Phase 4** — Operational metrics + alerts (PRD §17 line 471).

## Gameplay energy-pack follow-ups (from final review)

- [ ] Position delta ("moved up N places") is wiped if a WS reconnect re-delivers question_closed mid-reveal (play-game.tsx effect re-runs, sets delta null). Guard with a lastDeltaQuestionRef so a given question's delta computes once. Cosmetic/transient.
- [ ] Host PDF (quiz-pdf-generator.ts) shows a blank correct-answer label for poll questions; render "Poll" or omit the label instead.
- ACCEPTED LIMITATIONS (by design, not bugs): (1) server restart wipes in-memory streaks mid-game — streaks restart at 1 (single-process room design); (2) poll questions read 0% correct-rate in insights since isCorrect persists false.
- Deploy note: ship client+server together for the poll feature — a stale cached AnswerGrid bundle (pre-isPoll-guard) receiving correctAnswers [] would dim every poll option with an ✗ (no correct-answer leak, just cosmetic-wrong) until refresh.

## Known divergences from `tests/smoke/api-contract.md` (intentional, not bugs)

- ~~`DELETE /api/quizzes/:id` is not implemented.~~ Implemented as soft delete (archive) with restore — mirrors `PUT`'s ownership check; archived quizzes stay resolvable by id for game history (migration 0008).
- `POST /api/games/:pin/answer` is intentionally public — players don't have user accounts; identity is `playerName` matching a runtime-room registration. There is no path that returns 401 from this endpoint.

## Integration-suite staleness (found 2026-07-18 while verifying migration 0009)

- [x] ~~FIXED 2026-07-18~~ (branch fix/integration-legacy-shape): expectations updated to the canonical shape — owner/completed views assert `correctAnswers[]`, sanitized views assert BOTH fields absent, answer ACK asserts exact `{success, streak}`; full suite 26 passed / 1 skipped. REMAINING follow-up below. Original: 4 of 7 `tests/integration/` files fail against a live DB (5 test failures) because they still assert the LEGACY question shape (`correctAnswer: number` in API responses, e.g. results-and-validation.test.ts:70,170). They were last updated 2026-07-15 (4cb0b05), one day before the Kahoot revamp migrated the model to `correctAnswers[]` with normalize-on-write; the suite needs a real DATABASE_URL so it never runs in the standard `npm test` gate and the drift went unnoticed. NOT a product bug: the mid-game answer-secrecy invariant strips BOTH legacy and canonical fields (unit-tested), and `bank-questions-migration.test.ts` + `migration.test.ts` pass. Fix = update the stale expectations to the canonical shape (mid-game: neither field present; completed: `correctAnswers` array) — DONE.
- [ ] Wire `npm run integration` into a scheduled or pre-deploy check (CI job with a DB secret, or a release checklist step) so integration expectations can't rot silently again.

## AI content upgrade follow-ups (from PR #30/#31 reviews, 2026-07-19)

- [ ] Product decision: AI-generated `explanation` is exposed in the COMPLETED-game `/api/games/:pin/results` payload (the intended answer-reveal boundary, same as correctAnswers). Decide whether explanations should instead wait for a dedicated post-question reveal feature (spec §2 BACKLOG) — if so, strip explanation from the completed-results quiz too.
- [ ] `mapOpenAiError` (server/openai-service.ts) fallback echoes raw `error.message` into the HTTP response (pre-existing behavior, preserved in the rewrite) — map unknown/unexpected errors to a generic string to avoid surfacing SDK/axios internals.
- [ ] Minor cleanup (non-blocking): `applyGenerated` (quiz-editor.tsx) calls `normalizeGeneratedQuestions` twice — compute once, reuse. And the `generatedQuizSchema`/`insertBankQuestionSchema` subject trim-transform idiom could be a shared helper.
- Behavior note (not a bug): strict `generatedQuizSchema` now rejects >12 questions / empty title (with one AI retry) instead of the old silent slice-to-12 / title-fallback.

## Import pipeline follow-ups (from PR #32 final review, 2026-07-19)

- [ ] Server-side import error messages (per-row parse errors, "split the file", limiter messages) are English-only while PDO is Arabic-default and row errors are the feature's primary feedback. Move to error CODES + client-side translation (mirror the RATE_LIMITED pattern) in a follow-up.
- [ ] Audit debt (pre-existing on main, surfaced while gating this branch): `npm audit --omit=dev` carries 10 advisories (undici, ws, shell-quote, axios, dompurify, esbuild, form-data, multer, qs — 1 low/3 mod/5 high/1 critical). Most are fixable via `npm audit fix`; schedule a dedicated dep-bump pass with full gate + smoke.
- [ ] ImportDialog a11y polish bundle: add DialogDescription (kills the Radix aria-describedby console warning), give TagInput an `id` prop so the tags Label can htmlFor it, explicit `type="button"` on Buttons.
- [ ] Friendly pre-checks for common row errors that currently fall through to raw Zod messages (<2 answers; >20/overlong tags).
- [ ] `UnreadableFileError`/`FileTooLargeError` don't set `this.name` (log labels read "Error"); fold `parseGeneratedQuiz`/`parseExtractedQuiz` into one `parseWith(schema)` helper; extraction fallback interpolates `error.message` (fold into the existing mapOpenAiError raw-echo item above); delete the unused `MAX_IMPORT_ROWS` alias.
- Behavior notes (by design, not bugs): docx lane is the only OpenAI spender and sits behind the AI limiter + aiGeneration feature gate; mimetype filter intentionally admits octet-stream (extension + magic-byte parse failure are the real gates); exceljs inflates the zip in memory (bounded by 10MB upload cap + MAX_SHEET_ROWS=2000 + auth + AI limiter).
