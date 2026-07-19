# Quiz Versioning + Draft Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trainers never lose editor work (server-side draft autosave separate from the live quiz) and can list/preview/restore the last 20 saved states of any quiz.

**Architecture:** Two new tenant-isolated tables — `quiz_versions` (immutable, snapshot of the quiz's *previous* state written inside a now-transactional save path, pruned to 20) and `quiz_drafts` (one mutable slot per quiz, upserted by a debounced client autosave, deleted in the same transaction as a successful Save so *draft existence ≡ unsaved changes*). New owner-gated routes in a DI module; restore is client-side (load version into editor, normal Save records it). Never-saved quizzes autosave to localStorage.

**Tech Stack:** Drizzle ORM + Postgres (RLS), Express + Zod, React 18 + TanStack Query, i18next (EN+AR), node:test (unit) + vitest (integration). **No new npm dependencies.**

**Spec:** `docs/superpowers/specs/2026-07-19-versioning-autosave-design.md` — read it first.

## Global Constraints

- Branch: create `feat/versioning-autosave` off `main` before Task 1.
- Gate before EVERY commit: `npm run check && npm test && npm run build` (CLAUDE.md workflow rule).
- Every new table MUST have `tenant_id` + the tenant_isolation RLS policy pair (CLAUDE.md hard rule). Migration mirrors `migrations/0009_question_bank.sql` exactly (FORCE RLS, `quiz_app` grants, idempotent, begin/commit).
- Never call storage methods without a `StorageCtx`; request paths use `tctx(req)`.
- All new client strings need real EN **and** AR values (`client/src/lib/language.test.ts` guard rejects identical EN/AR values longer than 3 chars).
- Retention cap: **20** versions per quiz (`MAX_QUIZ_VERSIONS`). Autosave debounce: **2500 ms**. Draft rate limit: **60/min per user**, env override `RATE_LIMIT_DRAFT_MAX`.
- No new columns on `quizzes` or any other client-visible row (spread-leak hazard).
- Version/draft payloads contain `correctAnswers` — every new endpoint MUST be owner-gated (`quiz.createdBy === req.authUserId`); nothing here may ever be reachable by players.
- Windows dev box: use PowerShell-compatible commands where shell matters; tests/gate commands are cross-platform npm scripts.

---

## File map

| File | Role |
|---|---|
| `migrations/0011_quiz_versioning.sql` | Create: both tables, RLS pairs, grants |
| `shared/schema.ts` | Modify: Drizzle tables, `quizDraftSchema`, `MAX_QUIZ_VERSIONS`, types |
| `shared/quiz-draft-schema.test.ts` | Create: draft-schema unit tests |
| `server/storage.ts` | Modify: IStorage + DatabaseStorage + MemStorage methods |
| `server/storage.test.ts` | Modify: version/draft storage unit tests (MemStorage) |
| `server/rate-limits.ts` (+ `.test.ts`) | Modify: `draft` limiter |
| `server/version-routes.ts` | Create: DI route module (5 routes) |
| `server/version-routes.test.ts` | Create: route unit tests (MemStorage harness) |
| `server/routes.ts` | Modify: register module; PUT save path → `updateQuizWithVersion` |
| `client/src/hooks/use-quiz-autosave.ts` | Create: debounced autosave hook + localStorage key helper |
| `client/src/components/quiz/VersionHistorySheet.tsx` | Create: history list/preview/restore Sheet |
| `client/src/pages/quiz-editor.tsx` | Modify: `toQuizForm` extraction, autosave chip, resume dialog, History button |
| `client/src/locales/en.json`, `ar.json` | Modify: `editor.autosave.*`, `editor.draft.*`, `editor.history.*` |
| `tests/integration/quiz-versioning.test.ts` | Create: end-to-end HTTP + RLS tests |

---

### Task 1: Migration 0011 + shared schema (tables, draft schema, types)

**Files:**
- Create: `migrations/0011_quiz_versioning.sql`
- Modify: `shared/schema.ts` (tables after `bankQuestions` ~line 170; zod schema + types near `insertBankQuestionSchema` ~line 348; constants near `MAX_BANK_BULK_ITEMS` ~line 382)
- Test: `shared/quiz-draft-schema.test.ts`

**Interfaces:**
- Consumes: existing `tenants`, `quizzes` tables; zod; drizzle helpers already imported in `shared/schema.ts`.
- Produces (later tasks rely on these exact names):
  - Drizzle tables `quizVersions`, `quizDrafts`
  - `export const MAX_QUIZ_VERSIONS = 20`
  - `export const quizDraftSchema` and `export type QuizDraftPayload = z.infer<typeof quizDraftSchema>`
  - `export type QuizVersion = typeof quizVersions.$inferSelect`
  - `export type QuizDraft = typeof quizDrafts.$inferSelect`
  - `export interface QuizVersionListItem { versionNumber: number; title: string; questionCount: number; createdAt: Date | null }`

- [ ] **Step 0: Create the branch**

```bash
git checkout -b feat/versioning-autosave
```

- [ ] **Step 1: Write the failing draft-schema test**

Create `shared/quiz-draft-schema.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { quizDraftSchema, MAX_QUIZ_VERSIONS } from "./schema";

test("quizDraftSchema accepts half-typed content insertQuizSchema would reject", () => {
  const parsed = quizDraftSchema.parse({
    title: "",                                  // empty title is fine in a draft
    questions: [
      { question: "half-typed", answers: ["only one"], correctAnswers: [] }, // no correct answer yet
      {},                                       // even an empty question object
    ],
  });
  assert.equal(parsed.title, "");
  assert.equal(parsed.questions.length, 2);
  // Defaults are filled so the payload is always structurally complete.
  assert.equal(parsed.questions[1].type, "quiz");
  assert.equal(parsed.questions[1].timeLimit, 20);
  assert.equal(parsed.isPublic, true);
});

test("quizDraftSchema strips unknown keys (no payload smuggling)", () => {
  const parsed = quizDraftSchema.parse({
    title: "t",
    evil: "x",
    questions: [{ question: "q", sneaky: true }],
  } as any);
  assert.ok(!("evil" in parsed));
  assert.ok(!("sneaky" in (parsed.questions[0] as any)));
});

test("quizDraftSchema enforces hard bounds", () => {
  // 101 questions
  assert.throws(() =>
    quizDraftSchema.parse({ questions: Array.from({ length: 101 }, () => ({})) }),
  );
  // title over 200 chars
  assert.throws(() => quizDraftSchema.parse({ title: "x".repeat(201), questions: [] }));
  // per-question string over 5000 chars
  assert.throws(() =>
    quizDraftSchema.parse({ questions: [{ question: "x".repeat(5001) }] }),
  );
  // more than 10 answers
  assert.throws(() =>
    quizDraftSchema.parse({ questions: [{ answers: Array.from({ length: 11 }, () => "a") }] }),
  );
});

test("MAX_QUIZ_VERSIONS is 20", () => {
  assert.equal(MAX_QUIZ_VERSIONS, 20);
});
```

- [ ] **Step 2: Run it — must fail**

Run: `npm test`
Expected: FAIL — `quizDraftSchema`/`MAX_QUIZ_VERSIONS` are not exported from `./schema`.

- [ ] **Step 3: Add Drizzle tables to `shared/schema.ts`**

Insert after the `bankQuestions` table definition (before `export const sessions`):

```ts
// ── Quiz versioning + drafts (Enterprise wave slice 1) ───────────
// quiz_versions is an immutable, append-only history: every explicit Save of
// a quiz banks the PREVIOUS row state here (pruned to MAX_QUIZ_VERSIONS).
// Deliberately a separate table — never new columns on the client-visible
// quizzes row (spread-leak hazard). Payloads carry correctAnswers, so every
// read path is owner-gated.
export const quizVersions = pgTable(
  "quiz_versions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    quizId: integer("quiz_id").notNull().references(() => quizzes.id),
    versionNumber: integer("version_number").notNull(), // per-quiz, max+1
    title: text("title").notNull(),
    description: text("description"),
    questions: jsonb("questions").notNull(),
    theme: jsonb("theme"),
    background: text("background"),
    isPublic: boolean("is_public"),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("quiz_versions_quiz_version_uq").on(t.quizId, t.versionNumber),
    index("quiz_versions_quiz_idx").on(t.quizId),
    index("quiz_versions_tenant_idx").on(t.tenantId),
  ],
);

// One mutable draft slot per quiz. Deleted in the same transaction as a
// successful Save, so DRAFT EXISTENCE ≡ UNSAVED CHANGES (the client's resume
// prompt relies on this — quizzes has no updated_at to compare against).
export const quizDrafts = pgTable(
  "quiz_drafts",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    quizId: integer("quiz_id").notNull().references(() => quizzes.id),
    payload: jsonb("payload").notNull(), // quizDraftSchema shape
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("quiz_drafts_quiz_uq").on(t.quizId),
    index("quiz_drafts_tenant_idx").on(t.tenantId),
  ],
);
```

- [ ] **Step 4: Add draft schema, constant, and types to `shared/schema.ts`**

Insert after `insertBankQuestionSchema` (before `generatedQuizSchema`):

```ts
// Draft payloads must accept invalid-in-progress content that
// insertQuizSchema/quizQuestionsSchema reject (empty title, no correct answer
// marked, empty answer text) — but stay strict on BOUNDS so a pathological
// client can't store megabytes of junk. Unknown keys are stripped.
const draftQuestionSchema = z
  .object({
    question: z.string().max(5000).default(""),
    imageUrl: z.string().max(2000).optional(),
    type: z.string().max(30).default("quiz"),
    answerType: z.string().max(30).default("single"),
    answers: z.array(z.string().max(5000)).max(10).default([]),
    correctAnswers: z.array(z.number().int().min(0).max(9)).max(10).default([]),
    timeLimit: z.number().int().min(1).max(600).default(20),
    points: z.string().max(20).default("standard"),
  })
  .strip();

export const quizDraftSchema = z
  .object({
    title: z.string().max(200).default(""),
    description: z.string().max(2000).default(""),
    // May hold a base64 data URL (same as quizzes.background); the global
    // express JSON body limit is the real ceiling.
    background: z.string().default("classroom"),
    isPublic: z.boolean().default(true),
    theme: z.record(z.any()).optional(), // matches insertQuizSchema's theme
    questions: z.array(draftQuestionSchema).max(100).default([]),
  })
  .strip();
export type QuizDraftPayload = z.infer<typeof quizDraftSchema>;

// Retention cap for quiz_versions, enforced on write (prune oldest).
export const MAX_QUIZ_VERSIONS = 20;
```

Insert in the `// Types` block at the bottom of the file:

```ts
export type QuizVersion = typeof quizVersions.$inferSelect;
export type QuizDraft = typeof quizDrafts.$inferSelect;

// Light list item for the history panel — deliberately NO questions payload.
export interface QuizVersionListItem {
  versionNumber: number;
  title: string;
  questionCount: number;
  createdAt: Date | null;
}
```

- [ ] **Step 5: Write `migrations/0011_quiz_versioning.sql`**

```sql
-- 0011_quiz_versioning.sql — quiz version history + draft autosave.
--
-- quiz_versions: immutable snapshots of a quiz's previous state, written on
-- every explicit save (server prunes to the newest 20 per quiz).
-- quiz_drafts: ONE mutable autosave slot per quiz; deleted in the same
-- transaction as a successful save, so row existence == unsaved changes.
--
-- Payloads carry answer keys — application routes are owner-gated; RLS is the
-- tenant second layer, as everywhere else.
--
-- ORDERING: run as the migration owner (Supabase `postgres`) AFTER 0003_rls.sql
-- and 0005_quiz_app_role.sql. Idempotent — safe to re-run.
begin;

create table if not exists public.quiz_versions (
  id             serial primary key,
  tenant_id      integer not null references public.tenants(id),
  quiz_id        integer not null references public.quizzes(id),
  version_number integer not null,
  title          text    not null,
  description    text,
  questions      jsonb   not null,
  theme          jsonb,
  background     text,
  is_public      boolean,
  created_by     integer not null,
  created_at     timestamptz default now(),
  constraint quiz_versions_quiz_version_uq unique (quiz_id, version_number)
);

create index if not exists quiz_versions_quiz_idx   on public.quiz_versions (quiz_id);
create index if not exists quiz_versions_tenant_idx on public.quiz_versions (tenant_id);

create table if not exists public.quiz_drafts (
  id         serial primary key,
  tenant_id  integer not null references public.tenants(id),
  quiz_id    integer not null references public.quizzes(id),
  payload    jsonb   not null,
  updated_at timestamptz not null default now(),
  constraint quiz_drafts_quiz_uq unique (quiz_id)
);

create index if not exists quiz_drafts_tenant_idx on public.quiz_drafts (tenant_id);

-- Tenant isolation (CLAUDE.md hard rule: every business table gets tenant_id +
-- the tenant_isolation policy pair). FORCE so the owner is subject too and the
-- quiz_app role cannot bypass it.
alter table public.quiz_versions enable row level security;
alter table public.quiz_versions force row level security;
drop policy if exists tenant_isolation on public.quiz_versions;
create policy tenant_isolation on public.quiz_versions
  using (public.is_system_context() or tenant_id = public.current_tenant_id())
  with check (public.is_system_context() or tenant_id = public.current_tenant_id());

alter table public.quiz_drafts enable row level security;
alter table public.quiz_drafts force row level security;
drop policy if exists tenant_isolation on public.quiz_drafts;
create policy tenant_isolation on public.quiz_drafts
  using (public.is_system_context() or tenant_id = public.current_tenant_id())
  with check (public.is_system_context() or tenant_id = public.current_tenant_id());

-- Explicit grants for the application role (mirrors 0009).
grant select, insert, update, delete on public.quiz_versions to quiz_app;
grant usage, select on sequence public.quiz_versions_id_seq to quiz_app;
grant select, insert, update, delete on public.quiz_drafts to quiz_app;
grant usage, select on sequence public.quiz_drafts_id_seq to quiz_app;

commit;

-- VERIFY (run in system context — see 0003 header):
--   select set_config('app.role','system',false);
--   select count(*) from quiz_versions;  -- 0 on a fresh install
--   select count(*) from quiz_drafts;    -- 0 on a fresh install
```

- [ ] **Step 6: Run the gate**

Run: `npm run check && npm test && npm run build`
Expected: typecheck clean; the new shared tests PASS; build OK. (The migration file is not executed by any test yet — Task 8 verifies it against the real DB.)

- [ ] **Step 7: Commit**

```bash
git add migrations/0011_quiz_versioning.sql shared/schema.ts shared/quiz-draft-schema.test.ts
git commit -m "feat(versioning): migration 0011 + quiz_versions/quiz_drafts schema and draft zod schema"
```

---

### Task 2: Storage layer — versions + drafts on both backends

**Files:**
- Modify: `server/storage.ts` (IStorage interface ~line 129-201; DatabaseStorage quiz section after `restoreQuiz` ~line 313; MemStorage fields/constructor ~line 788-820 and quiz section after `updateQuiz` ~line 1006)
- Test: `server/storage.test.ts` (append)

**Interfaces:**
- Consumes (Task 1): `quizVersions`, `quizDrafts`, `MAX_QUIZ_VERSIONS`, `QuizVersion`, `QuizDraft`, `QuizDraftPayload`, `QuizVersionListItem` from `@shared/schema`. Existing internals: `withCtx`, `tenantFilter`, `requireTenantId`, `inTenant` (MemStorage), drizzle's `and, eq, desc, sql` (all already imported at `server/storage.ts:12`).
- Produces (exact IStorage additions — Task 3/4 call these):

```ts
listQuizVersions(ctx: StorageCtx, quizId: number): Promise<QuizVersionListItem[]>;
getQuizVersion(ctx: StorageCtx, quizId: number, versionNumber: number): Promise<QuizVersion | undefined>;
updateQuizWithVersion(ctx: StorageCtx, id: number, updates: Partial<InsertQuiz>): Promise<Quiz>;
getQuizDraft(ctx: StorageCtx, quizId: number): Promise<QuizDraft | undefined>;
upsertQuizDraft(ctx: StorageCtx, quizId: number, payload: QuizDraftPayload): Promise<QuizDraft>;
deleteQuizDraft(ctx: StorageCtx, quizId: number): Promise<void>;
```

- [ ] **Step 1: Write the failing storage tests**

Append to `server/storage.test.ts` (it already imports `MemStorage`; reuse its existing test-setup conventions — check the top of the file for how it constructs storage and ctx; MemStorage seeds tenant-1 sample data, use `const ctx = { tenantId: 1 }` and create fresh quizzes per test):

```ts
test("updateQuizWithVersion snapshots the PREVIOUS state and deletes the draft", async () => {
  const s = new MemStorage();
  const ctx = { tenantId: 1 };
  const quiz = await s.createQuiz(ctx, {
    title: "v1 title", description: "d", questions: [{ question: "q1", answers: ["a", "b"], correctAnswers: [0], type: "quiz", answerType: "single", timeLimit: 20, points: "standard" }],
    background: "classroom", isPublic: true, createdBy: 1,
  } as any);
  await s.upsertQuizDraft(ctx, quiz.id, { title: "wip", description: "", background: "classroom", isPublic: true, questions: [] });

  const updated = await s.updateQuizWithVersion(ctx, quiz.id, { title: "v2 title" });
  assert.equal(updated.title, "v2 title");

  const list = await s.listQuizVersions(ctx, quiz.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].versionNumber, 1);
  assert.equal(list[0].title, "v1 title");          // PREVIOUS state, not the new one
  assert.equal(list[0].questionCount, 1);

  const full = await s.getQuizVersion(ctx, quiz.id, 1);
  assert.equal(full?.title, "v1 title");
  assert.equal((full?.questions as any[]).length, 1);

  assert.equal(await s.getQuizDraft(ctx, quiz.id), undefined); // save killed the draft
});

test("updateQuizWithVersion prunes to MAX_QUIZ_VERSIONS, oldest first", async () => {
  const s = new MemStorage();
  const ctx = { tenantId: 1 };
  const quiz = await s.createQuiz(ctx, {
    title: "t0", questions: [], background: "classroom", isPublic: true, createdBy: 1,
  } as any);
  for (let i = 1; i <= 21; i++) {
    await s.updateQuizWithVersion(ctx, quiz.id, { title: `t${i}` });
  }
  const list = await s.listQuizVersions(ctx, quiz.id);
  assert.equal(list.length, 20);
  assert.equal(list[0].versionNumber, 21);           // newest first
  assert.equal(list[19].versionNumber, 2);           // version 1 pruned
  assert.equal(await s.getQuizVersion(ctx, quiz.id, 1), undefined);
});

test("quiz draft lifecycle: upsert overwrites, get returns latest, delete is idempotent", async () => {
  const s = new MemStorage();
  const ctx = { tenantId: 1 };
  const quiz = await s.createQuiz(ctx, {
    title: "t", questions: [], background: "classroom", isPublic: true, createdBy: 1,
  } as any);
  const d1 = await s.upsertQuizDraft(ctx, quiz.id, { title: "one", description: "", background: "classroom", isPublic: true, questions: [] });
  const d2 = await s.upsertQuizDraft(ctx, quiz.id, { title: "two", description: "", background: "classroom", isPublic: true, questions: [] });
  assert.equal(d1.quizId, d2.quizId);
  const got = await s.getQuizDraft(ctx, quiz.id);
  assert.equal((got?.payload as any).title, "two");
  await s.deleteQuizDraft(ctx, quiz.id);
  await s.deleteQuizDraft(ctx, quiz.id);             // idempotent — no throw
  assert.equal(await s.getQuizDraft(ctx, quiz.id), undefined);
});

test("versions and drafts are invisible from another tenant ctx", async () => {
  const s = new MemStorage();
  const ctx1 = { tenantId: 1 };
  const ctx2 = { tenantId: 2 };
  const quiz = await s.createQuiz(ctx1, {
    title: "t", questions: [], background: "classroom", isPublic: true, createdBy: 1,
  } as any);
  await s.updateQuizWithVersion(ctx1, quiz.id, { title: "t2" });
  await s.upsertQuizDraft(ctx1, quiz.id, { title: "wip", description: "", background: "classroom", isPublic: true, questions: [] });

  assert.deepEqual(await s.listQuizVersions(ctx2, quiz.id), []);
  assert.equal(await s.getQuizVersion(ctx2, quiz.id, 1), undefined);
  assert.equal(await s.getQuizDraft(ctx2, quiz.id), undefined);
});
```

Note: match the existing import/test style at the top of `server/storage.test.ts` (`import test from "node:test"; import assert from "node:assert/strict";` and the `DATABASE_URL ||=` guard + dynamic import pattern if present — copy whatever the file already does).

- [ ] **Step 2: Run — must fail**

Run: `npm test`
Expected: FAIL — the new methods don't exist (TS build error via tsx, or assertion failures).

- [ ] **Step 3: Add the interface methods**

In `server/storage.ts`, add to the `IStorage` interface (after `updateQuiz`, ~line 141) exactly the six signatures from the **Produces** block above. Add `QuizVersion, QuizDraft, QuizDraftPayload, QuizVersionListItem, quizVersions, quizDrafts, MAX_QUIZ_VERSIONS` to the existing `@shared/schema` import at the top.

- [ ] **Step 4: DatabaseStorage implementation**

Insert after `restoreQuiz` (~line 313):

```ts
// ── Quiz versions + drafts ────────────────────────────────────────
// Save path: snapshot previous state → update → kill draft → prune. All four
// steps share ONE transaction (withCtx) so draft existence stays a truthful
// "unsaved changes" signal and history can never skew from the live row.
async updateQuizWithVersion(ctx: StorageCtx, id: number, updates: Partial<InsertQuiz>): Promise<Quiz> {
  return withCtx(ctx, async (tx) => {
    const [existing] = await tx.select().from(quizzes)
      .where(and(eq(quizzes.id, id), tenantFilter(ctx, quizzes.tenantId)));
    if (!existing) throw new Error("Quiz not found");

    const [row] = await tx.select({
      max: sql<number>`coalesce(max(${quizVersions.versionNumber}), 0)`,
    }).from(quizVersions).where(eq(quizVersions.quizId, id));
    const versionNumber = Number(row.max) + 1;

    await tx.insert(quizVersions).values({
      tenantId: existing.tenantId,
      quizId: id,
      versionNumber,
      title: existing.title,
      description: existing.description,
      questions: existing.questions,
      theme: existing.theme,
      background: existing.background,
      isPublic: existing.isPublic,
      createdBy: existing.createdBy,
    });

    const [quiz] = await tx.update(quizzes).set(updates)
      .where(and(eq(quizzes.id, id), tenantFilter(ctx, quizzes.tenantId)))
      .returning();

    await tx.delete(quizDrafts)
      .where(and(eq(quizDrafts.quizId, id), tenantFilter(ctx, quizDrafts.tenantId)));

    // Prune: keep the newest MAX_QUIZ_VERSIONS.
    await tx.delete(quizVersions).where(and(
      eq(quizVersions.quizId, id),
      sql`${quizVersions.versionNumber} <= ${versionNumber - MAX_QUIZ_VERSIONS}`,
    ));

    return quiz;
  });
}

async listQuizVersions(ctx: StorageCtx, quizId: number): Promise<QuizVersionListItem[]> {
  return withCtx(ctx, async (tx) => {
    const rows = await tx.select({
      versionNumber: quizVersions.versionNumber,
      title: quizVersions.title,
      questionCount: sql<number>`jsonb_array_length(${quizVersions.questions})`,
      createdAt: quizVersions.createdAt,
    }).from(quizVersions)
      .where(and(eq(quizVersions.quizId, quizId), tenantFilter(ctx, quizVersions.tenantId)))
      .orderBy(desc(quizVersions.versionNumber));
    return rows.map((r) => ({ ...r, questionCount: Number(r.questionCount) }));
  });
}

async getQuizVersion(ctx: StorageCtx, quizId: number, versionNumber: number): Promise<QuizVersion | undefined> {
  return withCtx(ctx, async (tx) => {
    const [row] = await tx.select().from(quizVersions).where(and(
      eq(quizVersions.quizId, quizId),
      eq(quizVersions.versionNumber, versionNumber),
      tenantFilter(ctx, quizVersions.tenantId),
    ));
    return row || undefined;
  });
}

async getQuizDraft(ctx: StorageCtx, quizId: number): Promise<QuizDraft | undefined> {
  return withCtx(ctx, async (tx) => {
    const [row] = await tx.select().from(quizDrafts)
      .where(and(eq(quizDrafts.quizId, quizId), tenantFilter(ctx, quizDrafts.tenantId)));
    return row || undefined;
  });
}

async upsertQuizDraft(ctx: StorageCtx, quizId: number, payload: QuizDraftPayload): Promise<QuizDraft> {
  const tenantId = requireTenantId(ctx);
  return withCtx(ctx, async (tx) => {
    const [row] = await tx.insert(quizDrafts)
      .values({ tenantId, quizId, payload, updatedAt: sql`now()` as any })
      .onConflictDoUpdate({
        target: quizDrafts.quizId,
        set: { payload, updatedAt: sql`now()` as any },
      })
      .returning();
    return row;
  });
}

async deleteQuizDraft(ctx: StorageCtx, quizId: number): Promise<void> {
  return withCtx(ctx, async (tx) => {
    await tx.delete(quizDrafts)
      .where(and(eq(quizDrafts.quizId, quizId), tenantFilter(ctx, quizDrafts.tenantId)));
  });
}
```

- [ ] **Step 5: MemStorage implementation**

Add fields + constructor init (match existing style, ~line 789-816):

```ts
private quizVersions: Map<number, QuizVersion>;
private quizDrafts: Map<number, QuizDraft>;       // keyed by quizId (one slot)
private currentQuizVersionId: number;
private currentQuizDraftId: number;
```

```ts
// in constructor:
this.quizVersions = new Map();
this.quizDrafts = new Map();
this.currentQuizVersionId = 1;
this.currentQuizDraftId = 1;
```

Insert after MemStorage's `updateQuiz` (~line 1006):

```ts
async updateQuizWithVersion(ctx: StorageCtx, id: number, updates: Partial<InsertQuiz>): Promise<Quiz> {
  const existing = this.quizzes.get(id);
  if (!existing || !this.inTenant(ctx, existing)) throw new Error("Quiz not found");

  const mine = Array.from(this.quizVersions.values()).filter((v) => v.quizId === id);
  const versionNumber = mine.reduce((m, v) => Math.max(m, v.versionNumber), 0) + 1;

  const version: QuizVersion = {
    id: this.currentQuizVersionId++,
    tenantId: existing.tenantId,
    quizId: id,
    versionNumber,
    title: existing.title,
    description: existing.description,
    questions: existing.questions,
    theme: existing.theme,
    background: existing.background,
    isPublic: existing.isPublic,
    createdBy: existing.createdBy,
    createdAt: new Date(),
  };
  this.quizVersions.set(version.id, version);

  const quiz = await this.updateQuiz(ctx, id, updates);
  this.quizDrafts.delete(id);

  for (const v of this.quizVersions.values()) {
    if (v.quizId === id && v.versionNumber <= versionNumber - MAX_QUIZ_VERSIONS) {
      this.quizVersions.delete(v.id);
    }
  }
  return quiz;
}

async listQuizVersions(ctx: StorageCtx, quizId: number): Promise<QuizVersionListItem[]> {
  return Array.from(this.quizVersions.values())
    .filter((v) => v.quizId === quizId && this.inTenant(ctx, v))
    .sort((a, b) => b.versionNumber - a.versionNumber)
    .map((v) => ({
      versionNumber: v.versionNumber,
      title: v.title,
      questionCount: Array.isArray(v.questions) ? (v.questions as unknown[]).length : 0,
      createdAt: v.createdAt,
    }));
}

async getQuizVersion(ctx: StorageCtx, quizId: number, versionNumber: number): Promise<QuizVersion | undefined> {
  return Array.from(this.quizVersions.values()).find(
    (v) => v.quizId === quizId && v.versionNumber === versionNumber && this.inTenant(ctx, v),
  );
}

async getQuizDraft(ctx: StorageCtx, quizId: number): Promise<QuizDraft | undefined> {
  const d = this.quizDrafts.get(quizId);
  return d && this.inTenant(ctx, d) ? d : undefined;
}

async upsertQuizDraft(ctx: StorageCtx, quizId: number, payload: QuizDraftPayload): Promise<QuizDraft> {
  const tenantId = requireTenantId(ctx);
  const existing = this.quizDrafts.get(quizId);
  const row: QuizDraft = {
    id: existing?.id ?? this.currentQuizDraftId++,
    tenantId,
    quizId,
    payload,
    updatedAt: new Date(),
  };
  this.quizDrafts.set(quizId, row);
  return row;
}

async deleteQuizDraft(ctx: StorageCtx, quizId: number): Promise<void> {
  const d = this.quizDrafts.get(quizId);
  if (d && this.inTenant(ctx, d)) this.quizDrafts.delete(quizId);
}
```

Note: `inTenant` is MemStorage's existing tenant check helper — confirm its exact name/signature at the top of the MemStorage class and match it (it is used as `this.inTenant(ctx, row)` on rows with a `tenantId` field, e.g. in `updateQuiz` at ~line 991).

- [ ] **Step 6: Run the gate**

Run: `npm run check && npm test && npm run build`
Expected: all PASS, including the four new storage tests.

- [ ] **Step 7: Commit**

```bash
git add server/storage.ts server/storage.test.ts
git commit -m "feat(versioning): IStorage + Database/Mem storage for quiz versions and drafts"
```

---

### Task 3: Rate limiter, version/draft routes, and save-path wiring

**Files:**
- Modify: `server/rate-limits.ts` (settings + builder), `server/rate-limits.test.ts` (append)
- Create: `server/version-routes.ts`
- Create: `server/version-routes.test.ts`
- Modify: `server/routes.ts` — import + register module (next to `registerReportRoutes(...)` at ~line 695); destructure the new limiter (~line 122); switch the PUT handler's `storage.updateQuiz(...)` call (~line 609) to `storage.updateQuizWithVersion(...)`

**Interfaces:**
- Consumes (Task 2): the six storage methods. (Task 1): `quizDraftSchema` from `@shared/schema`.
- Produces:
  - `rateLimitSettings(env).draft` → `{ windowMs: 60_000, max: RATE_LIMIT_DRAFT_MAX default 60, skipSuccessfulRequests: false, keyBy: "user" }`; `buildRateLimiters()` additionally returns `draftLimiter`.
  - `export interface VersionRouteDeps { storage: IStorage; requireAuth: RequestHandler; tctx: (req: any) => StorageCtx; draftLimiter: RequestHandler }`
  - `export function registerVersionRoutes(app: Express, deps: VersionRouteDeps): void` registering:
    - `GET /api/quizzes/:id/versions` → `QuizVersionListItem[]`
    - `GET /api/quizzes/:id/versions/:versionNumber` → full version row
    - `GET /api/quizzes/:id/draft` → `{ payload, updatedAt }` or 404
    - `PUT /api/quizzes/:id/draft` → `{ updatedAt }` (draftLimiter applied)
    - `DELETE /api/quizzes/:id/draft` → 204 always (idempotent)

- [ ] **Step 1: Failing rate-limit test**

Append to `server/rate-limits.test.ts` (match its existing import style — it tests `rateLimitSettings`):

```ts
test("draft limiter: 60/min per user by default, env-overridable", () => {
  const s = rateLimitSettings({} as NodeJS.ProcessEnv);
  assert.equal(s.draft.windowMs, 60_000);
  assert.equal(s.draft.max, 60);
  assert.equal(s.draft.keyBy, "user");
  assert.equal(s.draft.skipSuccessfulRequests, false);
  const overridden = rateLimitSettings({ RATE_LIMIT_DRAFT_MAX: "5" } as any);
  assert.equal(overridden.draft.max, 5);
});
```

Run: `npm test` — expected FAIL (`draft` missing on `RateLimitSettings`).

- [ ] **Step 2: Implement the limiter**

In `server/rate-limits.ts`: add `draft: LimiterSetting;` to `RateLimitSettings`; add to `rateLimitSettings`:

```ts
// Autosave drafts — debounced client-side (~2.5s), so steady state is a few
// req/min; 60/min per account only stops runaway loops, never real typing.
draft:  { windowMs: 60_000, max: intFromEnv(env, "RATE_LIMIT_DRAFT_MAX", 60), skipSuccessfulRequests: false, keyBy: "user" },
```

and to `buildRateLimiters`'s return:

```ts
draftLimiter:  toLimiter(s.draft,  "Draft is saving too often. Please slow down."),
```

Run: `npm test` — the new test passes.

- [ ] **Step 3: Failing route tests**

Create `server/version-routes.test.ts` — same harness as `server/bank-routes.test.ts:1-47` (real express + MemStorage, `x-test-user` fake auth, tctx pinned to tenant 1):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { MemStorage } = await import("./storage");
const { registerVersionRoutes } = await import("./version-routes");

function makeApp(storage: InstanceType<typeof MemStorage>) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const requireAuth = (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ message: "Authentication required" });
    req.authUserId = parseInt(String(uid), 10);
    next();
  };
  const passThrough = (_req: any, _res: any, next: any) => next();
  registerVersionRoutes(app, { storage, requireAuth, tctx: () => ({ tenantId: 1 }), draftLimiter: passThrough });
  return app;
}

async function withServer(app: express.Express, fn: (base: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const OWNER = { "x-test-user": "1", "content-type": "application/json" };
const OTHER = { "x-test-user": "2", "content-type": "application/json" };

async function seedQuiz(storage: InstanceType<typeof MemStorage>) {
  return storage.createQuiz({ tenantId: 1 }, {
    title: "seed", description: "", background: "classroom", isPublic: true, createdBy: 1,
    questions: [{ question: "q", answers: ["a", "b"], correctAnswers: [0], type: "quiz", answerType: "single", timeLimit: 20, points: "standard" }],
  } as any);
}

test("version routes: every endpoint 401s without auth", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    const cases: Array<[string, string]> = [
      ["GET", "/api/quizzes/1/versions"],
      ["GET", "/api/quizzes/1/versions/1"],
      ["GET", "/api/quizzes/1/draft"],
      ["PUT", "/api/quizzes/1/draft"],
      ["DELETE", "/api/quizzes/1/draft"],
    ];
    for (const [method, path] of cases) {
      const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });
});

test("version routes: owner-gate — non-owner gets 403 everywhere", async () => {
  const storage = new MemStorage();
  const quiz = await seedQuiz(storage);
  await withServer(makeApp(storage), async (base) => {
    const cases: Array<[string, string, string | undefined]> = [
      ["GET", `/api/quizzes/${quiz.id}/versions`, undefined],
      ["GET", `/api/quizzes/${quiz.id}/versions/1`, undefined],
      ["GET", `/api/quizzes/${quiz.id}/draft`, undefined],
      ["PUT", `/api/quizzes/${quiz.id}/draft`, "{}"],
      ["DELETE", `/api/quizzes/${quiz.id}/draft`, undefined],
    ];
    for (const [method, path, body] of cases) {
      const res = await fetch(base + path, { method, headers: OTHER, body });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
  });
});

test("version routes: 400 bad id, 404 missing quiz / version / draft", async () => {
  const storage = new MemStorage();
  const quiz = await seedQuiz(storage);
  await withServer(makeApp(storage), async (base) => {
    assert.equal((await fetch(`${base}/api/quizzes/abc/versions`, { headers: OWNER })).status, 400);
    assert.equal((await fetch(`${base}/api/quizzes/999999/versions`, { headers: OWNER })).status, 404);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/versions/7`, { headers: OWNER })).status, 404);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/versions/abc`, { headers: OWNER })).status, 400);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/draft`, { headers: OWNER })).status, 404);
  });
});

test("version routes: draft PUT validates, GET round-trips, DELETE idempotent", async () => {
  const storage = new MemStorage();
  const quiz = await seedQuiz(storage);
  await withServer(makeApp(storage), async (base) => {
    // Half-typed draft is accepted…
    const put = await fetch(`${base}/api/quizzes/${quiz.id}/draft`, {
      method: "PUT", headers: OWNER,
      body: JSON.stringify({ title: "", questions: [{ question: "half", answers: ["x"], correctAnswers: [] }] }),
    });
    assert.equal(put.status, 200);
    assert.ok((await put.json()).updatedAt);
    // …oversize is rejected.
    const bad = await fetch(`${base}/api/quizzes/${quiz.id}/draft`, {
      method: "PUT", headers: OWNER,
      body: JSON.stringify({ questions: Array.from({ length: 101 }, () => ({})) }),
    });
    assert.equal(bad.status, 400);

    const got = await fetch(`${base}/api/quizzes/${quiz.id}/draft`, { headers: OWNER });
    assert.equal(got.status, 200);
    const body = await got.json();
    assert.equal(body.payload.questions[0].question, "half");
    assert.ok(body.updatedAt);

    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/draft`, { method: "DELETE", headers: OWNER })).status, 204);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/draft`, { method: "DELETE", headers: OWNER })).status, 204);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/draft`, { headers: OWNER })).status, 404);
  });
});

test("version routes: list is light metadata, detail is the full snapshot", async () => {
  const storage = new MemStorage();
  const quiz = await seedQuiz(storage);
  await storage.updateQuizWithVersion({ tenantId: 1 }, quiz.id, { title: "second" });
  await withServer(makeApp(storage), async (base) => {
    const list = await (await fetch(`${base}/api/quizzes/${quiz.id}/versions`, { headers: OWNER })).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].versionNumber, 1);
    assert.equal(list[0].title, "seed");
    assert.equal(list[0].questionCount, 1);
    assert.ok(!("questions" in list[0]));            // list stays light

    const detail = await (await fetch(`${base}/api/quizzes/${quiz.id}/versions/1`, { headers: OWNER })).json();
    assert.equal(detail.title, "seed");
    assert.equal(detail.questions.length, 1);
    assert.deepEqual(detail.questions[0].correctAnswers, [0]); // owner-only surface
  });
});
```

Run: `npm test` — expected FAIL (`./version-routes` doesn't exist).

- [ ] **Step 4: Implement `server/version-routes.ts`**

```ts
import type { Express, RequestHandler, Response } from "express";
import type { IStorage, StorageCtx } from "./storage";
import { quizDraftSchema, type Quiz } from "@shared/schema";
import { captureError } from "./instrument";

// Quiz version-history + draft-autosave routes (report-routes DI pattern).
// EVERY route is owner-gated: version/draft payloads carry correctAnswers,
// so they may only ever be readable by the quiz owner — never players.
// Restore is deliberately client-side (load a version into the editor, then a
// normal Save records it as a new version); there is no restore endpoint.
export interface VersionRouteDeps {
  storage: IStorage;
  requireAuth: RequestHandler;
  tctx: (req: any) => StorageCtx;
  draftLimiter: RequestHandler;
}

export function registerVersionRoutes(app: Express, { storage, requireAuth, tctx, draftLimiter }: VersionRouteDeps): void {
  // Resolves + owner-authorizes the quiz, or writes the error response and
  // returns null. Same copy as PUT /api/quizzes/:id — these are edit surfaces.
  async function loadOwnedQuiz(req: any, res: Response): Promise<Quiz | null> {
    const quizId = parseInt(req.params.id, 10);
    if (!Number.isInteger(quizId) || quizId <= 0) {
      res.status(400).json({ message: "Invalid quiz id" });
      return null;
    }
    const quiz = await storage.getQuiz(tctx(req), quizId);
    if (!quiz) {
      res.status(404).json({ message: "Quiz not found" });
      return null;
    }
    if (quiz.createdBy !== req.authUserId) {
      res.status(403).json({ message: "You can only edit your own quizzes" });
      return null;
    }
    return quiz;
  }

  app.get("/api/quizzes/:id/versions", requireAuth, async (req: any, res) => {
    try {
      const quiz = await loadOwnedQuiz(req, res);
      if (!quiz) return;
      res.json(await storage.listQuizVersions(tctx(req), quiz.id));
    } catch (error) {
      captureError(error, { scope: "http.quiz-versions" });
      res.status(500).json({ message: "Failed to load version history" });
    }
  });

  app.get("/api/quizzes/:id/versions/:versionNumber", requireAuth, async (req: any, res) => {
    try {
      const quiz = await loadOwnedQuiz(req, res);
      if (!quiz) return;
      const versionNumber = parseInt(req.params.versionNumber, 10);
      if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
        return res.status(400).json({ message: "Invalid version number" });
      }
      const version = await storage.getQuizVersion(tctx(req), quiz.id, versionNumber);
      if (!version) return res.status(404).json({ message: "Version not found" });
      res.json(version);
    } catch (error) {
      captureError(error, { scope: "http.quiz-versions" });
      res.status(500).json({ message: "Failed to load version" });
    }
  });

  app.get("/api/quizzes/:id/draft", requireAuth, async (req: any, res) => {
    try {
      const quiz = await loadOwnedQuiz(req, res);
      if (!quiz) return;
      const draft = await storage.getQuizDraft(tctx(req), quiz.id);
      if (!draft) return res.status(404).json({ message: "No draft" });
      res.json({ payload: draft.payload, updatedAt: draft.updatedAt });
    } catch (error) {
      captureError(error, { scope: "http.quiz-draft" });
      res.status(500).json({ message: "Failed to load draft" });
    }
  });

  app.put("/api/quizzes/:id/draft", requireAuth, draftLimiter, async (req: any, res) => {
    try {
      const quiz = await loadOwnedQuiz(req, res);
      if (!quiz) return;
      const validation = quizDraftSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid draft payload", errors: validation.error.errors });
      }
      const draft = await storage.upsertQuizDraft(tctx(req), quiz.id, validation.data);
      res.json({ updatedAt: draft.updatedAt });
    } catch (error) {
      captureError(error, { scope: "http.quiz-draft" });
      res.status(500).json({ message: "Failed to save draft" });
    }
  });

  app.delete("/api/quizzes/:id/draft", requireAuth, async (req: any, res) => {
    try {
      const quiz = await loadOwnedQuiz(req, res);
      if (!quiz) return;
      await storage.deleteQuizDraft(tctx(req), quiz.id);
      res.status(204).end();
    } catch (error) {
      captureError(error, { scope: "http.quiz-draft" });
      res.status(500).json({ message: "Failed to discard draft" });
    }
  });
}
```

- [ ] **Step 5: Wire into `server/routes.ts`**

Three edits:

1. Import (next to `import { registerReportRoutes } from "./report-routes";` at line 22):

```ts
import { registerVersionRoutes } from "./version-routes";
```

2. Destructure the limiter (line ~122):

```ts
const { authLimiter, aiLimiter, uploadLimiter, joinLimiter, draftLimiter } = buildRateLimiters();
```

3. Register (next to `registerReportRoutes(app, { storage, requireAuth, tctx });` at line ~695):

```ts
registerVersionRoutes(app, { storage, requireAuth, tctx, draftLimiter });
```

4. Save path (line ~609): change `storage.updateQuiz(` → `storage.updateQuizWithVersion(` in the `PUT /api/quizzes/:id` handler. Do NOT touch its field mapping (theme is intentionally absent today — pre-existing behavior, out of scope). Add a comment above the call:

```ts
// Versioned save: banks the previous row state into quiz_versions, deletes
// any autosave draft, and prunes history — all in one transaction.
```

- [ ] **Step 6: Run the gate**

Run: `npm run check && npm test && npm run build`
Expected: all PASS (new route tests included).

- [ ] **Step 7: Commit**

```bash
git add server/rate-limits.ts server/rate-limits.test.ts server/version-routes.ts server/version-routes.test.ts server/routes.ts
git commit -m "feat(versioning): version/draft routes, draft rate limit, transactional save path"
```

---

### Task 4: Client — `toQuizForm` extraction + autosave hook + status chip

**Files:**
- Create: `client/src/hooks/use-quiz-autosave.ts`
- Modify: `client/src/pages/quiz-editor.tsx` (extract mapping ~lines 109-143; add hook + chip near the Save button ~line 443)
- Modify: `client/src/locales/en.json` + `ar.json` (inside the `"editor"` object)

**Interfaces:**
- Consumes: `apiRequest` (`@/lib/queryClient` — throws on non-ok, attaches `error.response.status`), existing `QuizForm` interface, `blankQuestion`, `resolveQuizTheme`.
- Produces (Tasks 5-6 rely on):
  - `toQuizForm(src: any): QuizForm` — module-level function in `quiz-editor.tsx` mapping any quiz-shaped payload (live quiz, draft payload, version row) to editor state
  - Hook: `useQuizAutosave({ quizId?, storageKey?, enabled, paused, payload, debounceMs? })` → `{ status: AutosaveStatus, savedAt: Date | null, markClean(p: unknown): void }`
  - `newQuizDraftKey(tenantSlug: string, userId: number): string` → `"quizDraft:new:{slug}:{userId}"`
  - i18n keys `editor.autosave.saving|saved|error`

No client test infra exists (repo convention) — verification for client tasks is `npm run check` + `npm test` (the i18n guard `client/src/lib/language.test.ts` runs in `npm test`) + browser QA in Task 8.

- [ ] **Step 1: Extract `toQuizForm` in `quiz-editor.tsx`**

Add above `export default function QuizEditor()` (module level, after `VALIDATION_MSG`):

```ts
// Maps any quiz-shaped payload (live quiz row, draft payload, version row)
// to editor state. Also used by draft-resume and version-restore, so keep it
// tolerant: normalizes legacy single-correct questions and fills defaults.
function toQuizForm(src: any): QuizForm {
  const questions: Question[] = Array.isArray(src?.questions) && src.questions.length
    ? src.questions.map((q: any) => ({
        question: q.question ?? "",
        imageUrl: q.imageUrl,
        type: q.type ?? "quiz",
        answerType: q.answerType ?? "single",
        answers: Array.isArray(q.answers) ? q.answers : ["", "", "", ""],
        // Normalize legacy single-correct → array.
        correctAnswers: Array.isArray(q.correctAnswers)
          ? q.correctAnswers
          : [typeof q.correctAnswer === "number" ? q.correctAnswer : 0],
        timeLimit: q.timeLimit ?? 20,
        points: q.points === "double" ? "double" : "standard",
      }))
    : [blankQuestion()];
  return {
    title: src?.title ?? "",
    description: src?.description ?? "",
    background: src?.background || "aurora",
    isPublic: src?.isPublic ?? true,
    theme: resolveQuizTheme(src ?? {}),
    questions,
  };
}
```

Then replace the body of the hydration effect (lines 109-143) so the inline mapping uses it — the effect keeps its guard and ownership check exactly as-is, only the mapping collapses:

```ts
useEffect(() => {
  if (loaded && isEditMode) {
    if (hydratedQuizRef.current === loaded) return;
    hydratedQuizRef.current = loaded;
    if (user && loaded.createdBy !== user.id) {
      toast({ title: t("editor.toasts.accessDeniedTitle"), description: t("editor.toasts.accessDeniedDescription"), variant: "destructive" });
      setLocation("/my-quizzes");
      return;
    }
    const form = toQuizForm(loaded);
    setQuiz(form);
    setCurrentIndex(0);
  }
}, [loaded, isEditMode, user, setLocation, toast, t]);
```

(Task 5 extends this same effect — markClean + hydrated flag.)

Run: `npm run check` — clean. This is a pure refactor; visually nothing changes.

- [ ] **Step 2: Create the hook**

`client/src/hooks/use-quiz-autosave.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

// localStorage slot for never-saved quizzes (no quiz row to attach a server
// draft to). Tenant slug + user id so shared machines/tenants don't collide.
export function newQuizDraftKey(tenantSlug: string, userId: number): string {
  return `quizDraft:new:${tenantSlug}:${userId}`;
}

interface UseQuizAutosaveOpts {
  quizId?: string;      // set in edit mode → server draft
  storageKey?: string;  // set in create mode → localStorage
  enabled: boolean;     // false until hydration + draft decision resolved
  paused: boolean;      // true while the explicit Save mutation is in flight
  payload: unknown;     // the current QuizForm state
  debounceMs?: number;
}

// Debounced draft autosave. `markClean(p)` declares p as "already persisted /
// nothing to write" — call it after hydration, after resuming a draft, and
// after discarding. A payload serially identical to the last clean/written
// state never triggers a write, so hydration alone NEVER creates a draft
// (draft existence must keep meaning "unsaved changes").
export function useQuizAutosave({ quizId, storageKey, enabled, paused, payload, debounceMs = 2500 }: UseQuizAutosaveOpts) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const lastWrittenRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markClean = (p: unknown) => {
    lastWrittenRef.current = JSON.stringify(p);
    setStatus("idle");
  };

  useEffect(() => {
    if (!enabled || paused) return;
    const serialized = JSON.stringify(payload);
    if (serialized === lastWrittenRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        if (quizId) {
          await apiRequest("PUT", `/api/quizzes/${quizId}/draft`, JSON.parse(serialized));
        } else if (storageKey) {
          localStorage.setItem(storageKey, JSON.stringify({ payload: JSON.parse(serialized), updatedAt: new Date().toISOString() }));
        }
        lastWrittenRef.current = serialized;
        setStatus("saved");
        setSavedAt(new Date());
      } catch {
        // Work is still in editor memory; the next change re-triggers. No toast
        // spam — the chip shows the retry state.
        setStatus("error");
      }
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [payload, enabled, paused, quizId, storageKey, debounceMs]);

  return { status, savedAt, markClean };
}
```

- [ ] **Step 3: Wire hook + chip into `quiz-editor.tsx`**

Imports:

```ts
import { useQuizAutosave, newQuizDraftKey, type AutosaveStatus } from "@/hooks/use-quiz-autosave";
import { useTenant } from "@/lib/tenant";
```

Inside `QuizEditor()`, after the existing state declarations (~line 95):

```ts
const tenant = useTenant();
// Task 5 replaces `true` with the draft-decision gate; until then autosave is
// armed as soon as auth resolves (markClean in hydration keeps it no-op safe).
const [hydrated, setHydrated] = useState(!isEditMode);
const storageKey = !isEditMode && user ? newQuizDraftKey(tenant.slug, user.id) : undefined;
const { status: autosaveStatus, savedAt: autosaveAt, markClean } = useQuizAutosave({
  quizId: isEditMode ? quizId : undefined,
  storageKey,
  enabled: Boolean(isAuthenticated && hydrated),
  paused: saveMutation.isPending,
  payload: quiz,
});
```

NOTE on declaration order: `saveMutation` is declared at ~line 262, *after* this spot. Place the `useQuizAutosave` call **after** the `saveMutation` declaration (between `saveMutation` and `handleSave`) so `saveMutation.isPending` is in scope; keep the `tenant`/`hydrated`/`storageKey` lines with the other state at the top.

In the hydration effect (Step 1's version), after `setCurrentIndex(0);` add:

```ts
markClean(form);
setHydrated(true);
```

In create mode, mark the pristine blank form clean once on mount so an untouched editor never writes a localStorage draft (place after the state declarations):

```ts
const initialCleanRef = useRef(false);
useEffect(() => {
  if (!isEditMode && !initialCleanRef.current) {
    initialCleanRef.current = true;
    markClean(quiz);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

In `saveMutation.onSuccess`, before the navigation, clear the create-mode slot:

```ts
if (!isEditMode && storageKey) localStorage.removeItem(storageKey);
```

Add the chip component at module level (below `toQuizForm`):

```tsx
function AutosaveChip({ status, savedAt }: { status: AutosaveStatus; savedAt: Date | null }) {
  const { t } = useTranslation();
  if (status === "idle") return null;
  return (
    <span className="text-xs text-muted-foreground whitespace-nowrap" aria-live="polite">
      {status === "saving" && t("editor.autosave.saving")}
      {status === "saved" && savedAt &&
        t("editor.autosave.saved", { time: savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}
      {status === "error" && t("editor.autosave.error")}
    </span>
  );
}
```

Render it in the header immediately before the Save `<Button>` (line ~443):

```tsx
<AutosaveChip status={autosaveStatus} savedAt={autosaveAt} />
<Button onClick={handleSave} disabled={saveMutation.isPending}>
```

- [ ] **Step 4: i18n keys**

In `client/src/locales/en.json`, inside the `"editor"` object (sibling of `"topbar"`):

```json
"autosave": {
  "saving": "Saving draft…",
  "saved": "Draft saved {{time}}",
  "error": "Draft not saved — will retry"
}
```

In `client/src/locales/ar.json`, same position:

```json
"autosave": {
  "saving": "جارٍ حفظ المسودة…",
  "saved": "حُفظت المسودة {{time}}",
  "error": "تعذّر حفظ المسودة — ستُعاد المحاولة"
}
```

- [ ] **Step 5: Run the gate**

Run: `npm run check && npm test && npm run build`
Expected: PASS — including `client/src/lib/language.test.ts` (key parity + no untranslated AR).

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/use-quiz-autosave.ts client/src/pages/quiz-editor.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(autosave): debounced draft autosave hook + status chip in quiz editor"
```

---

### Task 5: Client — resume-or-discard draft prompt (server + localStorage)

**Files:**
- Modify: `client/src/pages/quiz-editor.tsx`
- Modify: `client/src/locales/en.json` + `ar.json`

**Interfaces:**
- Consumes (Task 4): `toQuizForm`, `markClean`, `hydrated`/`setHydrated`, `storageKey`. (Task 3): `GET/DELETE /api/quizzes/:id/draft`. UI: `AlertDialog*` from `@/components/ui/alert-dialog` (exists).
- Produces: `draftDecision` state (`"pending" | "none" | "resumed" | "discarded"`) that Task 4's `enabled` gate switches onto; i18n keys `editor.draft.*`.

- [ ] **Step 1: Fetch the server draft (edit mode)**

Below the `loaded` query (~line 108):

```ts
// Draft existence ≡ unsaved changes (deleted transactionally on save), so a
// non-404 here is exactly "show the resume prompt". 404 → null, not an error.
const { data: draft, isFetched: draftFetched } = useQuery<{ payload: any; updatedAt: string } | null>({
  queryKey: ["/api/quizzes", quizId, "draft"],
  enabled: isEditMode && isAuthenticated,
  retry: false,
  queryFn: async () => {
    try {
      const res = await apiRequest("GET", `/api/quizzes/${quizId}/draft`);
      return await res.json();
    } catch (e: any) {
      if (e?.response?.status === 404) return null;
      throw e;
    }
  },
});
```

- [ ] **Step 2: Draft decision state + create-mode localStorage read**

After the autosave hook wiring from Task 4:

```ts
type DraftDecision = "pending" | "none" | "resumed" | "discarded";
const [draftDecision, setDraftDecision] = useState<DraftDecision>("pending");
const [storedDraft, setStoredDraft] = useState<{ payload: any; updatedAt: string } | null>(null);

// Create mode: read the localStorage slot once.
useEffect(() => {
  if (isEditMode || !storageKey) return;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      setStoredDraft(JSON.parse(raw));
      return; // decision stays "pending" until the dialog is answered
    }
  } catch {
    // Corrupt slot — treat as no draft.
    localStorage.removeItem(storageKey);
  }
  setDraftDecision("none");
}, [isEditMode, storageKey]);

// Edit mode: resolve "none" when the fetch settles with no draft. The dialog
// itself only opens once hydration is done, so a Resume can never be
// clobbered by the live-quiz hydration effect.
useEffect(() => {
  if (isEditMode && draftFetched && draft === null) setDraftDecision("none");
}, [isEditMode, draftFetched, draft]);

const pendingDraft = isEditMode ? draft : storedDraft;
const showDraftPrompt = draftDecision === "pending" && hydrated && Boolean(pendingDraft);

const resumeDraft = () => {
  if (pendingDraft?.payload) {
    const form = toQuizForm(pendingDraft.payload);
    setQuiz(form);
    setCurrentIndex(0);
    // Resumed content == the stored draft; no rewrite needed until a real edit.
    markClean(form);
  }
  setDraftDecision("resumed");
};

const discardDraft = async () => {
  try {
    if (isEditMode) await apiRequest("DELETE", `/api/quizzes/${quizId}/draft`);
    else if (storageKey) localStorage.removeItem(storageKey);
  } catch {
    // Non-blocking: worst case the prompt reappears next visit.
  }
  setDraftDecision("discarded");
};
```

- [ ] **Step 3: Gate autosave on the decision**

Change Task 4's `enabled` line on the `useQuizAutosave` call to:

```ts
enabled: Boolean(isAuthenticated && hydrated && draftDecision !== "pending"),
```

(Ordering note: `draftDecision` must be declared before the `useQuizAutosave` call — declare the `DraftDecision` state with the other state at the top; keep the effects near the other effects.)

- [ ] **Step 4: The dialog**

Import:

```ts
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
```

Render next to the other dialogs (~line 450, near `<QuizSettingsDialog …/>`):

```tsx
<AlertDialog open={showDraftPrompt}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{t("editor.draft.resumeTitle")}</AlertDialogTitle>
      <AlertDialogDescription>
        {t("editor.draft.resumeBody", {
          time: pendingDraft?.updatedAt
            ? new Date(pendingDraft.updatedAt).toLocaleString()
            : "",
        })}
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={discardDraft}>{t("editor.draft.discard")}</AlertDialogCancel>
      <AlertDialogAction onClick={resumeDraft}>{t("editor.draft.resume")}</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 5: i18n keys**

`en.json` (`"editor"` object):

```json
"draft": {
  "resumeTitle": "Unsaved changes found",
  "resumeBody": "You have unsaved changes from {{time}}. Resume editing or discard them?",
  "resume": "Resume editing",
  "discard": "Discard draft"
}
```

`ar.json`:

```json
"draft": {
  "resumeTitle": "توجد تغييرات غير محفوظة",
  "resumeBody": "لديك تغييرات غير محفوظة من {{time}}. هل تريد متابعة التحرير أم تجاهلها؟",
  "resume": "متابعة التحرير",
  "discard": "تجاهل المسودة"
}
```

- [ ] **Step 6: Run the gate, commit**

Run: `npm run check && npm test && npm run build` — expected PASS.

```bash
git add client/src/pages/quiz-editor.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(autosave): resume-or-discard draft prompt (server draft + localStorage)"
```

---

### Task 6: Client — version history Sheet (list, preview, restore)

**Files:**
- Create: `client/src/components/quiz/VersionHistorySheet.tsx`
- Modify: `client/src/pages/quiz-editor.tsx` (History button in header + restore handler)
- Modify: `client/src/locales/en.json` + `ar.json`

**Interfaces:**
- Consumes (Task 3): `GET /api/quizzes/:id/versions`, `GET /api/quizzes/:id/versions/:n` (default `getQueryFn` joins array query keys with `/`). (Task 4): `toQuizForm`. UI: `Sheet*` from `@/components/ui/sheet`, `AlertDialog*`, `Badge` from `@/components/ui/badge` (all exist).
- Produces: `<VersionHistorySheet open onOpenChange quizId onRestore />` where `onRestore(version: any)` receives the full version row.

- [ ] **Step 1: Create the component**

`client/src/components/quiz/VersionHistorySheet.tsx`:

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface VersionListItem {
  versionNumber: number;
  title: string;
  questionCount: number;
  createdAt: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quizId: string;
  // Receives the FULL version row; the editor maps it via toQuizForm and marks
  // the form dirty so autosave + a normal Save record the restore.
  onRestore: (version: any) => void;
}

export function VersionHistorySheet({ open, onOpenChange, quizId, onRestore }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { data: versions, isLoading } = useQuery<VersionListItem[]>({
    queryKey: ["/api/quizzes", quizId, "versions"],
    enabled: open,
  });

  const { data: detail, isLoading: detailLoading, isError: detailError } = useQuery<any>({
    queryKey: ["/api/quizzes", quizId, "versions", String(selected)],
    enabled: open && selected != null,
  });

  const close = (o: boolean) => {
    if (!o) {
      setSelected(null);
      setConfirming(false);
    }
    onOpenChange(o);
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("editor.history.title")}</SheetTitle>
        </SheetHeader>

        {isLoading && <Loader2 className="w-5 h-5 mt-6 animate-spin" />}

        {!isLoading && (!versions || versions.length === 0) && (
          <p className="mt-6 text-sm text-muted-foreground">{t("editor.history.empty")}</p>
        )}

        <div className="mt-4 space-y-2">
          {versions?.map((v) => (
            <button
              key={v.versionNumber}
              type="button"
              onClick={() => setSelected(selected === v.versionNumber ? null : v.versionNumber)}
              className={`w-full rounded-lg border p-3 text-start transition-colors hover:bg-accent ${
                selected === v.versionNumber ? "border-primary" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">
                  {t("editor.history.versionLabel", { n: v.versionNumber })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {v.createdAt ? new Date(v.createdAt).toLocaleString() : ""}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground truncate">{v.title}</span>
                <Badge variant="secondary">{t("editor.history.questionCount", { count: v.questionCount })}</Badge>
              </div>
            </button>
          ))}
        </div>

        {selected != null && (
          <div className="mt-4 rounded-lg border p-3">
            {detailLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {detailError && <p className="text-sm text-destructive">{t("editor.history.loadFailed")}</p>}
            {detail && (
              <>
                <p className="font-medium text-sm mb-2">{detail.title}</p>
                <ol className="space-y-1 list-decimal ms-5">
                  {(detail.questions as any[]).map((q, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{q.question || "—"}</span>{" "}
                      <Badge variant="outline" className="ms-1 align-middle">{q.type ?? "quiz"}</Badge>
                    </li>
                  ))}
                </ol>
                <Button className="mt-3 w-full" size="sm" onClick={() => setConfirming(true)}>
                  {t("editor.history.restore")}
                </Button>
              </>
            )}
          </div>
        )}

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("editor.history.restoreConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("editor.history.restoreConfirmBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("editor.history.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirming(false);
                  if (detail) {
                    onRestore(detail);
                    close(false);
                  }
                }}
              >
                {t("editor.history.restore")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Wire into the editor**

In `quiz-editor.tsx`:

```ts
import { VersionHistorySheet } from "@/components/quiz/VersionHistorySheet";
import { History as HistoryIcon } from "lucide-react"; // merge into the existing lucide import
```

State (with the other dialog states, ~line 88):

```ts
const [historyOpen, setHistoryOpen] = useState(false);
```

Restore handler (near `resumeDraft`):

```ts
const restoreVersion = (version: any) => {
  const form = toQuizForm(version);
  setQuiz(form);
  setCurrentIndex(0);
  // Deliberately NOT markClean: the restored content is dirty relative to the
  // live quiz, so autosave drafts it and a normal Save records it as a new
  // version. History is never rewritten.
  toast({ title: t("editor.history.restoredToast", { n: version.versionNumber }) });
};
```

Header button, before the Preview button (~line 440), edit mode only:

```tsx
{isEditMode && (
  <Button variant="outline" onClick={() => setHistoryOpen(true)}>
    <HistoryIcon className="w-4 h-4 me-1" /> {t("editor.history.button")}
  </Button>
)}
```

Render with the other dialogs (~line 450):

```tsx
{isEditMode && quizId && (
  <VersionHistorySheet open={historyOpen} onOpenChange={setHistoryOpen} quizId={quizId} onRestore={restoreVersion} />
)}
```

- [ ] **Step 3: i18n keys**

`en.json` (`"editor"` object):

```json
"history": {
  "button": "History",
  "title": "Version history",
  "empty": "Versions appear after your next save.",
  "versionLabel": "Version {{n}}",
  "questionCount": "{{count}} questions",
  "restore": "Restore",
  "restoreConfirmTitle": "Restore this version?",
  "restoreConfirmBody": "This replaces the editor's current content.",
  "cancel": "Cancel",
  "restoredToast": "Version {{n}} loaded — save to keep it.",
  "loadFailed": "Couldn't load this version."
}
```

`ar.json`:

```json
"history": {
  "button": "سجل النسخ",
  "title": "سجل النسخ",
  "empty": "ستظهر النسخ بعد الحفظ التالي.",
  "versionLabel": "النسخة {{n}}",
  "questionCount": "{{count}} سؤال",
  "restore": "استعادة",
  "restoreConfirmTitle": "هل تريد استعادة هذه النسخة؟",
  "restoreConfirmBody": "سيحل هذا محل المحتوى الحالي في المحرر.",
  "cancel": "إلغاء",
  "restoredToast": "تم تحميل النسخة {{n}} — احفظ للاحتفاظ بها.",
  "loadFailed": "تعذّر تحميل هذه النسخة."
}
```

- [ ] **Step 4: Run the gate, commit**

Run: `npm run check && npm test && npm run build` — expected PASS.

```bash
git add client/src/components/quiz/VersionHistorySheet.tsx client/src/pages/quiz-editor.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(versioning): version history sheet with preview and restore"
```

---

### Task 7: Integration tests (live DB) — versions, drafts, gating, RLS

**Files:**
- Create: `tests/integration/quiz-versioning.test.ts`

**Interfaces:**
- Consumes: `tests/integration/helpers.ts` (`assertServerUp`, `createTestUser`, `createTestQuiz`, `cleanupTestData`, `endPool`), `pool` from `server/db`, all Task 3 routes, the Task 3 save path.

**Prerequisite:** migration 0011 must be applied to the DB the dev server points at, and the dev server must be running (`npm run dev` in another terminal). Apply with:
`psql "$DATABASE_URL" -f migrations/0011_quiz_versioning.sql` — or via the Supabase MCP `apply_migration` (the flow used for 0009/0010). If you cannot apply it, STOP and ask the user rather than skipping.

- [ ] **Step 1: Write the test file**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import {
  assertServerUp, cleanupTestData, createTestQuiz, createTestUser, endPool,
  type TestAgent, type TestQuiz,
} from "./helpers";

// Verifies migration 0011_quiz_versioning.sql + the versioned save path.
// Run AFTER applying:  psql "$DATABASE_URL" -f migrations/0011_quiz_versioning.sql
// then:                npm run integration

const PUT_BODY = (quiz: TestQuiz, title: string) => JSON.stringify({
  title,
  description: "integration test quiz",
  isPublic: quiz.isPublic,
  background: "classroom",
  createdBy: quiz.createdBy,
  questions: quiz.questions,
});

describe("quiz versioning + drafts", () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  let quiz: TestQuiz;

  beforeAll(async () => {
    await assertServerUp();
    owner = await createTestUser("vsnowner");
    other = await createTestUser("vsnother");
    quiz = await createTestQuiz(owner.agent, { title: `${owner.prefix}_quiz` });
  });

  afterAll(async () => {
    await cleanupTestData(owner.prefix);
    await cleanupTestData(other.prefix);
    await endPool();
  });

  it("save banks the PREVIOUS state as version 1 and returns light list metadata", async () => {
    const put = await owner.agent.fetch(`/api/quizzes/${quiz.id}`, {
      method: "PUT", body: PUT_BODY(quiz, `${owner.prefix}_renamed`),
    });
    expect(put.status).toBe(200);

    const list = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].versionNumber).toBe(1);
    expect(list[0].title).toBe(`${owner.prefix}_quiz`);   // previous state
    expect(list[0].questionCount).toBe(3);
    expect(list[0]).not.toHaveProperty("questions");       // list stays light

    const detail = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions/1`)).json();
    expect(detail.title).toBe(`${owner.prefix}_quiz`);
    expect(detail.questions).toHaveLength(3);
    expect(detail.questions[0].correctAnswers).toEqual([2]); // full snapshot, owner-only
  });

  it("draft lifecycle: upsert → get → deleted by save; DELETE idempotent", async () => {
    const put = await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      body: JSON.stringify({ title: "wip", questions: [{ question: "half", answers: ["x"], correctAnswers: [] }] }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).updatedAt).toBeTruthy();

    const got = await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`);
    expect(got.status).toBe(200);
    expect((await got.json()).payload.title).toBe("wip");

    // Explicit save wipes the draft in the same transaction.
    const save = await owner.agent.fetch(`/api/quizzes/${quiz.id}`, {
      method: "PUT", body: PUT_BODY(quiz, `${owner.prefix}_saved2`),
    });
    expect(save.status).toBe(200);
    expect((await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`)).status).toBe(404);

    expect((await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`, { method: "DELETE" })).status).toBe(204);
    expect((await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`, { method: "DELETE" })).status).toBe(204);
  });

  it("draft rejects oversize payloads", async () => {
    const res = await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      body: JSON.stringify({ questions: Array.from({ length: 101 }, () => ({})) }),
    });
    expect(res.status).toBe(400);
  });

  it("non-owner gets 403 on every route; unauthenticated gets 401", async () => {
    const routes: Array<[string, string, string | undefined]> = [
      ["GET", `/api/quizzes/${quiz.id}/versions`, undefined],
      ["GET", `/api/quizzes/${quiz.id}/versions/1`, undefined],
      ["GET", `/api/quizzes/${quiz.id}/draft`, undefined],
      ["PUT", `/api/quizzes/${quiz.id}/draft`, "{}"],
      ["DELETE", `/api/quizzes/${quiz.id}/draft`, undefined],
    ];
    for (const [method, path, body] of routes) {
      const res = await other.agent.fetch(path, { method, body });
      expect(res.status, `${method} ${path}`).toBe(403);
      const anon = await fetch(`${process.env.INTEGRATION_BASE_URL ?? "http://localhost:5000"}${path}`, {
        method, body, headers: { origin: process.env.INTEGRATION_BASE_URL ?? "http://localhost:5000", "content-type": "application/json" },
      });
      expect(anon.status, `anon ${method} ${path}`).toBe(401);
    }
  });

  it("prunes to 20 versions, oldest first", async () => {
    const fresh = await createTestQuiz(owner.agent, { title: `${owner.prefix}_prune` });
    for (let i = 1; i <= 21; i++) {
      const res = await owner.agent.fetch(`/api/quizzes/${fresh.id}`, {
        method: "PUT", body: PUT_BODY(fresh, `${owner.prefix}_prune_${i}`),
      });
      expect(res.status).toBe(200);
    }
    const list = await (await owner.agent.fetch(`/api/quizzes/${fresh.id}/versions`)).json();
    expect(list).toHaveLength(20);
    expect(list[0].versionNumber).toBe(21);
    expect(list[19].versionNumber).toBe(2);
    expect((await owner.agent.fetch(`/api/quizzes/${fresh.id}/versions/1`)).status).toBe(404);
  });

  it("restore-then-save yields a NEW version; prior versions unchanged", async () => {
    const v = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions/1`)).json();
    const before = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions`)).json();
    const res = await owner.agent.fetch(`/api/quizzes/${quiz.id}`, {
      method: "PUT",
      body: JSON.stringify({
        title: v.title, description: v.description ?? "", isPublic: v.isPublic ?? true,
        background: v.background ?? "classroom", createdBy: quiz.createdBy, questions: v.questions,
      }),
    });
    expect(res.status).toBe(200);
    const after = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions`)).json();
    expect(after.length).toBe(before.length + 1);
    // Version 1 still holds the original state.
    const v1 = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions/1`)).json();
    expect(v1.title).toBe(v.title);
  });

  it("RLS: another tenant's GUC sees zero version/draft rows", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Tenant 999999 does not exist — with RLS forced, both tables must be empty.
      await client.query("select set_config('app.tenant_id', '999999', true)");
      const versions = await client.query("select count(*)::int as n from quiz_versions where quiz_id = $1", [quiz.id]);
      const drafts = await client.query("select count(*)::int as n from quiz_drafts where quiz_id = $1", [quiz.id]);
      expect(versions.rows[0].n).toBe(0);
      expect(drafts.rows[0].n).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});
```

Cleanup note: `cleanupTestData`/`runSystemDeletes` in `tests/integration/helpers.ts` deletes quizzes by owner — `quiz_versions`/`quiz_drafts` rows FK-reference quizzes, so the helper's quiz delete will fail on the FK unless versions/drafts are removed first. **Update `runSystemDeletes` in `tests/integration/helpers.ts`**: before the `DELETE FROM quizzes …` statements, add:

```ts
await client.query(
  `DELETE FROM quiz_versions WHERE quiz_id IN (
     SELECT id FROM quizzes WHERE created_by IN (SELECT id FROM users WHERE username LIKE $1 ESCAPE '\\')
        OR title LIKE $1 ESCAPE '\\'
   )`,
  [like],
);
await client.query(
  `DELETE FROM quiz_drafts WHERE quiz_id IN (
     SELECT id FROM quizzes WHERE created_by IN (SELECT id FROM users WHERE username LIKE $1 ESCAPE '\\')
        OR title LIKE $1 ESCAPE '\\'
   )`,
  [like],
);
```

- [ ] **Step 2: Apply migration 0011 to the DB** (see Prerequisite above). Verify:

```
psql "$DATABASE_URL" -c "select set_config('app.role','system',false); select count(*) from quiz_versions;"
```
Expected: `0` (fresh tables).

- [ ] **Step 3: Run the suite**

Start the dev server (`npm run dev`) in another terminal if not running, then:

Run: `npm run integration`
Expected: ALL integration tests pass — the new file's 7 tests plus the pre-existing suite (currently 27 pass / 1 skip; total grows by 7). If pre-existing tests fail, STOP — the save-path change may have broken an expectation; investigate before proceeding.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/quiz-versioning.test.ts tests/integration/helpers.ts
git commit -m "test(versioning): integration coverage — versions, drafts, gating, prune, RLS"
```

---

### Task 8: Final gate + browser QA checklist

**Files:** none created — verification only. (Fixes discovered here get their own commits.)

- [ ] **Step 1: Full gate on the branch**

Run: `npm run check && npm test && npm run build`
Expected: typecheck clean, all unit tests pass, build OK.

- [ ] **Step 2: Browser QA** (dev server + real browser, EN then AR):

1. Edit a quiz, type a change → chip shows "Saving draft…" then "Draft saved HH:MM" (~2.5s after last keystroke).
2. Kill the tab without saving → reopen the editor → resume prompt appears; **Resume** restores the exact edits; make no further change → no new draft write (chip stays idle).
3. Reopen again → **Discard** → prompt gone on next open; editor shows the live quiz.
4. Explicit Save → draft gone (no prompt on reopen); History shows a new version whose content is the PRE-save state.
5. History: list order newest-first, preview renders question list, Restore replaces editor content + toast, then Save → new version appears.
6. Create mode (`/create-quiz`): type, kill tab, reopen → localStorage resume prompt; Save → slot cleared.
7. AR/RTL: switch language — chip, prompt, Sheet render RTL with Arabic strings; history Sheet opens from the correct side.
8. Zero console errors throughout.

- [ ] **Step 3: Hand off**

Implementation complete → use superpowers:finishing-a-development-branch (PR to `main`; ship-time steps: migration 0011 to Supabase prod is already applied if Task 7 ran against it — confirm; browser QA evidence in the PR description).

---

## Self-review notes (already applied)

- Spec §4.2 said "insights' exact 403 message"; the routes use the PUT-edit message ("You can only edit your own quizzes") because these are edit surfaces and the PUT handler is the semantics being extended. Deliberate, documented here.
- Spec §5.1 localStorage key used `{tenantId}`; the client only knows the tenant **slug** (`/api/tenant/config` doesn't expose the id), so the key is `quizDraft:new:{slug}:{userId}`.
- `theme` is intentionally NOT added to the PUT field mapping (pre-existing gap, out of scope); versions snapshot whatever the row holds, so history fidelity is unaffected.
- Hydration-effect gotcha honored: `toQuizForm` refactor keeps the `hydratedQuizRef` once-per-payload guard; autosave's `markClean` + serialized-compare guarantees hydration alone never creates a draft.
