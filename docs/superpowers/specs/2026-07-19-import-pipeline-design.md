# Import Pipeline — Design Spec (2026-07-19)

Excel/CSV/Word → strict validation → Question Bank. Roadmap Wave 4+ item 4.
Approved via brainstorming 2026-07-19.

## Decisions (user-approved)

- **Strategy: hybrid.** xlsx/csv parsed deterministically from a downloadable
  template (no AI, never-corrupt). docx goes through GPT-4o extraction.
- **Destination: Question Bank only.** Imported questions land in
  `bank_questions` (subject/tags included); quizzes pick them up via the
  existing "Add from bank" picker. No import-into-quiz path.
- **Error UX: preview + partial import.** Server returns a preview (valid
  questions + per-row errors). User confirms; only valid items import,
  atomically. Bad rows are fixed in the source file and re-uploaded.
- **Formats v1: .xlsx, .csv, .docx.** pptx deferred (flakiest parser; PDF
  quiz-gen already covers slide-deck-ish content).
- **Architecture: stateless parse-then-bulk (Approach A).** No staged-import
  table, no migration. Preview payload round-trips through the client; the
  existing bulk endpoint re-validates every item, so tampering cannot corrupt.

## Architecture

### Server

New `server/import-routes.ts`, mirroring `bank-routes.ts`: dependency-injected
`{storage, requireAuth, tctx}`, registered from `routes.ts`, route-testable
against MemStorage on an ephemeral express server.

Endpoints:

- `GET /api/import/template.xlsx` and `GET /api/import/template.csv` —
  generated on the fly (no static assets). Header row + 2 example rows; the
  xlsx adds an instructions sheet.
- `POST /api/import/parse` — `requireAuth` + multer memory storage (10MB,
  fileFilter on mimetype **and** extension — browsers report csv mimetypes
  inconsistently). Multipart fields: the file plus optional `defaultSubject` /
  `defaultTags` (the dialog's file-level defaults). The server applies the
  defaults during mapping — rows without their own subject/tags get them —
  so the preview always shows the final values that will be imported. Sniffs
  lane by extension, parses, validates every candidate through
  `insertBankQuestionSchema`, returns:

  ```jsonc
  {
    "source": "template" | "ai",
    "valid":  [{ "question": {…}, "subject"?: "…", "tags": […] }, …], // ready-to-post bulk items
    "errors": [{ "row": 7, "message": "…" }, …],
    "meta":   { "fileName": "…", "totalRows": 16 }
  }
  ```

- **Confirm step = existing `POST /api/bank/questions/bulk`** with its cap
  raised **50 → 200** (still one atomic insert, still per-item re-validated).

Pure parsing core in `server/import-service.ts` — `parseCsv(text)`,
`parseWorkbook(buffer)`, `rowsToBankItems(rows)` — no HTTP, no storage, unit-
testable without files on disk.

Rate limiting: the parse endpoint joins the existing AI limiter bucket in
`rate-limits.ts` (the docx lane is the only token-spending path, but the
bucket covers the endpoint as a whole).

### Dependencies

- **`exceljs`** for xlsx read/write (template generation + parsing). NOT
  SheetJS: the npm-registry `xlsx` package is stale (0.18.x) with known
  advisories and would fail the `npm audit --omit=dev` gate.
- **`mammoth`** for docx → raw text.
- CSV: no dependency — small hand-rolled RFC-4180 parser (quoting, BOM,
  delimiter autodetect), unit-tested.
- Both new deps vetted against `npm audit --omit=dev` before plan execution;
  if either fails the gate, stop and revisit.

## Template contract (deterministic lane)

Columns — header row, case-insensitive, order-free (template ships this order):

| Column | Rule |
|---|---|
| `question` | required, non-empty |
| `type` | `quiz` (default if blank) \| `true_false` \| `poll` |
| `answer1`…`answer6` | 2–6 non-empty; `true_false` with all blank defaults to True / False |
| `correct` | 1-based numbers or letters — `1`, `A`, `1;3`, `A;C` (`;` or `\|` separators). One ⇒ `answerType single`; several ⇒ `multiple`; must be empty for `poll` |
| `timeLimit` | optional; 0 (no limit) or 5–120; default 20 |
| `points` | `standard` (default) \| `double` |
| `difficulty` | optional `easy` \| `medium` \| `hard` |
| `explanation` | optional, ≤500 chars |
| `subject` | optional per-row, ≤100; blank falls back to a file-level default from the import dialog |
| `tags` | `;` or `\|` separated; ≤20 tags, each ≤50; then existing `normalizeTags` |

Parsing rules:

- Everything trimmed; fully blank rows skipped silently.
- Error row numbers match what the user sees in Excel (header = row 1, first
  data row = 2).
- CSV: UTF-8, BOM tolerated, RFC-4180 quoting, delimiter (`,` vs `;`)
  autodetected from the header line (Arabic-locale Excel exports
  semicolon-delimited CSV — which is why in-cell multi-value separators accept
  `|` too). Content may be any language; headers are English only, matching
  the downloaded template.
- **Max 200 data rows per file** (matches the bulk cap). Row 201+ rejects the
  whole file up front with a "split the file" message — never silent
  truncation.
- Two-layer validation: friendly cell-level mapping errors (e.g. "`correct`
  refers to answer 5 but only 4 answers are filled"), then the mapped object
  still passes through `insertBankQuestionSchema` — nothing bypasses the
  canonical rules.

## AI lane (docx)

- `mammoth.extractRawText(buffer)` → plain text. Reject under ~50 readable
  chars ("document appears empty"); truncate above ~50k chars with a note in
  preview meta.
- New `extractQuizFromText()` in `server/openai-service.ts`, sharing the PR
  #30 generator plumbing (gpt-4o pinned, Zod-validated, one error-fed retry)
  with an **extraction prompt**: extract only questions that exist in the
  document; preserve the original language (Arabic stays Arabic); use answer
  keys marked in the doc; infer a correct answer only when unambiguous from
  the text, otherwise skip the question rather than guess. `difficulty` /
  `explanation` filled only from what the document supports.
- New `extractedQuizSchema` in `shared/schema.ts` — same shape as
  `generatedQuizSchema` but `questions: 1..100` (the 12-question cap is a
  generation constraint; ~100 is the realistic single-response output-token
  bound). Extracted `subject`/`tags` prefill the dialog's file-level defaults.
- Same `{valid, errors, meta}` preview shape. AI-lane `errors` are structural
  only ("no questions found", "document too large — split it"); the human
  preview step is the real safeguard — nothing lands in the bank unseen.

## Client UI

**Import button on `/question-bank`** (next to create/search controls) opening
a new `ImportDialog` — three steps, same shadcn dialog idiom as
`BankQuestionDialog`:

1. **Upload** — picker + drag-drop for `.xlsx/.csv/.docx`; "Download template"
   links (xlsx + csv); optional file-level defaults: subject (text) + tags
   (reused `TagInput`) applied to rows without their own. Note that Word files
   are AI-extracted.
2. **Preview** — summary line ("14 valid · 2 errors"), scrollable error list
   (row + message) with a "fix in the source file and re-upload" hint, valid
   questions as compact expandable cards (question text, type + difficulty
   badges, answers with correct marked — same visual language as bank cards).
   No inline editing.
3. **Confirm** — "Import N questions" posts to `/api/bank/questions/bulk`;
   success toast; TanStack invalidation of bank list + subjects/tags queries;
   dialog closes. Zero valid ⇒ confirm never enables.

Loading: parse (docx ≈ 10–20s via GPT-4o) uses the AI-generate dialog's
spinner-with-message treatment. Full EN+AR strings incl. Arabic CLDR plurals
for count lines; RTL-correct like the rest of the bank page.

## Error handling, security, limits

- Upload rejects (wrong type, >10MB, >200 rows, unreadable) are 400s with
  specific messages. Parser crashes on malformed files are caught per-file,
  Sentry-captured (`scope: http.import-parse`), and returned as a generic
  "couldn't read this file" 400 — never a 500 for a bad file.
- exceljs hardening: parse inside try/catch behind the 10MB cap; read cell
  values as text only (no formula evaluation, no style traversal).
- Auth/tenancy: everything behind `requireAuth`; inserts via the existing
  `tctx(req)` + RLS path in the bulk endpoint. Writes to `bank_questions`
  only — **no new tables, no migration**. Only schema-adjacent change: bulk
  cap 50→200 (+ its route test).
- No answer-key leak surface: import never touches game/player routes; bank
  routes are already authenticated host-side.

## Testing

- **Unit (in `npm test` gate):** `import-service` — CSV parser (quoting, BOM,
  delimiter autodetect, blank rows), row→bank-item mapping (every column
  rule, letter/number `correct`, separators, true/false defaulting, row-number
  accounting), limits; `extractedQuizSchema`; xlsx parse from a small
  in-memory workbook built with exceljs itself.
- **Route-level (MemStorage ephemeral express, like `bank-routes.test.ts`):**
  parse happy path + each reject; bulk at the new 200 cap; end-to-end
  template-lane flow (upload fixture → preview → bulk → rows in storage). AI
  lane mocked at the `extractQuizFromText` seam.
- **Browser QA before merge:** real xlsx from the downloaded template (EN +
  Arabic content); a csv with deliberate bad rows (verify row numbers match
  Excel); a real docx through live GPT-4o — user at the wheel.

## Out of scope (deferred)

- pptx import.
- Inline fixing of invalid rows in the preview (editable grid).
- Import directly into a quiz from the editor.
- Re-sync of imported questions with later bank edits (provenance field
  `sourceQuestionId` already exists for a future wave).
