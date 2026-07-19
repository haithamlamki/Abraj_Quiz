# Quiz Versioning + Draft Autosave — Design Spec

Date: 2026-07-19
Status: approved for planning
Scope: first slice of the Enterprise wave (per the 2026-07-18 product-polish audit,
Wave 4+ item 7: versioning + autosave → audit log → RBAC → approval → folders).

## 1. Goal

Give trainers a safety net in the quiz editor:

1. **Draft autosave** — in-progress edits are continuously saved to a draft that is
   fully separate from the live quiz. Closing the tab loses nothing; half-finished
   edits can never be hosted.
2. **Version history** — every explicit Save banks the quiz's previous state as an
   immutable version. Trainers can list, preview, and restore past versions.

Non-goals (explicitly out of scope for this slice): diff views between versions,
named/tagged versions, RBAC/multi-editor semantics, audit log, changing the
editor's navigate-away-on-save behavior.

## 2. Decisions (settled during brainstorming)

| Decision | Choice |
|---|---|
| Autosave target | Server-side draft, separate from live quiz (live quiz changes only on explicit Save) |
| Version trigger | Every explicit Save snapshots the quiz's **previous** state; autosaves never create versions |
| History UX | List + read-only preview + restore (no diff view) |
| Retention | Last 20 versions per quiz, pruned on write; no cron |
| Draft found on open | Prompt: Resume editing / Discard draft |
| Never-saved quizzes | localStorage draft (per tenant+user key); server drafts only for existing quizzes |
| Storage shape | Two dedicated tables (`quiz_versions`, `quiz_drafts`); **no** new columns on `quizzes` (avoids the client-visible-row spread-leak hazard learned in the insights-snapshot review) |
| Restore mechanism | Client-side: load version payload into editor, restoring is a normal Save (new version; history never rewritten). No restore endpoint. |

## 3. Data model — migration 0011

Both tables follow the hard rules: `tenant_id` + the tenant_isolation RLS policy
pair, all storage access via `StorageCtx`.

### 3.1 `quiz_versions` (immutable, append-only)

| column | type | notes |
|---|---|---|
| id | serial PK | |
| tenant_id | integer NOT NULL FK→tenants | |
| quiz_id | integer NOT NULL FK→quizzes | |
| version_number | integer NOT NULL | per-quiz, monotonically increasing (max+1) |
| title | text NOT NULL | |
| description | text | |
| questions | jsonb NOT NULL | canonical Question[] shape |
| theme | jsonb | |
| background | text | |
| is_public | boolean | included so restore is full-fidelity |
| created_by | integer NOT NULL | the saver (today always the owner) |
| created_at | timestamptz default now() | |

Constraints/indexes: UNIQUE `(quiz_id, version_number)`; index on `quiz_id`.

### 3.2 `quiz_drafts` (mutable, one slot per quiz)

| column | type | notes |
|---|---|---|
| id | serial PK | |
| tenant_id | integer NOT NULL FK→tenants | |
| quiz_id | integer NOT NULL UNIQUE FK→quizzes | one draft per quiz |
| payload | jsonb NOT NULL | full editor state: title, description, questions, theme, background, isPublic |
| updated_at | timestamptz NOT NULL | |

**Invariant:** the draft row is deleted in the same transaction as a successful
Save, so **draft existence ≡ unsaved changes**. The client shows the resume
prompt purely on existence — no timestamp comparison (the `quizzes` table has no
`updated_at`).

## 4. Server behavior

### 4.1 Save path (existing `PUT /api/quizzes/:id`)

Becomes transactional via a new storage method implemented on `IStorage` and
both backends (DB + MemStorage), e.g. `updateQuizWithVersion(ctx, id, data)`:

1. Insert a `quiz_versions` row capturing the quiz's **previous** state
   (`version_number` = current max for that quiz + 1).
2. Update the `quizzes` row (unchanged field mapping from today).
3. Delete the `quiz_drafts` row for the quiz (if any).
4. Prune: delete oldest versions beyond the newest 20.

`POST /api/quizzes` (create) writes no version; the first version appears on the
first subsequent Save, preserving the pre-edit state. Pre-feature quizzes get
their first version on their first post-deploy save — even the first edit
session has a safety net.

### 4.2 New routes — `server/version-routes.ts` (DI pattern, mirrors `report-routes.ts`)

All `requireAuth` + owner-gated (`quiz.createdBy === authUserId`, insights' exact
403 message), 400 on bad id, 404 on missing quiz, Sentry scopes
`http.quiz-versions` / `http.quiz-draft`.

| route | behavior |
|---|---|
| `GET /api/quizzes/:id/versions` | metadata list, newest first: `{versionNumber, title, questionCount, createdAt}[]` — no question payloads |
| `GET /api/quizzes/:id/versions/:n` | full version payload (title, description, questions, theme, background, isPublic); 404 if version absent |
| `GET /api/quizzes/:id/draft` | draft payload + updatedAt, or 404 if none |
| `PUT /api/quizzes/:id/draft` | upsert draft (validated by `quizDraftSchema`), returns `{updatedAt}` |
| `DELETE /api/quizzes/:id/draft` | discard; 204 (idempotent — 204 even if absent) |

There is **no** restore endpoint.

Answer-key exposure: every new route is owner-only; version/draft payloads never
reach players, so no sanitization layer (`sanitizeQuizForCaller`) applies. Any
future non-owner surface for these payloads MUST revisit this.

### 4.3 Draft validation — `quizDraftSchema`

Drafts must accept invalid-in-progress content that `insertQuizSchema` /
`quizQuestionsSchema` would reject (empty title, question with no correct
answer, empty answer text). New Zod schema (shared/schema.ts) that is lenient in
shape but strict in bounds:

- title ≤ 200 chars (may be empty); description ≤ 2000 chars
- questions: array ≤ 100 items; per-question loose shape (strings length-capped
  at 5000 chars, answers array ≤ 10, unknown extra keys stripped)
- theme/background/isPublic: passthrough of the editor's existing shapes,
  strings length-capped
- overall body bounded by the existing global express JSON limit

### 4.4 Rate limiting

`PUT /api/quizzes/:id/draft` gets a lenient per-user limiter (client debounces
to ~2.5s after last change; steady state is a few req/min). Reuse the existing
rate-limit infra (PR #14 pattern); do not place drafts under any aggressive
existing bucket.

## 5. Client UX (`client/src/pages/quiz-editor.tsx` + small new components)

### 5.1 Autosave

- Dirty flag set by any editor state change; ~2.5s debounce then:
  - edit mode → `PUT /api/quizzes/:id/draft`
  - create mode → localStorage `quizDraft:new:{tenantId}:{userId}`
- Status chip next to Save: "Saving draft…" / "Draft saved HH:MM" /
  "Draft not saved — will retry". No toasts for autosave failures.
- Autosave pauses while the Save mutation is in flight; re-arms on next change.
- Successful Save clears both the server draft (transactionally, server-side)
  and the localStorage key (client-side).

### 5.2 Resume prompt

On editor open, fetch quiz + draft in parallel (create mode: read localStorage).
If a draft exists: AlertDialog — "Unsaved changes from {relative time}" with
**Resume editing** (hydrate editor from draft) or **Discard**
(`DELETE .../draft` / remove key, hydrate from live quiz). Integrates with the
existing once-per-payload hydration guard; the known gotcha applies: never put
`t` in the hydration effect's deps without that guard.

### 5.3 History panel

- "History" button in the editor header (edit mode only) opens a Sheet.
- List newest-first: version number, relative time, title, question count.
- Click a version → fetch full payload → read-only preview (question text, type
  badge, answer count; not a gameplay render).
- **Restore**: confirmation dialog ("This replaces the editor's current
  content"), then load payload into editor state, mark dirty, close panel.
  Trainer saves normally → restore is recorded as a new version.
- Empty state: "Versions appear after your next save."

### 5.4 i18n / RTL

All new strings under `editor.autosave.*`, `editor.history.*`, `editor.draft.*`
with real EN + AR values (untranslated-guard test enforces). Sheet, dialogs, and
status chip must render correctly in RTL.

## 6. Edge cases

- **Two tabs, same owner:** last-writer-wins on the draft slot. Documented, not
  defended (single-owner product today).
- **Archived quizzes:** draft/version routes follow the existing `PUT` behavior
  exactly; no new archived-state checks.
- **Draft exists but live row changed elsewhere:** existence-based prompt still
  correct — resume shows draft content, discard falls back to live.
- **Offline autosave failure:** chip shows retry state; work remains in editor
  memory; next change re-triggers.
- **Version list for pre-feature quizzes:** empty until first post-deploy save.

## 7. Testing

- **Unit:** `quizDraftSchema` (accepts partial questions; rejects oversize
  strings/counts); snapshot + prune logic on MemStorage.
- **Integration (live-DB suite):**
  - Save creates a version holding the previous state; field fidelity.
  - 21st save prunes to exactly 20, oldest first.
  - Draft lifecycle: upsert → get → delete; upsert overwrites.
  - Save transaction deletes the draft.
  - Non-owner → 403 on all five new routes; second-tenant isolation assertions
    (same pattern as `getCompletedQuizGames` tests).
  - Restore-then-save yields a new version; prior versions unchanged.
- **Gate per commit:** `npm run check && npm test && npm run build`.
- **Ship-time:** apply migration 0011 to Supabase; browser QA (autosave chip
  states, kill-tab resume, discard, history preview + restore, AR/RTL) before
  merge.

## 8. Dependencies / risk

- No new npm dependencies.
- Migration 0011 (`quiz_versions`, `quiz_drafts`, RLS pairs) is purely additive.
- Riskiest touch point: making the existing quiz-update path transactional —
  mitigated by the integration tests above and by keeping `updateQuiz`'s field
  mapping unchanged.
