# Session Summary — 2026-07-19 (Import Pipeline)

Handoff doc for continuing in a new session. One subsystem taken end-to-end in a single
session: brainstorm → spec → plan → subagent execution (per-task + whole-branch reviews)
→ live browser QA → merge → prod verification → QA-data cleanup.

**`main` tip:** `a7bbc47` (PR #32 merge). Merged-main gate green: `npm run check` clean,
`npm test` **164/164**, `npm run build` OK. **No migration** — no new tables; the only
schema-file change is additive (`extractedQuizSchema`, `MAX_BANK_BULK_ITEMS`).
**Prod verified live** on both halves (see §4).

---

## 1. What shipped — Import pipeline (PR #32)

Excel/CSV/Word → strict validation → preview → atomic import into the Question Bank.

- **Architecture: stateless parse-then-bulk.** `POST /api/import/parse` (multipart,
  multer memory 10MB, behind the AI rate limiter) parses the file, validates every
  candidate through `insertBankQuestionSchema`, and returns `{source, valid, errors,
  meta}`. Confirm posts the valid items to the pre-existing
  `POST /api/bank/questions/bulk` (cap raised **50 → 200** = `MAX_BANK_BULK_ITEMS`,
  still one atomic insert, server re-validates — tampered previews can't corrupt).
  No import state on the server.
- **Template lane (deterministic, zero AI):** downloadable xlsx/csv templates generated
  on the fly (`GET /api/import/template.{xlsx,csv}`); hand-rolled RFC-4180 CSV parser
  (BOM, `,`/`;` delimiter autodetect for Arabic-locale Excel); exceljs text-only xlsx
  reads; per-row errors numbered exactly as Excel displays them (header = 1); gapped
  answer columns rejected; >200 rows rejected with a "split the file" message.
- **AI lane (docx only):** mammoth → raw text → `extractQuizFromText` in
  openai-service (gpt-4o pinned, extract-don't-invent prompt, one error-fed retry,
  validated by `extractedQuizSchema` 1..100). Refactor: generation + extraction share
  one `completeValidated` loop — generation behavior verified bit-identical. Lane is
  feature-gated (`aiGeneration`) and the only token spender.
- **Client:** three-step `ImportDialog` on `/question-bank` (upload + file-level
  subject/tag defaults → preview with per-row errors and expandable cards showing
  marked correct answers → confirm). Keyboard-accessible dropzone, stale-flight
  guards on both async flows, robust template downloads. Full EN+AR incl. Arabic
  CLDR plurals; RTL verified.
- **Deps:** `exceljs` (NOT SheetJS — the npm `xlsx` package is stale with advisories)
  + `mammoth`. exceljs's vulnerable `uuid <11.1.1` transitive is pinned to `^11.1.1`
  via a package.json `overrides` block. Audit gate reality-check: main already carries
  **10 pre-existing advisories**, so the spec's "0 vulnerabilities" was unsatisfiable —
  gate amended to "no NEW vs baseline" (holds), baseline logged as BACKLOG audit debt.

Spec: `docs/superpowers/specs/2026-07-19-import-pipeline-design.md`.
Plan: `docs/superpowers/plans/2026-07-19-import-pipeline.md` (10 tasks, complete code per task).

## 2. Review process — 8 real bugs caught, 6 of them plan-authored

Per-task reviews (sonnet) + final whole-branch review (fable). Every one of these was in
the plan's own code, written by the same model that reviewed for them — independent
review context is what caught them:

1. **Gapped answer columns silently compacted** — `correct="3"` could mark the wrong
   answer. Now rejected with a friendly error (task review).
2. **Extraction retry-exhaustion surfaced the "generate" wording** — exhaustMessage now
   threaded per-lane through `completeValidated` + mapOpenAiError passthrough (task review).
3. **ImportDialog robustness triple** — silent template-download failures, keyboard-
   inaccessible dropzone, stale-in-flight races (incl. a runImport success-path guard
   the controller's first fix dispatch wrongly waived — the reviewer caught the asymmetry).
4. **Sparse-xlsx row-bomb DoS** (final review) — a few-KB file claiming ~1M rows would
   materialize them all before the cap check, on the single-process game server. Fixed
   with `MAX_SHEET_ROWS = 2000` bail + regression test.
5. **Same-file re-upload fired no change event** (final review) — broke the spec's core
   fix-and-reupload loop. File input value now cleared on every selection.

Also caught: two haiku implementer REPORTS with fabricated numbers (invented dep
versions, wrong line/test counts) while the code itself was correct — cheap-model
report prose needs verification against diffs.

## 3. Browser QA (live, localhost against the shared Supabase DB)

- **xlsx:** 5 rows (3 EN + 2 AR, incl. multi-select `correct="1;3"`) → "5 valid ·
  0 errors", ✓Dolphin/✓Bat marked, Arabic subjects عُلوم/جغرافيا intact after import.
- **csv:** 4 deliberate bad rows → "2 valid · 4 errors" with **exact Excel rows
  3/5/6/7** (out-of-range, bad type, poll-with-correct, gapped answers); defaults
  precedence verified both directions (bare row got QA-CSV defaults; row-level
  History/tags1 won).
- **docx (live GPT-4o):** 3-question doc with `Answer:` markers → extracted exactly
  those 3, nothing invented, TF key honored (False), extracted subject/tags applied.
- **AR/RTL dialog** verified; zero console errors.

## 4. Merge + prod verification

- PR #32 merged (`a7bbc47`), branch deleted, 21 stale remote-tracking refs pruned.
- **Render backend:** `GET /api/import/template.csv` with a tenant Origin → 401
  (route live). GOTCHA: bare probes without a recognized Origin/Host 404 — tenant
  resolution needs the header; don't panic at a 404 from curl.
- **Vercel frontend:** `www.abrajquiz.com` serves the استيراد button + dialog with
  live bank-meta suggestions.
- **QA cleanup:** the 10 QA questions (ids 10–19) archived via the API (auth =
  `Bearer localStorage["auth-token"]`, NOT cookies — relative fetches on the Vercel
  origin return SPA HTML; use `https://api.abrajquiz.com`). Restorable via the
  Archived toggle. Last session's 8 fire-safety AI questions were left untouched.
- Windows gotcha: killing a background `npm run dev` kills the npm wrapper but the
  tsx/node child survives on :5000 — kill via `Get-NetTCPConnection -LocalPort 5000`
  + `Stop-Process`.

## 5. Open BACKLOG items added this session (in `BACKLOG.md`)

1. Server-side import error messages are English-only (PDO is Arabic-default and row
   errors are the primary feedback) → move to error codes + client translation.
2. Audit debt: main's 10 pre-existing prod advisories (undici, ws, shell-quote, …) —
   schedule a dedicated dep-bump pass.
3. ImportDialog a11y polish bundle; friendly pre-checks for <2-answers/tag-cap rows;
   small cleanups (error `.name`s, parse-helper dedup, unused `MAX_IMPORT_ROWS` alias).

Pre-existing backlog still open: explanation-in-completed-results product decision,
mapOpenAiError raw-echo, integration-suite CI wiring, native ar.json review.

## 6. Recommended next subsystem

Per the roadmap: **RBAC/Enterprise wave** (per-user bank ownership gating was
explicitly deferred to it), or the quick infrastructure wins (integration-suite CI
job; audit dep-bump pass). Start with `superpowers:brainstorming` as usual.

## 7. Working method notes (delta from last session's summary)

Same pipeline as before (brainstorm → spec → plan → subagent-driven with per-task
reviews → fable whole-branch review → browser QA → merge). New learnings:
- **Literal-BOM transcription is a recurring model-output hazard** — any typed
  backslash-uFEFF can silently become the invisible char, in plans, in implementer
  output, even in controller Edit calls. Fix via a script that builds the escape
  programmatically (`String.fromCharCode(92) + "uFEFF"`); verify with charCodeAt scans.
- Cheap-model implementers are fine for transcription tasks but their REPORTS
  fabricate numbers — reviewers must verify counts from the diff, never the report.
- Final review on the most capable model keeps paying: both merge-blockers (DoS,
  re-upload) were invisible to every task-scoped review.
