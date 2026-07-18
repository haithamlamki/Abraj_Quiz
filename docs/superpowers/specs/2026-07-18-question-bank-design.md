# Question Bank — Design Spec

> **Status:** Approved design, pre-implementation.
> **Date:** 2026-07-18
> **Source roadmap:** `docs/superpowers/plans/2026-07-18-product-polish-enterprise-audit.md` §4 Wave 4+ item 1.
> **Constraints (CLAUDE.md hard rules):** additive only — new table with `tenant_id` + `tenant_isolation` RLS policy pair; no breaking schema change; gameplay untouched; all storage calls through `StorageCtx`; one phase per PR; never auto-merge.

## 1. Goal

A per-tenant library of reusable questions: create once, curate with subject/tags, and reuse in any quiz. Foundation for later subsystems (AI persistence, Import, categories in Reporting).

**In scope (full reuse loop):** `bank_questions` table + RLS; Bank page (browse/search/filter/create/edit/archive/restore); "Save to bank" from the quiz editor; "Add from bank" picker in the editor.

**Out of scope (deferred):** bulk import into the bank, duplicate detection, drag-reorder, re-sync prompt for stale copies (provenance field ships dormant), per-user ownership/RBAC (Enterprise wave), full-text search index.

## 2. Core decision: copy + provenance

Adding a bank question to a quiz **copies** its JSON into the quiz's inline `questions` jsonb (snapshot semantics — gameplay, WS protocol, and scoring are untouched), and stamps `sourceQuestionId` for provenance. Later edits to the bank question do **not** propagate; `sourceQuestionId` enables a future "bank question updated — re-sync?" feature.

Rejected alternatives:
- **Pure copy (no back-link):** simplest, but closes the future propagation path for one optional field's cost.
- **Reference/normalized (quiz stores bank IDs, resolved at runtime):** live propagation, but changes the quiz/gameplay read path — violates the additive hard rule; high blast radius in `game-room-manager.ts`.

## 3. Data model (migration `0009_question_bank.sql`)

```sql
create table if not exists public.bank_questions (
  id          serial primary key,
  tenant_id   integer not null references public.tenants(id),
  created_by  integer not null,            -- users.id (attribution, not an edit gate)
  question    jsonb   not null,            -- canonical Question shape (shared/schema.ts questionSchema)
  subject     text,                        -- optional structured bucket
  tags        jsonb   not null default '[]'::jsonb,  -- string[]
  deleted_at  timestamptz,                 -- archive; mirrors quizzes soft delete (0008)
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
```

- **Indexes:** btree `(tenant_id)`; GIN on `tags`; btree `(tenant_id, subject)`. Text search runs as unindexed ILIKE over `question->>'question'` in MVP (bank sizes are small; index later if needed).
- **Migration checklist (copy the 0006 template):** `create table if not exists` → indexes → `enable` + `force` row level security → `tenant_isolation` policy pair (`is_system_context() or tenant_id = current_tenant_id()` on both `using` and `with check`) → `grant select, insert, update, delete … to quiz_app` + sequence grant → idempotent, wrapped in `begin/commit`. No backfill (table starts empty), so no system-context `set_config` needed.
- **`question` reuses `questionSchema`** including the `normalizeLegacyQuestion` preprocess — bank and quiz speak identical JSON, so copy-to-quiz is a structural copy.
- **Shared-schema change (the only one):** add `sourceQuestionId: z.number().int().optional()` to `questionObjectSchema`. It must be an explicit field (Zod strips unknown keys). Ignored by gameplay/scoring.
- **Archive, not delete:** archived questions leave listings/picker but stay resolvable by id, so provenance never dangles.
- **`updated_at`** is stamped by the storage layer on every update/archive/restore (no DB trigger).

## 4. Server layer

### Storage (`IStorage` + MemStorage + SupabaseStorage)

```ts
getBankQuestions(ctx, filters?: { search?: string; subject?: string; tags?: string[]; includeArchived?: boolean }): Promise<BankQuestion[]>
getBankQuestion(ctx, id: number): Promise<BankQuestion | undefined>
createBankQuestion(ctx, data: InsertBankQuestion): Promise<BankQuestion>
updateBankQuestion(ctx, id: number, updates: Partial<InsertBankQuestion>): Promise<BankQuestion>
archiveBankQuestion(ctx, id: number): Promise<BankQuestion | undefined>
restoreBankQuestion(ctx, id: number): Promise<BankQuestion | undefined>
getBankSubjectsAndTags(ctx): Promise<{ subjects: string[]; tags: string[] }>
```

Filtering in SQL for Drizzle (ILIKE, `tags @> jsonb`, subject equality), in JS for MemStorage; identical observable behavior, tested against MemStorage.

### Routes (all `requireAuth`; the bank is never public)

| Route | Purpose |
|---|---|
| `GET /api/bank/questions` | List; `?search=&subject=&tags=&archived=` |
| `GET /api/bank/questions/meta` | Distinct subjects + tags (filters, autosuggest) |
| `POST /api/bank/questions` | Create (`insertBankQuestionSchema`) |
| `PUT /api/bank/questions/:id` | Update |
| `DELETE /api/bank/questions/:id` | Archive (soft) |
| `POST /api/bank/questions/:id/restore` | Restore |

- **Tenant context:** `tctx(req)` on every call; no SYSTEM_CTX anywhere in this feature. RLS is the second layer.
- **Ownership:** tenant-shared. Any authenticated user in the tenant can view/use/edit the whole bank; `created_by` is attribution only. Matches the current quizzes model; per-user gating arrives with RBAC (Enterprise wave).
- **Validation:** `insertBankQuestionSchema = { question: questionSchema, subject: z.string().max(100).optional(), tags: z.array(z.string().min(1).max(50)).max(20).default([]) }`. Tags normalized server-side: trim, drop empties, collapse case-insensitive duplicates.
- **Rate limiting:** none added — ordinary authenticated CRUD, same class as quiz CRUD.
- **No copy endpoints:** "save to bank" is a plain `POST /api/bank/questions`; "add from bank" is a client-side copy into editor state. The server never orchestrates the copy.

## 5. Client UX

### Bank page — `/question-bank` (`client/src/pages/question-bank.tsx`) + nav entry

- Layout mirrors `quiz-history.tsx`: header, search input, filter row (subject dropdown from `/meta`, tag multi-select chips, "show archived" toggle), card list.
- Card: question text preview, type badge (quiz / true-false / poll), subject + tag chips, image thumbnail if present, author, updated date. Actions: Edit, Archive/Restore.
- Create/Edit dialog reuses the editor's question form via a new shared **`QuestionForm`** component (type, answers, correct marks, time limit, points, image upload) plus bank-only fields (subject, tags with autosuggest).
- Wave-1 primitives throughout: `Skeleton` loaders, `EmptyState`, `ErrorState`, `<Button>` variants.

### `QuestionForm` extraction (the one targeted refactor)

Extract the per-question form UI from `quiz-editor.tsx` (~766 lines) into a shared component consumed by both the editor and the bank dialog. Behavior-preserving; keeps the two surfaces in sync by construction.

### Editor integration (`quiz-editor.tsx`)

1. **Save to bank:** icon button on each question card → mini-dialog for subject/tags → `POST /api/bank/questions` → success toast. The quiz itself is unchanged.
2. **Add from bank:** button next to "Add question" → picker dialog with the same search/subject/tag filters, checkbox multi-select, "Add N questions". Each selection is deep-copied into local `questions` state with `sourceQuestionId` stamped, then flows through the normal quiz save path.

### i18n / RTL

All new strings in both `en.json` and `ar.json` from day one; dialogs, chips, and filters RTL-clean. Verified on both tenants (abraj EN, PDO Arabic-default).

## 6. Testing

- **Schema unit tests:** `insertBankQuestionSchema` accept/reject (poll with correctAnswers rejected; tag caps); `sourceQuestionId` optional and **preserved through a `questionSchema` round-trip** (guards provenance against Zod stripping).
- **Storage tests (MemStorage):** CRUD, archive/restore, every filter, meta dedup/normalization.
- **Route integration tests:** 401 anon on every endpoint, Zod 400s, happy paths.
- **RLS test (`migration.test.ts` pattern):** cross-tenant denial on `bank_questions` — tenant A cannot read/write tenant B's rows even by id.
- **Gameplay regression surface: zero by construction.** Quizzes keep inline jsonb; game engine/WS/scoring untouched. Only shared change is the optional `sourceQuestionId`, covered by the round-trip test.
- Every PR green through `npm run check && npm test && npm run build`.

## 7. Rollout — 3 PRs

1. **Foundation:** migration 0009, shared schema types/Zod, `IStorage` + both implementations, routes, all server tests.
2. **Bank page:** `QuestionForm` extraction (own commit, behavior-preserving, before the bank dialog consumes it), `/question-bank` page + nav, i18n keys, browser verification (both tenants, EN/AR, LTR/RTL).
3. **Editor integration:** save-to-bank, add-from-bank picker, provenance stamping, manual editor regression check (create + edit quiz flows).

## 8. Risks

| Risk | Mitigation |
|---|---|
| `QuestionForm` extraction regresses the editor | Behavior-preserving extraction in its own commit inside PR 2; manual editor verification before merge |
| Zod strips `sourceQuestionId` on quiz save → provenance silently lost | Explicit optional field + round-trip test |
| Migration misses grants/RLS | 0006 template copied verbatim; cross-tenant denial test in CI |
| Tag sprawl (case/whitespace dupes) | Server-side normalization + autosuggest steering toward existing tags |
