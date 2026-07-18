# Question Bank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-tenant library of reusable questions (create/curate with subject+tags, copy into any quiz with provenance), per `docs/superpowers/specs/2026-07-18-question-bank-design.md`.

**Architecture:** New additive `bank_questions` table (tenant_id + RLS pair, migration 0009) storing the canonical `questionSchema` JSON. Copy+provenance model: adding a bank question to a quiz copies JSON into the quiz's inline `questions` jsonb and stamps `sourceQuestionId` — gameplay is untouched. Server: storage methods on both `MemStorage`/`DatabaseStorage` + a new `server/bank-routes.ts` module with injected deps (so routes are unit-testable with MemStorage). Client: shared question-editing logic extracted to pure helpers, a compact `QuestionForm` for dialogs, a `/question-bank` page, and save-to-bank / add-from-bank in the editor.

**Tech Stack:** Drizzle ORM + hand-written SQL migration, Zod, Express, node:test (unit) + Vitest (integration), React 18 + TanStack Query + wouter + react-i18next, shadcn ui primitives.

**Spec deviation (approved rationale):** The spec's "extract the editor's per-question form UI into a shared `QuestionForm`" is refined: the editor's question UI is a full-canvas *stage* (center stage + right panel tied to editor layout/theme state) — literally moving that JSX into a dialog would be high-risk and visually wrong. Instead we extract the shared **logic** (`client/src/lib/question-form-utils.ts`: factories, mutators, validation — single source of truth used by both surfaces) and build a compact dialog-friendly `QuestionForm` component for the bank. The editor's stage JSX stays put and adopts the shared helpers behavior-preservingly.

## Global Constraints

- New table MUST have `tenant_id` + the `tenant_isolation` RLS policy pair, `ENABLE` + `FORCE` row level security, and explicit `quiz_app` grants (CLAUDE.md hard rule; copy migration 0006's template).
- Never call storage methods without a `StorageCtx`; request paths use `tctx(req)`; NO `SYSTEM_CTX` anywhere in this feature.
- All bank endpoints behind `requireAuth`. Bank data is never public.
- Gameplay untouched: no changes to `server/game-room-manager.ts`, `server/websocket.ts`, `shared/ws-protocol.ts`, or scoring.
- The only shared-schema change to existing types: optional `sourceQuestionId` on the question object schema.
- All new client strings in BOTH `client/src/locales/en.json` and `client/src/locales/ar.json` (the en↔ar parity test fails otherwise).
- Run `npm run check && npm test && npm run build` before EVERY commit.
- One phase per PR; never auto-merge; 3 PRs: foundation → bank page → editor integration.
- Windows/PowerShell environment; git Bash tool available. Repo root: `C:\projects\PDO Quiz\Abraj_Quiz`.

---

# PR 1 — Foundation (branch `feat/question-bank-foundation`)

### Task 1: Shared schema — table, provenance field, insert schema, tag normalization

**Files:**
- Modify: `shared/schema.ts` (table def near line 142 after `gameResponses`; question field near line 242; new schemas near line 203)
- Test: `shared/schema.test.ts` (append)

**Interfaces:**
- Produces: `bankQuestions` (Drizzle table), `BankQuestion`, `InsertBankQuestion`, `insertBankQuestionSchema`, `normalizeTags(tags: string[]): string[]`, and `sourceQuestionId?: number` on `Question`. Later tasks import all of these from `@shared/schema`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/question-bank-foundation
```

- [ ] **Step 2: Write the failing tests** — append to `shared/schema.test.ts`:

```ts
test("questionSchema round-trips sourceQuestionId (provenance survives Zod)", () => {
  const q = {
    question: "Q?",
    type: "quiz",
    answerType: "single",
    answers: ["a", "b"],
    correctAnswers: [0],
    timeLimit: 20,
    points: "standard",
    sourceQuestionId: 42,
  };
  const parsed = questionSchema.parse(q) as any;
  assert.equal(parsed.sourceQuestionId, 42);
  // And absent stays absent (not null / not 0).
  const { sourceQuestionId: _omit, ...bare } = q;
  assert.equal((questionSchema.parse(bare) as any).sourceQuestionId, undefined);
});

test("normalizeTags trims, drops empties, collapses case-insensitive duplicates keeping first casing", () => {
  assert.deepEqual(normalizeTags([" Safety ", "safety", "", "  ", "HR", "hr", "Fire"]), ["Safety", "HR", "Fire"]);
});

test("insertBankQuestionSchema: valid payload, tag caps, poll-with-correct rejected", () => {
  const question = {
    question: "Q?", type: "quiz", answerType: "single",
    answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard",
  };
  const ok = insertBankQuestionSchema.parse({ question, subject: " Safety ", tags: ["fire", "Fire", " hr "] });
  assert.equal(ok.subject, "Safety");
  assert.deepEqual(ok.tags, ["fire", "hr"]);
  // defaults
  const min = insertBankQuestionSchema.parse({ question });
  assert.equal(min.subject, undefined);
  assert.deepEqual(min.tags, []);
  // > 20 tags rejected
  assert.throws(() => insertBankQuestionSchema.parse({ question, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }));
  // tag longer than 50 chars rejected
  assert.throws(() => insertBankQuestionSchema.parse({ question, tags: ["x".repeat(51)] }));
  // poll with correctAnswers rejected (questionSchema reuse)
  assert.throws(() => insertBankQuestionSchema.parse({ question: { ...question, type: "poll" } }));
});
```

Also extend the existing import line at the top of `shared/schema.test.ts` to include the new exports:

```ts
import { questionSchema, quizQuestionsSchema, insertQuizSchema, insertBankQuestionSchema, normalizeTags } from "./schema";
```

(Open the file first and merge with whatever it currently imports — keep existing names.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `insertBankQuestionSchema`/`normalizeTags` not exported.

- [ ] **Step 4: Implement in `shared/schema.ts`**

(a) Add `sourceQuestionId` inside `questionObjectSchema` (after the `points` field, before the closing `})` of the object at ~line 243):

```ts
    // Provenance: id of the bank_questions row this question was copied from
    // ("add from bank"). Optional, additive, ignored by gameplay/scoring.
    // Must be an explicit field — Zod strips unknown keys on parse.
    sourceQuestionId: z.number().int().positive().optional(),
```

(b) Add the table after the `gameResponses` table (~line 142):

```ts
// Per-tenant reusable question library ("Question Bank"). `question` holds the
// SAME canonical shape as quizzes.questions entries (validated by
// questionSchema), so copying bank → quiz is a structural copy. Soft delete
// mirrors quizzes.deleted_at: archived rows leave listings/picker but stay
// resolvable so quiz provenance (sourceQuestionId) never dangles.
export const bankQuestions = pgTable(
  "bank_questions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    createdBy: integer("created_by").notNull(), // users.id — attribution only, not an edit gate
    question: jsonb("question").notNull(),
    subject: text("subject"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [index("bank_questions_tenant_idx").on(t.tenantId)],
);
```

(c) Add normalization + insert schema + types after `insertGameResponseSchema` (~line 204):

```ts
// Tag hygiene: trim, drop empties, collapse case-insensitive duplicates
// (first casing wins). Applied by insertBankQuestionSchema so both storage
// implementations always see normalized tags.
export function normalizeTags(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of tags) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  }
  return Array.from(seen.values());
}

export const insertBankQuestionSchema = z.object({
  question: questionSchema,
  subject: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((s) => (s ? s : undefined)),
  tags: z.array(z.string().max(50)).max(20).default([]).transform(normalizeTags),
});
```

NOTE: `questionSchema` is declared LOWER in the file (~line 291) than line 204 — so place this block AFTER the `questionSchema` declaration instead (directly below `export const quizQuestionsSchema = ...` at ~line 293). Zod schemas are consts; order matters.

(d) Add types at the bottom with the other type exports:

```ts
export type BankQuestion = typeof bankQuestions.$inferSelect;
export type InsertBankQuestion = z.infer<typeof insertBankQuestionSchema>;
```

(e) `index` is already imported from `drizzle-orm/pg-core` at line 1 — verify; if not, add it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run check && npm test`
Expected: tsc clean; all tests PASS including the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts shared/schema.test.ts
git commit -m "feat(bank): bank_questions table schema, insertBankQuestionSchema, sourceQuestionId provenance field"
```

---

### Task 2: Migration 0009 + integration test

**Files:**
- Create: `migrations/0009_question_bank.sql`
- Create: `tests/integration/bank-questions-migration.test.ts`

**Interfaces:**
- Produces: the `public.bank_questions` table in Postgres. No code interfaces.

- [ ] **Step 1: Write `migrations/0009_question_bank.sql`** (0006 template; no backfill needed — table starts empty, so no system-context `set_config` dance):

```sql
-- 0009_question_bank.sql — per-tenant reusable question library ("Question Bank").
--
-- `question` holds the canonical question JSON (shared/schema.ts questionSchema)
-- — the same shape quizzes.questions entries use, so bank → quiz is a copy.
-- Soft delete mirrors quizzes.deleted_at (0008).
--
-- ORDERING: run as the migration owner (Supabase `postgres`) AFTER 0003_rls.sql
-- and 0005_quiz_app_role.sql. Idempotent — safe to re-run.
begin;

create table if not exists public.bank_questions (
  id          serial primary key,
  tenant_id   integer not null references public.tenants(id),
  created_by  integer not null,
  question    jsonb   not null,
  subject     text,
  tags        jsonb   not null default '[]'::jsonb,
  deleted_at  timestamptz,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Listing is always tenant-scoped; subject filter rides the composite.
create index if not exists bank_questions_tenant_idx
  on public.bank_questions (tenant_id);
create index if not exists bank_questions_tenant_subject_idx
  on public.bank_questions (tenant_id, subject);
-- Tag containment filtering (tags @> '["x"]').
create index if not exists bank_questions_tags_gin
  on public.bank_questions using gin (tags);

-- Tenant isolation (CLAUDE.md hard rule: every business table gets tenant_id +
-- the tenant_isolation policy pair). FORCE so the owner is subject too and the
-- quiz_app role cannot bypass it.
alter table public.bank_questions enable row level security;
alter table public.bank_questions force row level security;
drop policy if exists tenant_isolation on public.bank_questions;
create policy tenant_isolation on public.bank_questions
  using (public.is_system_context() or tenant_id = public.current_tenant_id())
  with check (public.is_system_context() or tenant_id = public.current_tenant_id());

-- Explicit grants for the application role. 0005's ALTER DEFAULT PRIVILEGES
-- already covers tables created by the same owner, but grant here too so this
-- migration is correct even if a different owner runs it.
grant select, insert, update, delete on public.bank_questions to quiz_app;
grant usage, select on sequence public.bank_questions_id_seq to quiz_app;

commit;

-- VERIFY (run in system context — see 0003 header):
--   select set_config('app.role','system',false);
--   select count(*) from bank_questions;   -- 0 on a fresh install
```

- [ ] **Step 2: Write `tests/integration/bank-questions-migration.test.ts`** (mirrors `tests/integration/migration.test.ts`; schema/policy assertions only — NO data inserts, this may run against prod):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { endPool } from "./helpers";

// Verifies migration 0009_question_bank.sql produced the schema and security
// invariants it promises. Run AFTER applying the migration:
//   psql "$DATABASE_URL" -f migrations/0009_question_bank.sql   (as admin/owner)
// then:  npm run integration

async function sys<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.role', 'system', true)");
    const res = await client.query(sql, params);
    await client.query("commit");
    return res.rows as T[];
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

describe("migration 0009_question_bank — schema, RLS, grants", () => {
  beforeAll(async () => {
    const [{ present }] = await sys<{ present: boolean }>(
      `select to_regclass('public.bank_questions') is not null as present`,
    );
    if (!present) {
      throw new Error(
        "bank_questions table not found. Apply migrations/0009_question_bank.sql before running this test.",
      );
    }
  });

  afterAll(async () => {
    await endPool();
  });

  it("has the expected columns", async () => {
    const cols = await sys<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'bank_questions'`,
    );
    const names = cols.map((c) => c.column_name);
    for (const required of ["id", "tenant_id", "created_by", "question", "subject", "tags", "deleted_at", "created_at", "updated_at"]) {
      expect(names).toContain(required);
    }
  });

  it("enforces FORCE ROW LEVEL SECURITY with a tenant_isolation policy", async () => {
    const [rel] = await sys<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relrowsecurity, relforcerowsecurity
       from pg_class where oid = 'public.bank_questions'::regclass`,
    );
    expect(rel.relrowsecurity).toBe(true);
    expect(rel.relforcerowsecurity).toBe(true);

    const policies = await sys<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'bank_questions'`,
    );
    expect(policies.map((p) => p.policyname)).toContain("tenant_isolation");
  });

  it("tenant_isolation policy expression matches the quizzes policy (same isolation semantics)", async () => {
    const rows = await sys<{ tablename: string; qual: string }>(
      `select tablename, qual from pg_policies
       where schemaname = 'public' and policyname = 'tenant_isolation'
         and tablename in ('quizzes', 'bank_questions')`,
    );
    const byTable = Object.fromEntries(rows.map((r) => [r.tablename, r.qual]));
    expect(byTable.bank_questions).toBeDefined();
    expect(byTable.bank_questions).toBe(byTable.quizzes);
  });

  it("has the tag GIN index and quiz_app grants", async () => {
    const idx = await sys<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'bank_questions'`,
    );
    expect(idx.map((i) => i.indexname)).toContain("bank_questions_tags_gin");

    const grants = await sys<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'bank_questions' and grantee = 'quiz_app'`,
    );
    const privs = grants.map((g) => g.privilege_type);
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(privs).toContain(p);
  });
});
```

- [ ] **Step 3: Verify the unit suite still passes** (the integration test needs a migrated DB — it runs in CI / manually via `npm run integration` after the migration is applied; do NOT apply the migration to prod as part of this task)

Run: `npm run check && npm test`
Expected: PASS (integration file is NOT in the unit glob).

- [ ] **Step 4: Commit**

```bash
git add migrations/0009_question_bank.sql tests/integration/bank-questions-migration.test.ts
git commit -m "feat(bank): migration 0009 bank_questions (RLS pair + FORCE + quiz_app grants) + integration test"
```

---

### Task 3: Storage — IStorage contract + MemStorage implementation (TDD)

**Files:**
- Modify: `server/storage.ts` (interface ~line 124 after quiz methods; MemStorage class; also `tenantFilter`'s column union type at line 103)
- Test: `server/storage.test.ts` (append)

**Interfaces:**
- Consumes: `bankQuestions`, `BankQuestion`, `InsertBankQuestion` from `@shared/schema` (Task 1).
- Produces (on `IStorage`; Task 4 implements the same on `DatabaseStorage`, Task 5 calls them):

```ts
export interface BankQuestionFilters {
  search?: string;      // case-insensitive substring on question text
  subject?: string;     // exact match (values come from getBankSubjectsAndTags)
  tags?: string[];      // row must contain ALL of these (exact strings)
  archived?: boolean;   // true → archived-only; false/undefined → live-only (mirrors getUserQuizzes)
}

getBankQuestions(ctx: StorageCtx, filters?: BankQuestionFilters): Promise<BankQuestion[]>;    // newest-updated first
getBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined>;
createBankQuestion(ctx: StorageCtx, data: InsertBankQuestion & { createdBy: number }): Promise<BankQuestion>;
updateBankQuestion(ctx: StorageCtx, id: number, updates: Partial<InsertBankQuestion>): Promise<BankQuestion | undefined>;
archiveBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined>;
restoreBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined>;
getBankSubjectsAndTags(ctx: StorageCtx): Promise<{ subjects: string[]; tags: string[] }>;     // distinct, live rows only
```

(Note: filter semantics `archived` — the spec draft said `includeArchived`; we match the existing `getUserQuizzes` archived-only semantics the UI toggle actually needs.)

- [ ] **Step 1: Write the failing tests** — append to `server/storage.test.ts`:

```ts
const BANK_Q = {
  question: "What is the boiling point of water?",
  type: "quiz" as const,
  answerType: "single" as const,
  answers: ["90C", "100C"],
  correctAnswers: [1],
  timeLimit: 20,
  points: "standard" as const,
};

test("bank questions: CRUD, tenant isolation, archive/restore", async () => {
  const s = new MemStorage();
  const created = await s.createBankQuestion(T1, { question: BANK_Q, subject: "Science", tags: ["water"], createdBy: 1 });
  assert.equal(created.tenantId, 1);
  assert.equal(created.createdBy, 1);
  assert.equal(created.subject, "Science");
  assert.equal(created.deletedAt, null);

  // Tenant isolation on read.
  assert.equal(await s.getBankQuestion(T2, created.id), undefined);
  assert.equal((await s.getBankQuestion(T1, created.id))?.id, created.id);
  assert.equal((await s.getBankQuestions(T2)).length, 0);

  // Update stamps updatedAt and merges fields.
  const before = created.updatedAt!.getTime();
  await new Promise((r) => setTimeout(r, 5));
  const updated = await s.updateBankQuestion(T1, created.id, { subject: "Physics" });
  assert.equal(updated?.subject, "Physics");
  assert.ok(updated!.updatedAt!.getTime() >= before);
  // Cross-tenant update refused.
  assert.equal(await s.updateBankQuestion(T2, created.id, { subject: "X" }), undefined);

  // Archive: leaves listings, stays resolvable by id, restore reverses.
  await s.archiveBankQuestion(T1, created.id);
  assert.equal((await s.getBankQuestions(T1)).length, 0);
  assert.equal((await s.getBankQuestions(T1, { archived: true })).length, 1);
  assert.ok((await s.getBankQuestion(T1, created.id))?.deletedAt);
  await s.restoreBankQuestion(T1, created.id);
  assert.equal((await s.getBankQuestions(T1)).length, 1);
});

test("bank questions: search / subject / tags filters and newest-updated ordering", async () => {
  const s = new MemStorage();
  const a = await s.createBankQuestion(T1, { question: { ...BANK_Q, question: "Fire extinguisher types?" }, subject: "Safety", tags: ["fire", "ppe"], createdBy: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const b = await s.createBankQuestion(T1, { question: { ...BANK_Q, question: "Boiling point of water?" }, subject: "Science", tags: ["water"], createdBy: 1 });

  // Default order: newest updated first.
  assert.deepEqual((await s.getBankQuestions(T1)).map((r) => r.id), [b.id, a.id]);
  // Search is case-insensitive substring over question text.
  assert.deepEqual((await s.getBankQuestions(T1, { search: "FIRE" })).map((r) => r.id), [a.id]);
  // Subject exact match.
  assert.deepEqual((await s.getBankQuestions(T1, { subject: "Science" })).map((r) => r.id), [b.id]);
  // Tags: row must contain ALL requested tags.
  assert.deepEqual((await s.getBankQuestions(T1, { tags: ["fire", "ppe"] })).map((r) => r.id), [a.id]);
  assert.equal((await s.getBankQuestions(T1, { tags: ["fire", "water"] })).length, 0);
});

test("getBankSubjectsAndTags: distinct over live rows only, tenant-scoped", async () => {
  const s = new MemStorage();
  await s.createBankQuestion(T1, { question: BANK_Q, subject: "Safety", tags: ["fire", "ppe"], createdBy: 1 });
  const dead = await s.createBankQuestion(T1, { question: BANK_Q, subject: "Ghost", tags: ["ghost"], createdBy: 1 });
  await s.archiveBankQuestion(T1, dead.id);
  await s.createBankQuestion(T1, { question: BANK_Q, subject: "Safety", tags: ["fire"], createdBy: 1 });
  await s.createBankQuestion(T2, { question: BANK_Q, subject: "OtherTenant", tags: ["other"], createdBy: 9 });

  const meta = await s.getBankSubjectsAndTags(T1);
  assert.deepEqual(meta.subjects.sort(), ["Safety"]);
  assert.deepEqual(meta.tags.sort(), ["fire", "ppe"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `createBankQuestion` is not a function.

- [ ] **Step 3: Implement**

(a) In `server/storage.ts` imports, add `bankQuestions`, `type BankQuestion`, `type InsertBankQuestion` to the existing `@shared/schema` import.

(b) Add `BankQuestionFilters` export and the 7 method signatures to `IStorage` (after `getQuizInsights`, ~line 124) — exactly as in the Interfaces block above.

(c) Extend `tenantFilter`'s column union (line 103) with `| typeof bankQuestions.tenantId`.

(d) MemStorage: add to the class fields/constructor:

```ts
private bankQuestions: Map<number, BankQuestion>;
private currentBankQuestionId: number;
// in constructor:
this.bankQuestions = new Map();
this.currentBankQuestionId = 1;
```

(e) MemStorage methods (place after `restoreQuiz`):

```ts
// Bank questions
async getBankQuestions(ctx: StorageCtx, filters?: BankQuestionFilters): Promise<BankQuestion[]> {
  const search = filters?.search?.trim().toLowerCase();
  return Array.from(this.bankQuestions.values())
    .filter((row) => this.inTenant(ctx, row))
    .filter((row) => (filters?.archived ? !!row.deletedAt : !row.deletedAt))
    .filter((row) => !filters?.subject || row.subject === filters.subject)
    .filter((row) => !filters?.tags?.length || filters.tags.every((t) => (row.tags as string[]).includes(t)))
    .filter((row) => !search || String((row.question as any)?.question ?? "").toLowerCase().includes(search))
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0) || b.id - a.id);
}

async getBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
  const row = this.bankQuestions.get(id);
  return row && this.inTenant(ctx, row) ? row : undefined;
}

async createBankQuestion(ctx: StorageCtx, data: InsertBankQuestion & { createdBy: number }): Promise<BankQuestion> {
  const id = this.currentBankQuestionId++;
  const now = new Date();
  const row: BankQuestion = {
    id,
    tenantId: requireTenantId(ctx),
    createdBy: data.createdBy,
    question: data.question,
    subject: data.subject ?? null,
    tags: data.tags ?? [],
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  this.bankQuestions.set(id, row);
  return row;
}

async updateBankQuestion(ctx: StorageCtx, id: number, updates: Partial<InsertBankQuestion>): Promise<BankQuestion | undefined> {
  const existing = this.bankQuestions.get(id);
  if (!existing || !this.inTenant(ctx, existing)) return undefined;
  const updated: BankQuestion = {
    ...existing,
    ...(updates.question !== undefined ? { question: updates.question } : {}),
    ...(updates.subject !== undefined ? { subject: updates.subject ?? null } : {}),
    ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
    updatedAt: new Date(),
  };
  this.bankQuestions.set(id, updated);
  return updated;
}

async archiveBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
  const existing = this.bankQuestions.get(id);
  if (!existing || !this.inTenant(ctx, existing)) return undefined;
  const updated: BankQuestion = { ...existing, deletedAt: new Date(), updatedAt: new Date() };
  this.bankQuestions.set(id, updated);
  return updated;
}

async restoreBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
  const existing = this.bankQuestions.get(id);
  if (!existing || !this.inTenant(ctx, existing)) return undefined;
  const updated: BankQuestion = { ...existing, deletedAt: null, updatedAt: new Date() };
  this.bankQuestions.set(id, updated);
  return updated;
}

async getBankSubjectsAndTags(ctx: StorageCtx): Promise<{ subjects: string[]; tags: string[] }> {
  const live = await this.getBankQuestions(ctx);
  const subjects = new Set<string>();
  const tags = new Set<string>();
  for (const row of live) {
    if (row.subject) subjects.add(row.subject);
    for (const t of (row.tags as string[]) ?? []) tags.add(t);
  }
  return { subjects: Array.from(subjects), tags: Array.from(tags) };
}
```

NOTE: `DatabaseStorage` also implements `IStorage` — until Task 4 lands, `npm run check` fails on it. Task 4 is committed together with this task's interface change in the same PR; to keep each commit green, do Task 3 and Task 4 in ONE commit at Task 4's Step 4 (skip the commit here).

- [ ] **Step 4: Run the new tests only (typecheck will fail until Task 4 — expected)**

Run: `npm test`
Expected: the 3 new bank tests PASS (node:test does not typecheck DatabaseStorage; `npm run check` still fails — that's Task 4's exit gate).

---

### Task 4: Storage — DatabaseStorage implementation

**Files:**
- Modify: `server/storage.ts` (DatabaseStorage class, after `restoreQuiz` ~line 277)

**Interfaces:**
- Consumes/Produces: the exact `IStorage` bank methods from Task 3 — same signatures, same observable behavior (filters, ordering, archived semantics).

- [ ] **Step 1: Implement in `DatabaseStorage`** (after `restoreQuiz`; `desc` and `isNotNull` are already imported from drizzle-orm for other methods — verify the import line and add if missing):

```ts
// Bank questions
async getBankQuestions(ctx: StorageCtx, filters?: BankQuestionFilters): Promise<BankQuestion[]> {
  return withCtx(ctx, async (tx) => {
    const conds: (SQL | undefined)[] = [
      tenantFilter(ctx, bankQuestions.tenantId),
      filters?.archived ? isNotNull(bankQuestions.deletedAt) : isNull(bankQuestions.deletedAt),
    ];
    if (filters?.subject) conds.push(eq(bankQuestions.subject, filters.subject));
    if (filters?.tags?.length) {
      // Row must contain ALL requested tags (jsonb containment; GIN-indexed).
      conds.push(sql`${bankQuestions.tags} @> ${JSON.stringify(filters.tags)}::jsonb`);
    }
    const search = filters?.search?.trim();
    if (search) {
      conds.push(sql`${bankQuestions.question}->>'question' ilike ${"%" + search + "%"}`);
    }
    return tx.select().from(bankQuestions)
      .where(and(...conds))
      .orderBy(desc(bankQuestions.updatedAt), desc(bankQuestions.id));
  });
}

async getBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
  return withCtx(ctx, async (tx) => {
    const [row] = await tx.select().from(bankQuestions)
      .where(and(eq(bankQuestions.id, id), tenantFilter(ctx, bankQuestions.tenantId)));
    return row || undefined;
  });
}

async createBankQuestion(ctx: StorageCtx, data: InsertBankQuestion & { createdBy: number }): Promise<BankQuestion> {
  const tenantId = requireTenantId(ctx);
  return withCtx(ctx, async (tx) => {
    const [row] = await tx.insert(bankQuestions).values({
      tenantId,
      createdBy: data.createdBy,
      question: data.question,
      subject: data.subject ?? null,
      tags: data.tags ?? [],
    }).returning();
    return row;
  });
}

async updateBankQuestion(ctx: StorageCtx, id: number, updates: Partial<InsertBankQuestion>): Promise<BankQuestion | undefined> {
  return withCtx(ctx, async (tx) => {
    const [row] = await tx.update(bankQuestions).set({
      ...(updates.question !== undefined ? { question: updates.question } : {}),
      ...(updates.subject !== undefined ? { subject: updates.subject ?? null } : {}),
      ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
      updatedAt: sql`now()`,
    })
      .where(and(eq(bankQuestions.id, id), tenantFilter(ctx, bankQuestions.tenantId)))
      .returning();
    return row || undefined;
  });
}

async archiveBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
  return withCtx(ctx, async (tx) => {
    const [row] = await tx.update(bankQuestions).set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(bankQuestions.id, id), tenantFilter(ctx, bankQuestions.tenantId)))
      .returning();
    return row || undefined;
  });
}

async restoreBankQuestion(ctx: StorageCtx, id: number): Promise<BankQuestion | undefined> {
  return withCtx(ctx, async (tx) => {
    const [row] = await tx.update(bankQuestions).set({ deletedAt: null, updatedAt: sql`now()` })
      .where(and(eq(bankQuestions.id, id), tenantFilter(ctx, bankQuestions.tenantId)))
      .returning();
    return row || undefined;
  });
}

async getBankSubjectsAndTags(ctx: StorageCtx): Promise<{ subjects: string[]; tags: string[] }> {
  return withCtx(ctx, async (tx) => {
    // One narrow scan of live rows; dedupe in JS so semantics are identical
    // to MemStorage. Bank sizes are small; revisit if that changes.
    const rows = await tx.select({ subject: bankQuestions.subject, tags: bankQuestions.tags })
      .from(bankQuestions)
      .where(and(isNull(bankQuestions.deletedAt), tenantFilter(ctx, bankQuestions.tenantId)));
    const subjects = new Set<string>();
    const tags = new Set<string>();
    for (const row of rows) {
      if (row.subject) subjects.add(row.subject);
      for (const t of (row.tags as string[]) ?? []) tags.add(t);
    }
    return { subjects: Array.from(subjects), tags: Array.from(tags) };
  });
}
```

- [ ] **Step 2: Typecheck + full unit suite**

Run: `npm run check && npm test`
Expected: tsc clean (both classes satisfy `IStorage`); all tests PASS.

- [ ] **Step 3: Commit (Tasks 3+4 together — one green commit)**

```bash
git add server/storage.ts server/storage.test.ts
git commit -m "feat(bank): storage layer — IStorage bank methods on MemStorage + DatabaseStorage, filters + meta"
```

---

### Task 5: API routes — `server/bank-routes.ts` with injected deps (TDD over HTTP)

**Files:**
- Create: `server/bank-routes.ts`
- Modify: `server/routes.ts` (import + one call after the quiz routes, ~line 671 after the restore route)
- Test: `server/bank-routes.test.ts`

**Interfaces:**
- Consumes: `IStorage` bank methods (Task 3/4), `insertBankQuestionSchema` (Task 1).
- Produces: `registerBankRoutes(app: Express, deps: BankRouteDeps): void` where

```ts
export interface BankRouteDeps {
  storage: IStorage;
  requireAuth: (req: any, res: any, next: any) => void;
  tctx: (req: any) => StorageCtx;
}
```

  HTTP surface (all `requireAuth`): `GET /api/bank/questions` (query `search`, `subject`, `tags` comma-separated, `archived=1`), `GET /api/bank/questions/meta`, `POST /api/bank/questions` (201), `PUT /api/bank/questions/:id`, `DELETE /api/bank/questions/:id` (archive, 204), `POST /api/bank/questions/:id/restore`. Client tasks (9, 11, 12) call these paths.

- [ ] **Step 1: Write the failing test** — `server/bank-routes.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { MemStorage } = await import("./storage");
const { registerBankRoutes } = await import("./bank-routes");

const VALID_QUESTION = {
  question: "What is 2+2?",
  type: "quiz",
  answerType: "single",
  answers: ["3", "4"],
  correctAnswers: [1],
  timeLimit: 20,
  points: "standard",
};

// Minimal harness: real express + MemStorage; auth faked via x-test-user
// header (mirrors requireAuth's contract: 401 without a session, sets
// req.authUserId with one). tctx pinned to tenant 1.
function makeApp(storage: InstanceType<typeof MemStorage>) {
  const app = express();
  app.use(express.json());
  const requireAuth = (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ message: "Authentication required" });
    req.authUserId = parseInt(String(uid), 10);
    next();
  };
  registerBankRoutes(app, { storage, requireAuth, tctx: () => ({ tenantId: 1 }) });
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

const AUTH = { "x-test-user": "1", "content-type": "application/json" };

test("bank routes: every endpoint 401s without auth", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    const cases: Array<[string, string]> = [
      ["GET", "/api/bank/questions"],
      ["GET", "/api/bank/questions/meta"],
      ["POST", "/api/bank/questions"],
      ["PUT", "/api/bank/questions/1"],
      ["DELETE", "/api/bank/questions/1"],
      ["POST", "/api/bank/questions/1/restore"],
    ];
    for (const [method, path] of cases) {
      const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });
});

test("bank routes: create → list → meta → update → archive → restore happy path", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    // Create (201) — tags normalized, createdBy stamped from auth.
    const createRes = await fetch(`${base}/api/bank/questions`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ question: VALID_QUESTION, subject: "Math", tags: ["Basics", "basics", " arithmetic "] }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.createdBy, 1);
    assert.deepEqual(created.tags, ["Basics", "arithmetic"]);

    // List + filters.
    const list = await (await fetch(`${base}/api/bank/questions`, { headers: AUTH })).json();
    assert.equal(list.length, 1);
    const filtered = await (await fetch(`${base}/api/bank/questions?tags=Basics,arithmetic&subject=Math&search=2%2B2`, { headers: AUTH })).json();
    assert.equal(filtered.length, 1);
    const none = await (await fetch(`${base}/api/bank/questions?search=nomatch`, { headers: AUTH })).json();
    assert.equal(none.length, 0);

    // Meta.
    const meta = await (await fetch(`${base}/api/bank/questions/meta`, { headers: AUTH })).json();
    assert.deepEqual(meta.subjects, ["Math"]);
    assert.deepEqual(meta.tags.sort(), ["Basics", "arithmetic"].sort());

    // Update.
    const updRes = await fetch(`${base}/api/bank/questions/${created.id}`, {
      method: "PUT", headers: AUTH, body: JSON.stringify({ subject: "Arithmetic" }),
    });
    assert.equal(updRes.status, 200);
    assert.equal((await updRes.json()).subject, "Arithmetic");

    // Archive (204) → gone from live list, present with archived=1.
    assert.equal((await fetch(`${base}/api/bank/questions/${created.id}`, { method: "DELETE", headers: AUTH })).status, 204);
    assert.equal(((await (await fetch(`${base}/api/bank/questions`, { headers: AUTH })).json()) as any[]).length, 0);
    assert.equal(((await (await fetch(`${base}/api/bank/questions?archived=1`, { headers: AUTH })).json()) as any[]).length, 1);

    // Restore.
    const restoreRes = await fetch(`${base}/api/bank/questions/${created.id}/restore`, { method: "POST", headers: AUTH });
    assert.equal(restoreRes.status, 200);
    assert.equal(((await (await fetch(`${base}/api/bank/questions`, { headers: AUTH })).json()) as any[]).length, 1);
  });
});

test("bank routes: validation failures → 400, unknown ids → 404", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    // Poll with correctAnswers → Zod 400.
    const bad = await fetch(`${base}/api/bank/questions`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ question: { ...VALID_QUESTION, type: "poll" } }),
    });
    assert.equal(bad.status, 400);

    // Non-numeric id → 400.
    assert.equal((await fetch(`${base}/api/bank/questions/abc`, { method: "DELETE", headers: AUTH })).status, 400);

    // Unknown id → 404 on update / archive / restore.
    assert.equal((await fetch(`${base}/api/bank/questions/999`, { method: "PUT", headers: AUTH, body: JSON.stringify({ subject: "X" }) })).status, 404);
    assert.equal((await fetch(`${base}/api/bank/questions/999`, { method: "DELETE", headers: AUTH })).status, 404);
    assert.equal((await fetch(`${base}/api/bank/questions/999/restore`, { method: "POST", headers: AUTH })).status, 404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot find module `./bank-routes`.

- [ ] **Step 3: Implement `server/bank-routes.ts`**

```ts
import type { Express } from "express";
import { z } from "zod";
import { insertBankQuestionSchema } from "@shared/schema";
import type { IStorage, StorageCtx } from "./storage";
import { captureError } from "./instrument";

// Bank routes live in their own module with injected deps (storage,
// requireAuth, tctx are closures inside registerRoutes) so they can be
// unit-tested over HTTP against MemStorage without a database.
export interface BankRouteDeps {
  storage: IStorage;
  requireAuth: (req: any, res: any, next: any) => void;
  tctx: (req: any) => StorageCtx;
}

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  subject: z.string().max(100).optional(),
  tags: z.string().max(500).optional(), // comma-separated
  archived: z.string().optional(),
});

// PUT accepts partial updates; each present field is fully validated.
const updateBankQuestionSchema = insertBankQuestionSchema.partial();

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerBankRoutes(app: Express, { storage, requireAuth, tctx }: BankRouteDeps): void {
  app.get("/api/bank/questions", requireAuth, async (req, res) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid query", errors: parsed.error.errors });
      }
      const rows = await storage.getBankQuestions(tctx(req), {
        search: parsed.data.search,
        subject: parsed.data.subject,
        tags: parsed.data.tags ? parsed.data.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
        archived: parsed.data.archived === "1" || parsed.data.archived === "true",
      });
      res.json(rows);
    } catch (error) {
      captureError(error, { scope: "http.bank-list" });
      res.status(500).json({ message: "Failed to fetch bank questions" });
    }
  });

  app.get("/api/bank/questions/meta", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getBankSubjectsAndTags(tctx(req)));
    } catch (error) {
      captureError(error, { scope: "http.bank-meta" });
      res.status(500).json({ message: "Failed to fetch bank metadata" });
    }
  });

  app.post("/api/bank/questions", requireAuth, async (req, res) => {
    try {
      const validation = insertBankQuestionSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid bank question", errors: validation.error.errors });
      }
      const row = await storage.createBankQuestion(tctx(req), {
        ...validation.data,
        createdBy: (req as any).authUserId,
      });
      res.status(201).json(row);
    } catch (error) {
      captureError(error, { scope: "http.bank-create" });
      res.status(500).json({ message: "Failed to create bank question" });
    }
  });

  app.put("/api/bank/questions/:id", requireAuth, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid question id" });
      const validation = updateBankQuestionSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid bank question", errors: validation.error.errors });
      }
      const row = await storage.updateBankQuestion(tctx(req), id, validation.data);
      if (!row) return res.status(404).json({ message: "Bank question not found" });
      res.json(row);
    } catch (error) {
      captureError(error, { scope: "http.bank-update" });
      res.status(500).json({ message: "Failed to update bank question" });
    }
  });

  app.delete("/api/bank/questions/:id", requireAuth, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid question id" });
      const row = await storage.archiveBankQuestion(tctx(req), id);
      if (!row) return res.status(404).json({ message: "Bank question not found" });
      res.status(204).end();
    } catch (error) {
      captureError(error, { scope: "http.bank-archive" });
      res.status(500).json({ message: "Failed to archive bank question" });
    }
  });

  app.post("/api/bank/questions/:id/restore", requireAuth, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid question id" });
      const row = await storage.restoreBankQuestion(tctx(req), id);
      if (!row) return res.status(404).json({ message: "Bank question not found" });
      res.json(row);
    } catch (error) {
      captureError(error, { scope: "http.bank-restore" });
      res.status(500).json({ message: "Failed to restore bank question" });
    }
  });
}
```

- [ ] **Step 4: Wire into `server/routes.ts`** — add the import at the top with the other local imports:

```ts
import { registerBankRoutes } from "./bank-routes";
```

and after the quiz-restore route block (after line ~670, before the insights route), add:

```ts
  // Question Bank (per-tenant reusable question library). Routes live in
  // server/bank-routes.ts with injected deps so they're testable sans DB.
  registerBankRoutes(app, { storage, requireAuth, tctx });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run check && npm test`
Expected: tsc clean; all tests PASS including the 3 new HTTP tests.

- [ ] **Step 6: Commit**

```bash
git add server/bank-routes.ts server/bank-routes.test.ts server/routes.ts
git commit -m "feat(bank): /api/bank/questions CRUD + meta routes, HTTP-tested against MemStorage"
```

---

### Task 6: PR 1 gate

- [ ] **Step 1: Full gate**

Run: `npm run check && npm test && npm run build`
Expected: all green (tsc clean, all unit tests pass, client+server build OK).

- [ ] **Step 2: Push and open the PR (never auto-merge)**

```bash
git push -u origin feat/question-bank-foundation
gh pr create --title "feat(bank): Question Bank foundation — schema, migration 0009, storage, API" --body "$(cat <<'EOF'
## Summary
- New additive `bank_questions` table (migration 0009): tenant_id + tenant_isolation RLS pair + FORCE + quiz_app grants; GIN index on tags. No backfill needed.
- Shared schema: `insertBankQuestionSchema` (tags normalized/capped, subject <=100), optional `sourceQuestionId` provenance field on questions (round-trip tested).
- Storage: 7 bank methods on IStorage, implemented in MemStorage + DatabaseStorage (search/subject/tags/archived filters, newest-updated ordering, meta dedup).
- Routes: `server/bank-routes.ts` (all requireAuth, tctx(req), Zod-validated) HTTP-tested against MemStorage — 401s, 400s, 404s, happy path.

## Spec
docs/superpowers/specs/2026-07-18-question-bank-design.md (PR 1 of 3)

## Tests
- 3 new schema unit tests, 3 new storage tests, 3 new HTTP route tests; full suite green.
- tests/integration/bank-questions-migration.test.ts asserts table/RLS/policy-parity/grants after the migration is applied (run via `npm run integration`).

## Security impact
New table follows the hard-rule checklist: tenant_id, tenant_isolation policy pair (asserted equal to the quizzes policy), FORCE RLS, explicit quiz_app grants, requireAuth on every endpoint, no SYSTEM_CTX.

## Rollback
Revert the PR; migration is additive (table can be dropped with `drop table public.bank_questions`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After PR review/merge, apply migration 0009 to the target DB** (owner/admin, then verify):

```
psql "$DATABASE_URL_ADMIN" -f migrations/0009_question_bank.sql
npm run integration   # bank-questions-migration.test.ts must pass
```

---

# PR 2 — Bank page (branch `feat/question-bank-page`, based on main after PR 1 merges)

### Task 7: Extract shared question-editing logic (behavior-preserving; own commit)

**Files:**
- Create: `client/src/lib/question-form-utils.ts`
- Test: `client/src/lib/question-form-utils.test.ts`
- Modify: `client/src/pages/quiz-editor.tsx` (delete local `blankQuestion`/`trueFalseQuestion`, rewire 6 mutators + validate loop)

**Interfaces:**
- Produces (consumed by the editor now, and by `QuestionForm` in Task 8):

```ts
export function blankQuestion(): Question;
export function trueFalseQuestion(existing?: Partial<Question>): Question;
export function withAnswerText(q: Question, answerIndex: number, value: string): Question;
export function withAddedAnswer(q: Question): Question;                    // no-op at 6 answers / true_false
export function withRemovedAnswer(q: Question, answerIndex: number): Question; // no-op at 2 answers / true_false
export function withToggledCorrect(q: Question, answerIndex: number): Question;
export function withType(q: Question, type: Question["type"]): Question;
export function withAnswerMode(q: Question, answerType: Question["answerType"]): Question;
export type QuestionValidationKey =
  | "needsText" | "needsTwoAnswers" | "emptyAnswer" | "needsCorrectAnswer" | "singleSelectOneCorrect";
export function validateQuestion(q: Question): QuestionValidationKey | null;
```

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/question-bank-page
```

- [ ] **Step 2: Write the failing tests** — `client/src/lib/question-form-utils.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  blankQuestion, trueFalseQuestion, withAnswerText, withAddedAnswer, withRemovedAnswer,
  withToggledCorrect, withType, withAnswerMode, validateQuestion,
} from "./question-form-utils";

test("factories: blank has 4 empty answers; trueFalse preserves text/image/time/points", () => {
  const b = blankQuestion();
  assert.equal(b.answers.length, 4);
  assert.deepEqual(b.correctAnswers, [0]);
  const tf = trueFalseQuestion({ question: "Sky is blue?", timeLimit: 30, points: "double" });
  assert.deepEqual(tf.answers, ["True", "False"]);
  assert.equal(tf.type, "true_false");
  assert.equal(tf.timeLimit, 30);
  assert.equal(tf.points, "double");
});

test("withRemovedAnswer re-maps correct indices and never leaves a scored question with none", () => {
  const q = { ...blankQuestion(), answers: ["a", "b", "c"], correctAnswers: [2] };
  const r = withRemovedAnswer(q, 2);
  assert.deepEqual(r.answers, ["a", "b"]);
  assert.deepEqual(r.correctAnswers, [0]); // backfilled
  const shifted = withRemovedAnswer({ ...q, correctAnswers: [2] }, 0);
  assert.deepEqual(shifted.correctAnswers, [1]); // 2 shifted down past removed 0
  // Guards: min 2 answers, true_false untouched.
  const min = { ...blankQuestion(), answers: ["a", "b"] };
  assert.equal(withRemovedAnswer(min, 0), min);
  const tf = trueFalseQuestion();
  assert.equal(withRemovedAnswer(tf, 0), tf);
  // Poll never backfills a correct answer.
  const poll = withType(blankQuestion(), "poll");
  const pollRemoved = withRemovedAnswer({ ...poll, answers: ["a", "b", "c"] }, 0);
  assert.deepEqual(pollRemoved.correctAnswers, []);
});

test("withToggledCorrect: single replaces; multiple toggles but keeps at least one", () => {
  const single = blankQuestion();
  assert.deepEqual(withToggledCorrect(single, 2).correctAnswers, [2]);
  const multi = { ...blankQuestion(), answerType: "multiple" as const, correctAnswers: [0, 2] };
  assert.deepEqual(withToggledCorrect(multi, 1).correctAnswers, [0, 1, 2]);
  assert.deepEqual(withToggledCorrect(multi, 0).correctAnswers, [2]);
  // Un-toggling the last one keeps it selected.
  const one = { ...multi, correctAnswers: [1] };
  assert.deepEqual(withToggledCorrect(one, 1).correctAnswers, [1]);
});

test("withType and withAnswerMode preserve poll invariant (no correct answers)", () => {
  const q = blankQuestion();
  const poll = withType(q, "poll");
  assert.deepEqual(poll.correctAnswers, []);
  assert.deepEqual(withAnswerMode(poll, "multiple").correctAnswers, []);
  const backToQuiz = withType(poll, "quiz");
  assert.equal(backToQuiz.type, "quiz");
  const single = withAnswerMode({ ...q, answerType: "multiple", correctAnswers: [1, 2] }, "single");
  assert.deepEqual(single.correctAnswers, [1]);
});

test("validateQuestion returns the first violated rule's key, null when valid", () => {
  const valid = { ...blankQuestion(), question: "Q?", answers: ["a", "b"], correctAnswers: [1] };
  assert.equal(validateQuestion(valid), null);
  assert.equal(validateQuestion({ ...valid, question: "  " }), "needsText");
  assert.equal(validateQuestion({ ...valid, answers: ["a"] }), "needsTwoAnswers");
  assert.equal(validateQuestion({ ...valid, answers: ["a", " "] }), "emptyAnswer");
  assert.equal(validateQuestion({ ...valid, correctAnswers: [] }), "needsCorrectAnswer");
  assert.equal(validateQuestion({ ...valid, correctAnswers: [0, 1] }), "singleSelectOneCorrect");
  // Polls skip correctness rules.
  const poll = { ...withType(valid, "poll"), question: "P?" };
  assert.equal(validateQuestion(poll), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot find module `./question-form-utils`.

- [ ] **Step 4: Implement `client/src/lib/question-form-utils.ts`** — pure logic lifted 1:1 from `quiz-editor.tsx` (lines 50–86 and 196–259); single source of truth for both the editor and the bank's `QuestionForm`:

```ts
import type { Question } from "@shared/schema";

export function blankQuestion(): Question {
  return {
    question: "",
    type: "quiz",
    answerType: "single",
    answers: ["", "", "", ""],
    correctAnswers: [0],
    timeLimit: 20,
    points: "standard",
  };
}

export function trueFalseQuestion(existing?: Partial<Question>): Question {
  return {
    question: existing?.question ?? "",
    imageUrl: existing?.imageUrl,
    type: "true_false",
    answerType: "single",
    answers: ["True", "False"],
    correctAnswers: [0],
    timeLimit: existing?.timeLimit ?? 20,
    points: existing?.points ?? "standard",
  };
}

export function withAnswerText(q: Question, answerIndex: number, value: string): Question {
  return { ...q, answers: q.answers.map((a, i) => (i === answerIndex ? value : a)) };
}

export function withAddedAnswer(q: Question): Question {
  if (q.answers.length >= 6 || q.type === "true_false") return q;
  return { ...q, answers: [...q.answers, ""] };
}

export function withRemovedAnswer(q: Question, answerIndex: number): Question {
  if (q.answers.length <= 2 || q.type === "true_false") return q;
  const answers = q.answers.filter((_, i) => i !== answerIndex);
  // Re-map correct indices after removal.
  const correctAnswers = q.correctAnswers
    .filter((ci) => ci !== answerIndex)
    .map((ci) => (ci > answerIndex ? ci - 1 : ci));
  return {
    ...q,
    answers,
    // Polls must never have correct answers; never backfill [0] for them.
    correctAnswers: q.type === "poll" ? [] : correctAnswers.length ? correctAnswers : [0],
  };
}

export function withToggledCorrect(q: Question, answerIndex: number): Question {
  if (q.answerType === "single") {
    return { ...q, correctAnswers: [answerIndex] };
  }
  const set = new Set(q.correctAnswers);
  if (set.has(answerIndex)) set.delete(answerIndex);
  else set.add(answerIndex);
  const next = Array.from(set).sort((a, b) => a - b);
  return { ...q, correctAnswers: next.length ? next : [answerIndex] };
}

export function withType(q: Question, type: Question["type"]): Question {
  if (type === "true_false") return trueFalseQuestion(q);
  if (type === "poll") {
    return { ...q, type: "poll", answers: q.answers.length >= 2 ? q.answers : ["", "", "", ""], correctAnswers: [] };
  }
  return {
    ...q,
    type: "quiz",
    answers: q.answers.length >= 2 ? q.answers : ["", "", "", ""],
    correctAnswers: q.correctAnswers.length ? q.correctAnswers : [0],
  };
}

export function withAnswerMode(q: Question, answerType: Question["answerType"]): Question {
  if (q.type === "poll") {
    // Polls must never have correct answers, regardless of answer mode.
    return { ...q, answerType, correctAnswers: [] };
  }
  if (answerType === "single") {
    return { ...q, answerType, correctAnswers: [q.correctAnswers[0] ?? 0] };
  }
  return { ...q, answerType };
}

export type QuestionValidationKey =
  | "needsText"
  | "needsTwoAnswers"
  | "emptyAnswer"
  | "needsCorrectAnswer"
  | "singleSelectOneCorrect";

// Mirrors the editor's per-question save validation, returning the FIRST
// violated rule so callers map it to a localized message.
export function validateQuestion(q: Question): QuestionValidationKey | null {
  if (!q.question.trim()) return "needsText";
  if (q.answers.length < 2) return "needsTwoAnswers";
  if (q.answers.some((a) => !a.trim())) return "emptyAnswer";
  if (q.type !== "poll") {
    if (q.correctAnswers.length === 0) return "needsCorrectAnswer";
    if (q.answerType === "single" && q.correctAnswers.length !== 1) return "singleSelectOneCorrect";
  }
  return null;
}
```

NOTE on `withType(q, "quiz")`: the editor's original `setType` did NOT reset `correctAnswers` when switching poll → quiz (leaving `[]` until save-validation catches it). The util backfills `[0]` — this is a deliberate, strictly-safer normalization; keep it, it cannot invalidate any previously-valid state.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Rewire `quiz-editor.tsx` to the shared utils (behavior-preserving)**

(a) Add the import; delete the local `blankQuestion` (lines 50–60) and `trueFalseQuestion` (lines 62–73) functions:

```ts
import {
  blankQuestion, trueFalseQuestion, withAnswerText, withAddedAnswer, withRemovedAnswer,
  withToggledCorrect, withType, withAnswerMode, validateQuestion, type QuestionValidationKey,
} from "@/lib/question-form-utils";
```

(b) Add a `replaceQuestion` helper next to `patchQuestion` (line 168):

```ts
const replaceQuestion = (index: number, next: Question) => {
  setQuiz((prev) => ({
    ...prev,
    questions: prev.questions.map((q, i) => (i === index ? next : q)),
  }));
};
```

(c) Replace the bodies of the six mutators (lines 196–259) with delegations:

```ts
const setAnswerText = (answerIndex: number, value: string) =>
  replaceQuestion(currentIndex, withAnswerText(current, answerIndex, value));

const addAnswer = () => replaceQuestion(currentIndex, withAddedAnswer(current));

const removeAnswer = (answerIndex: number) =>
  replaceQuestion(currentIndex, withRemovedAnswer(current, answerIndex));

const toggleCorrect = (answerIndex: number) =>
  replaceQuestion(currentIndex, withToggledCorrect(current, answerIndex));

const setType = (type: Question["type"]) => replaceQuestion(currentIndex, withType(current, type));

const setAnswerMode = (answerType: Question["answerType"]) =>
  replaceQuestion(currentIndex, withAnswerMode(current, answerType));
```

(d) Replace the per-question rules inside `validate()` (lines 298–313) with the shared validator:

```ts
const VALIDATION_MSG: Record<QuestionValidationKey, string> = {
  needsText: "editor.toasts.validationQuestionNeedsText",
  needsTwoAnswers: "editor.toasts.validationNeedsTwoAnswers",
  emptyAnswer: "editor.toasts.validationEmptyAnswer",
  needsCorrectAnswer: "editor.toasts.validationNeedsCorrectAnswer",
  singleSelectOneCorrect: "editor.toasts.validationSingleSelectOneCorrect",
};

const validate = (): string | null => {
  if (!quiz.title.trim()) return t("editor.toasts.validationTitleRequired");
  for (let i = 0; i < quiz.questions.length; i++) {
    const key = validateQuestion(quiz.questions[i]);
    if (key) return t(VALIDATION_MSG[key], { n: i + 1 });
  }
  return null;
};
```

(Place `VALIDATION_MSG` at module scope, above the component.)

- [ ] **Step 7: Verify + manually exercise the editor**

Run: `npm run check && npm test && npm run build`
Expected: all green.
Then start the dev server and verify in the browser: create a quiz — add/remove/toggle answers, switch type quiz→true/false→poll→quiz, single↔multiple, save; edit an existing quiz and save. Behavior identical to before.

- [ ] **Step 8: Commit (extraction only — its own commit, before anything consumes it)**

```bash
git add client/src/lib/question-form-utils.ts client/src/lib/question-form-utils.test.ts client/src/pages/quiz-editor.tsx
git commit -m "refactor(editor): extract question mutators/validation to shared question-form-utils (behavior-preserving)"
```

---

### Task 8: `QuestionForm` + `TagInput` + `BankQuestionDialog` components

**Files:**
- Create: `client/src/components/bank/QuestionForm.tsx`
- Create: `client/src/components/bank/TagInput.tsx`
- Create: `client/src/components/bank/BankQuestionDialog.tsx`
- Modify: `client/src/locales/en.json`, `client/src/locales/ar.json` (add `bank.*` keys — full JSON in Task 9 Step 2; if executing tasks out of order, take the keys from there)

**Interfaces:**
- Consumes: Task 7 utils; existing ui primitives (`Button`, `Input`, `Textarea`, `Select*`, `Dialog*`, `Badge`); existing i18n keys `editor.question.*`, `editor.timing.*`, `editor.answers.*` (reused verbatim so the two surfaces share copy).
- Produces:

```tsx
// QuestionForm — compact, dialog-friendly, fully controlled.
interface QuestionFormProps {
  value: Question;
  onChange: (q: Question) => void;
  uploading?: boolean;
  onUploadImage?: (file: File) => void; // omit to hide the image control
}
// TagInput — chip input with suggestions.
interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];   // from /api/bank/questions/meta
  placeholder?: string;
}
// BankQuestionDialog — create/edit a bank question.
interface BankQuestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: BankQuestionRow | null;      // null/undefined → create mode
  meta: { subjects: string[]; tags: string[] };
  onSaved: () => void;                   // caller invalidates queries
}
// BankQuestionRow — the API row shape shared by page/dialog/picker:
export interface BankQuestionRow {
  id: number; createdBy: number; question: Question;
  subject: string | null; tags: string[];
  deletedAt: string | null; createdAt: string; updatedAt: string;
}
```

- [ ] **Step 1: Implement `client/src/components/bank/TagInput.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  placeholder?: string;
}

// Chip input: Enter/comma adds the draft tag; suggestions (from bank meta)
// steer users toward existing tags to limit tag sprawl. Case-insensitive
// dedupe mirrors the server's normalizeTags.
export function TagInput({ value, onChange, suggestions, placeholder }: TagInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  const lower = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);
  const matches = useMemo(() => {
    const d = draft.trim().toLowerCase();
    return suggestions
      .filter((s) => !lower.has(s.toLowerCase()))
      .filter((s) => !d || s.toLowerCase().includes(d))
      .slice(0, 6);
  }, [draft, suggestions, lower]);

  const add = (raw: string) => {
    const tag = raw.trim();
    if (!tag || lower.has(tag.toLowerCase()) || value.length >= 20) return;
    onChange([...value, tag]);
    setDraft("");
  };

  const remove = (tag: string) => onChange(value.filter((v) => v !== tag));

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            {tag}
            <button type="button" aria-label={t("bank.tagRemoveAria", { tag })} onClick={() => remove(tag)}>
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          }
        }}
        placeholder={placeholder ?? t("bank.tagsPlaceholder")}
        maxLength={50}
      />
      {matches.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {matches.map((s) => (
            <button key={s} type="button" className="text-xs text-abraj-primary underline" onClick={() => add(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `client/src/components/bank/QuestionForm.tsx`** (compact vertical layout; reuses `editor.*` i18n keys and the shared utils — visually distinct from the editor's stage on purpose):

```tsx
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ImagePlus, Loader2, Plus, X } from "lucide-react";
import type { Question } from "@shared/schema";
import {
  withAnswerText, withAddedAnswer, withRemovedAnswer, withToggledCorrect, withType, withAnswerMode,
} from "@/lib/question-form-utils";

const TIME_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

interface QuestionFormProps {
  value: Question;
  onChange: (q: Question) => void;
  uploading?: boolean;
  onUploadImage?: (file: File) => void;
}

// Compact question editor for dialogs (bank create/edit). Shares ALL mutation
// and validation logic with the quiz editor via question-form-utils; only the
// layout differs (vertical form vs. the editor's full-canvas stage).
export function QuestionForm({ value, onChange, uploading, onUploadImage }: QuestionFormProps) {
  const { t } = useTranslation();
  const imageInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <Textarea
        value={value.question}
        onChange={(e) => onChange({ ...value, question: e.target.value })}
        placeholder={t("editor.question.placeholder")}
        rows={2}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("editor.question.questionTypeLabel")}</label>
          <Select value={value.type} onValueChange={(v) => onChange(withType(value, v as Question["type"]))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="quiz">{t("editor.question.typeQuiz")}</SelectItem>
              <SelectItem value="true_false">{t("editor.question.typeTrueFalse")}</SelectItem>
              <SelectItem value="poll">{t("editor.question.typePoll")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("editor.timing.label")}</label>
          <Select value={String(value.timeLimit)} onValueChange={(v) => onChange({ ...value, timeLimit: parseInt(v, 10) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("editor.timing.noLimit")}</SelectItem>
              {TIME_OPTIONS.map((secs) => (
                <SelectItem key={secs} value={String(secs)}>{t("editor.timing.secondsOption", { count: secs })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("editor.question.answerOptionsLabel")}</label>
          <Select
            value={value.answerType}
            onValueChange={(v) => onChange(withAnswerMode(value, v as Question["answerType"]))}
            disabled={value.type === "true_false"}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">{t("editor.question.answerModeSingle")}</SelectItem>
              <SelectItem value="multiple">{t("editor.question.answerModeMultiple")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value.type !== "poll" && (
          <div>
            <label className="text-xs text-gray-500">{t("editor.question.pointsLabel")}</label>
            <Select value={value.points} onValueChange={(v) => onChange({ ...value, points: v as Question["points"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">{t("editor.question.pointsStandard")}</SelectItem>
                <SelectItem value="double">{t("editor.question.pointsDouble")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {value.answers.map((answer, index) => {
          const isCorrect = value.correctAnswers.includes(index);
          return (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={answer}
                onChange={(e) => onChange(withAnswerText(value, index, e.target.value))}
                placeholder={t("editor.answers.placeholder", { index: index + 1 })}
                disabled={value.type === "true_false"}
              />
              {value.type !== "poll" && (
                <button
                  type="button"
                  title={isCorrect ? t("editor.answers.correctTitle") : t("editor.answers.markCorrectTitle")}
                  onClick={() => onChange(withToggledCorrect(value, index))}
                  aria-pressed={isCorrect}
                  className={`shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center ${
                    isCorrect ? "border-green-600 bg-green-50" : "border-gray-300 bg-transparent"
                  }`}
                >
                  {isCorrect && <Check className="w-4 h-4 text-green-600" />}
                </button>
              )}
              {value.type !== "true_false" && value.answers.length > 2 && (
                <button
                  type="button"
                  title={t("editor.answers.removeTitle")}
                  aria-label={t("editor.answers.removeAriaLabel", { index: index + 1 })}
                  onClick={() => onChange(withRemovedAnswer(value, index))}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
        {value.type !== "true_false" && value.answers.length < 6 && (
          <Button type="button" variant="secondary" size="sm" onClick={() => onChange(withAddedAnswer(value))}>
            <Plus className="w-4 h-4 me-1" /> {t("editor.answers.addMore")}
          </Button>
        )}
      </div>

      {onUploadImage && (
        <div>
          {value.imageUrl ? (
            <div className="relative inline-block">
              <img src={value.imageUrl} alt={t("editor.question.imageAlt")} className="max-h-32 rounded-lg border" />
              <button
                type="button"
                onClick={() => onChange({ ...value, imageUrl: undefined })}
                className="absolute top-1 end-1 bg-white rounded-full shadow p-1"
                title={t("editor.question.removeImageTitle")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => imageInputRef.current?.click()}>
              {uploading ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <ImagePlus className="w-4 h-4 me-1" />}
              {uploading ? t("editor.question.uploading") : t("bank.addImage")}
            </Button>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadImage(f); e.target.value = ""; }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement `client/src/components/bank/BankQuestionDialog.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { apiRequest, buildApiUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Question } from "@shared/schema";
import { blankQuestion, validateQuestion, type QuestionValidationKey } from "@/lib/question-form-utils";
import { QuestionForm } from "./QuestionForm";
import { TagInput } from "./TagInput";

export interface BankQuestionRow {
  id: number;
  createdBy: number;
  question: Question;
  subject: string | null;
  tags: string[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const VALIDATION_MSG: Record<QuestionValidationKey, string> = {
  needsText: "editor.toasts.validationQuestionNeedsText",
  needsTwoAnswers: "editor.toasts.validationNeedsTwoAnswers",
  emptyAnswer: "editor.toasts.validationEmptyAnswer",
  needsCorrectAnswer: "editor.toasts.validationNeedsCorrectAnswer",
  singleSelectOneCorrect: "editor.toasts.validationSingleSelectOneCorrect",
};

interface BankQuestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: BankQuestionRow | null;
  meta: { subjects: string[]; tags: string[] };
  onSaved: () => void;
}

export function BankQuestionDialog({ open, onOpenChange, initial, meta, onSaved }: BankQuestionDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [question, setQuestion] = useState<Question>(blankQuestion());
  const [subject, setSubject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Re-seed local state each time the dialog opens (create vs edit).
  useEffect(() => {
    if (open) {
      setQuestion(initial ? initial.question : blankQuestion());
      setSubject(initial?.subject ?? "");
      setTags(initial?.tags ?? []);
    }
  }, [open, initial]);

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch(buildApiUrl("/api/upload-image"), { method: "POST", body: form, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || t("editor.toasts.uploadFailedDefault"));
      }
      const { url } = await res.json();
      setQuestion((q) => ({ ...q, imageUrl: url }));
    } catch (e: any) {
      toast({ title: t("editor.toasts.imageUploadFailedTitle"), description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { question, subject: subject.trim() || undefined, tags };
      const res = initial
        ? await apiRequest("PUT", `/api/bank/questions/${initial.id}`, payload)
        : await apiRequest("POST", "/api/bank/questions", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: initial ? t("bank.updatedToast") : t("bank.createdToast") });
      onOpenChange(false);
      onSaved();
    },
    onError: (error: any) => {
      toast({
        title: t("bank.saveFailedTitle"),
        description: error?.response?.data?.message || error?.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const key = validateQuestion(question);
    if (key) {
      toast({ title: t("editor.toasts.almostThereTitle"), description: t(VALIDATION_MSG[key], { n: 1 }), variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? t("bank.editTitle") : t("bank.createTitle")}</DialogTitle>
        </DialogHeader>

        <QuestionForm value={question} onChange={setQuestion} uploading={uploading} onUploadImage={uploadImage} />

        <div className="grid grid-cols-1 gap-3 pt-2 border-t">
          <div>
            <label className="text-xs text-gray-500">{t("bank.subjectLabel")}</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("bank.subjectPlaceholder")} maxLength={100} list="bank-subjects" />
            <datalist id="bank-subjects">
              {meta.subjects.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-gray-500">{t("bank.tagsLabel")}</label>
            <TagInput value={tags} onChange={setTags} suggestions={meta.tags} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("bank.cancel")}</Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : null}
            {t("bank.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Typecheck** (i18n keys land in Task 9; missing keys don't fail tsc)

Run: `npm run check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/bank/
git commit -m "feat(bank): QuestionForm (compact dialog editor), TagInput, BankQuestionDialog components"
```

---

### Task 9: `/question-bank` page, route, nav link, i18n keys

**Files:**
- Create: `client/src/pages/question-bank.tsx`
- Modify: `client/src/App.tsx` (lazy import ~line 28 + route ~line 40)
- Modify: `client/src/components/navigation.tsx` (link after the `/my-quizzes` block, line 70)
- Modify: `client/src/locales/en.json`, `client/src/locales/ar.json` (new `bank` namespace + `nav.questionBank`)

**Interfaces:**
- Consumes: Task 5 endpoints, Task 8 components (`BankQuestionDialog`, `BankQuestionRow`), existing `EmptyState` (`@/components/empty-state`), `PageLoader`, `useAuth`, `apiRequest`, `formatQuizDate`.
- Produces: route `/question-bank`; nav entry (auth-gated, like `/my-quizzes`).

- [ ] **Step 1: Implement `client/src/pages/question-bank.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { PageLoader } from "@/components/page-loader";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Library, Plus, Search, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatQuizDate } from "@/lib/language";
import { BankQuestionDialog, type BankQuestionRow } from "@/components/bank/BankQuestionDialog";

const ALL_SUBJECTS = "__all__";

export default function QuestionBank() {
  const { t, i18n } = useTranslation();
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState(ALL_SUBJECTS);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BankQuestionRow | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({ title: t("bank.authRequiredTitle"), variant: "destructive" });
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation, toast, t]);

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (subject !== ALL_SUBJECTS) params.set("subject", subject);
    if (activeTags.length) params.set("tags", activeTags.join(","));
    if (showArchived) params.set("archived", "1");
    const qs = params.toString();
    return `/api/bank/questions${qs ? `?${qs}` : ""}`;
  }, [search, subject, activeTags, showArchived]);

  const { data: rows, isLoading: rowsLoading } = useQuery<BankQuestionRow[]>({
    queryKey: [listUrl],
    enabled: isAuthenticated,
  });

  const { data: meta } = useQuery<{ subjects: string[]; tags: string[] }>({
    queryKey: ["/api/bank/questions/meta"],
    enabled: isAuthenticated,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/bank/questions") });
  };

  const archiveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bank/questions/${id}`),
    onSuccess: () => { invalidate(); toast({ title: t("bank.archivedToast") }); },
    onError: () => toast({ title: t("bank.archiveFailedTitle"), variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/bank/questions/${id}/restore`),
    onSuccess: () => { invalidate(); toast({ title: t("bank.restoredToast") }); },
    onError: () => toast({ title: t("bank.restoreFailedTitle"), variant: "destructive" }),
  });

  const toggleTag = (tag: string) =>
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return null;

  const typeBadgeKey = (row: BankQuestionRow) =>
    row.question.type === "true_false" ? "editor.question.typeTrueFalse"
      : row.question.type === "poll" ? "editor.question.typePoll"
      : "editor.question.typeQuiz";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">{t("bank.title")}</h1>
            <p className="text-gray-600">{t("bank.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)} data-testid="button-toggle-archived-bank">
              {showArchived ? t("bank.backToLive") : t("bank.showArchived")}
            </Button>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }} data-testid="button-new-bank-question">
              <Plus className="w-4 h-4 me-1" /> {t("bank.newQuestion")}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("bank.searchPlaceholder")} />
          </div>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SUBJECTS}>{t("bank.allSubjects")}</SelectItem>
              {(meta?.subjects ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(meta?.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {meta!.tags.map((tag) => (
              <button key={tag} type="button" onClick={() => toggleTag(tag)} aria-pressed={activeTags.includes(tag)}>
                <Badge variant={activeTags.includes(tag) ? "default" : "outline"}>{tag}</Badge>
              </button>
            ))}
          </div>
        )}

        {rowsLoading ? (
          <PageLoader />
        ) : !rows || rows.length === 0 ? (
          <EmptyState
            icon={<Library />}
            title={showArchived ? t("bank.emptyArchivedTitle") : t("bank.emptyTitle")}
            description={showArchived ? undefined : t("bank.emptyDescription")}
            action={
              showArchived ? undefined : (
                <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                  {t("bank.newQuestion")}
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <Card key={row.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="secondary">{t(typeBadgeKey(row))}</Badge>
                    <span className="text-xs text-gray-500">{formatQuizDate(row.updatedAt, i18n.language)}</span>
                  </div>
                  <CardTitle className="text-base line-clamp-2">{row.question.question}</CardTitle>
                </CardHeader>
                <CardContent>
                  {row.question.imageUrl && (
                    <img src={row.question.imageUrl} alt="" className="h-16 rounded border object-cover mb-2" />
                  )}
                  <div className="flex flex-wrap gap-1 mb-3 min-h-5">
                    {row.subject && <Badge variant="default">{row.subject}</Badge>}
                    {row.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                  </div>
                  <div className="flex gap-2">
                    {row.deletedAt ? (
                      <Button variant="outline" size="sm" onClick={() => restoreMutation.mutate(row.id)} data-testid={`button-restore-bank-${row.id}`}>
                        {t("bank.restore")}
                      </Button>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={() => { setEditing(row); setDialogOpen(true); }} data-testid={`button-edit-bank-${row.id}`}>
                          <Edit className="w-4 h-4 me-1" /> {t("bank.edit")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 border-red-300 hover:bg-red-50"
                          onClick={() => archiveMutation.mutate(row.id)}
                          data-testid={`button-archive-bank-${row.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <BankQuestionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initial={editing}
          meta={meta ?? { subjects: [], tags: [] }}
          onSaved={invalidate}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add i18n keys.** In `client/src/locales/en.json`, add `"questionBank": "Question Bank"` inside the existing `nav` object, and a new top-level `bank` object (place it after `history`):

```json
"bank": {
  "title": "Question Bank",
  "subtitle": "Reusable questions you can add to any quiz",
  "newQuestion": "New question",
  "createTitle": "New bank question",
  "editTitle": "Edit bank question",
  "subjectLabel": "Subject",
  "subjectPlaceholder": "e.g. Safety",
  "tagsLabel": "Tags",
  "tagsPlaceholder": "Type a tag and press Enter",
  "tagRemoveAria": "Remove tag {{tag}}",
  "addImage": "Add image",
  "save": "Save",
  "cancel": "Cancel",
  "createdToast": "Question saved to bank",
  "updatedToast": "Bank question updated",
  "saveFailedTitle": "Could not save question",
  "archivedToast": "Question archived",
  "archiveFailedTitle": "Could not archive question",
  "restoredToast": "Question restored",
  "restoreFailedTitle": "Could not restore question",
  "restore": "Restore",
  "edit": "Edit",
  "searchPlaceholder": "Search questions…",
  "allSubjects": "All subjects",
  "showArchived": "Archived",
  "backToLive": "Back to bank",
  "emptyTitle": "Your bank is empty",
  "emptyDescription": "Save questions from any quiz, or create one here to reuse later.",
  "emptyArchivedTitle": "No archived questions",
  "authRequiredTitle": "Please log in to use the Question Bank"
}
```

In `client/src/locales/ar.json`, add `"questionBank": "بنك الأسئلة"` inside `nav`, and:

```json
"bank": {
  "title": "بنك الأسئلة",
  "subtitle": "أسئلة قابلة لإعادة الاستخدام يمكنك إضافتها إلى أي اختبار",
  "newQuestion": "سؤال جديد",
  "createTitle": "سؤال جديد في البنك",
  "editTitle": "تعديل سؤال البنك",
  "subjectLabel": "الموضوع",
  "subjectPlaceholder": "مثال: السلامة",
  "tagsLabel": "الوسوم",
  "tagsPlaceholder": "اكتب وسمًا ثم اضغط Enter",
  "tagRemoveAria": "إزالة الوسم {{tag}}",
  "addImage": "إضافة صورة",
  "save": "حفظ",
  "cancel": "إلغاء",
  "createdToast": "تم حفظ السؤال في البنك",
  "updatedToast": "تم تحديث سؤال البنك",
  "saveFailedTitle": "تعذّر حفظ السؤال",
  "archivedToast": "تمت أرشفة السؤال",
  "archiveFailedTitle": "تعذّرت أرشفة السؤال",
  "restoredToast": "تمت استعادة السؤال",
  "restoreFailedTitle": "تعذّرت استعادة السؤال",
  "restore": "استعادة",
  "edit": "تعديل",
  "searchPlaceholder": "ابحث في الأسئلة…",
  "allSubjects": "كل المواضيع",
  "showArchived": "المؤرشفة",
  "backToLive": "العودة إلى البنك",
  "emptyTitle": "بنك الأسئلة فارغ",
  "emptyDescription": "احفظ أسئلة من أي اختبار، أو أنشئ سؤالًا هنا لإعادة استخدامه لاحقًا.",
  "emptyArchivedTitle": "لا توجد أسئلة مؤرشفة",
  "authRequiredTitle": "يرجى تسجيل الدخول لاستخدام بنك الأسئلة"
}
```

(The en↔ar parity test enforces identical key sets — run `npm test` after this step to confirm. Flag the new Arabic strings for the pending native review backlog.)

- [ ] **Step 3: Register the route in `client/src/App.tsx`** — add with the other lazy imports (~line 28):

```ts
const QuestionBank = lazy(() => import("@/pages/question-bank"));
```

and the route after `/my-quizzes` (line 39):

```tsx
<Route path="/question-bank" component={QuestionBank} />
```

- [ ] **Step 4: Add the nav link in `client/src/components/navigation.tsx`** — inside the SAME `{isAuthenticated && (...)}` guard as `/my-quizzes` (convert its single Link into a fragment), after the `/my-quizzes` `</Link>` (line 69):

```tsx
<Link href="/question-bank">
  <span className={`px-4 py-3 rounded-md text-lg font-medium transition-colors cursor-pointer flex items-center space-x-2 ${
    location === '/question-bank'
      ? 'text-abraj-primary bg-teal-50'
      : 'text-gray-700 hover:text-abraj-primary'
  }`}>
    <Library className="w-8 h-8" />
    <span>{t("nav.questionBank")}</span>
  </span>
</Link>
```

So the block becomes `{isAuthenticated && (<> <Link href="/my-quizzes">…</Link> <Link href="/question-bank">…</Link> </>)}`. Add `Library` to the existing `lucide-react` import in navigation.tsx. Check the mobile menu section lower in the same file — if `/my-quizzes` appears there too, add the equivalent `/question-bank` entry beside it (same pattern, same guard).

- [ ] **Step 5: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all green (locale parity test passes with the new `bank` namespace).

- [ ] **Step 6: Browser verification** (dev server): log in → nav shows "Question Bank" → create a question (each type: quiz/true-false/poll) → edit → filter by search/subject/tag → archive → toggle archived → restore. Switch language to Arabic: page renders RTL, all strings Arabic. Verify on both tenants if local hosts map (abraj EN / PDO ar-default).

- [ ] **Step 7: Commit + PR**

```bash
git add client/src/pages/question-bank.tsx client/src/App.tsx client/src/components/navigation.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(bank): /question-bank page — browse/search/filter/create/edit/archive, nav entry, EN+AR strings"
git push -u origin feat/question-bank-page
gh pr create --title "feat(bank): Question Bank page (PR 2/3)" --body "$(cat <<'EOF'
## Summary
- Behavior-preserving extraction of question mutators/validation into client/src/lib/question-form-utils.ts (unit-tested; editor rewired, stage JSX untouched).
- New compact QuestionForm + TagInput + BankQuestionDialog components (reuse editor i18n keys + shared utils).
- /question-bank page: search, subject dropdown, tag chips, archived toggle, create/edit dialog, archive/restore. Nav entry (auth-gated).
- Full EN+AR strings (parity test green); Arabic flagged for native review backlog.

## Spec
docs/superpowers/specs/2026-07-18-question-bank-design.md (PR 2 of 3)

## Browser verification
Create/edit/archive/restore all three question types; filters; EN LTR + AR RTL; editor regression (add/remove/toggle answers, type switches, save) — see task checklist.

## Rollback
Revert the PR; no schema or server changes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# PR 3 — Editor integration (branch `feat/question-bank-editor`, based on main after PR 2 merges)

### Task 10: "Save to bank" from the quiz editor

**Files:**
- Create: `client/src/components/bank/SaveToBankDialog.tsx`
- Modify: `client/src/pages/quiz-editor.tsx` (button in the right properties panel, next to Delete/Duplicate, line ~748)
- Modify: `client/src/locales/en.json`, `client/src/locales/ar.json` (add `editor.bank.*` keys)

**Interfaces:**
- Consumes: `POST /api/bank/questions` (Task 5), `GET /api/bank/questions/meta` (Task 5), `TagInput` (Task 8), `validateQuestion` (Task 7).
- Produces:

```tsx
interface SaveToBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: Question | null;   // the editor question being saved
}
```

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/question-bank-editor
```

- [ ] **Step 2: Implement `client/src/components/bank/SaveToBankDialog.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Question } from "@shared/schema";
import { validateQuestion } from "@/lib/question-form-utils";
import { TagInput } from "./TagInput";

interface SaveToBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: Question | null;
}

// Saves a snapshot of an editor question into the bank. The NEW bank row is a
// fresh source — any sourceQuestionId on the editor question (itself copied
// from the bank earlier) is stripped so provenance always points one hop back.
export function SaveToBankDialog({ open, onOpenChange, question }: SaveToBankDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setSubject("");
      setTags([]);
    }
  }, [open]);

  const { data: meta } = useQuery<{ subjects: string[]; tags: string[] }>({
    queryKey: ["/api/bank/questions/meta"],
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { sourceQuestionId: _omit, ...bare } = (question ?? {}) as Question & { sourceQuestionId?: number };
      const res = await apiRequest("POST", "/api/bank/questions", {
        question: bare,
        subject: subject.trim() || undefined,
        tags,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("editor.bank.savedToast") });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: t("editor.bank.saveFailedTitle"),
        description: error?.response?.data?.message || error?.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!question) return;
    if (validateQuestion(question)) {
      // Incomplete question (no text / empty answers / no correct) — tell the
      // user to finish it first instead of persisting a broken bank row.
      toast({ title: t("editor.bank.incompleteTitle"), description: t("editor.bank.incompleteDescription"), variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("editor.bank.saveDialogTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600 line-clamp-2">{question?.question}</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">{t("bank.subjectLabel")}</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("bank.subjectPlaceholder")} maxLength={100} list="save-bank-subjects" />
            <datalist id="save-bank-subjects">
              {(meta?.subjects ?? []).map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-gray-500">{t("bank.tagsLabel")}</label>
            <TagInput value={tags} onChange={setTags} suggestions={meta?.tags ?? []} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("bank.cancel")}</Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : null}
            {t("editor.bank.saveButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire into `quiz-editor.tsx`.** Add state + import near the other dialog states (line ~109):

```ts
import { SaveToBankDialog } from "@/components/bank/SaveToBankDialog";
// inside the component:
const [saveToBankOpen, setSaveToBankOpen] = useState(false);
```

Render the dialog next to `QuizSettingsDialog` (line ~489):

```tsx
<SaveToBankDialog open={saveToBankOpen} onOpenChange={setSaveToBankOpen} question={current} />
```

Add the button in the right panel's bottom action row (line ~748, alongside Delete/Duplicate — make the row `flex-wrap`):

```tsx
<Button variant="outline" size="sm" className="flex-1" onClick={() => setSaveToBankOpen(true)}>
  {t("editor.bank.saveAction")}
</Button>
```

- [ ] **Step 4: Add i18n keys.** In `en.json`, inside the existing `editor` object add:

```json
"bank": {
  "saveAction": "Save to bank",
  "saveDialogTitle": "Save question to bank",
  "saveButton": "Save to bank",
  "savedToast": "Question saved to bank",
  "saveFailedTitle": "Could not save to bank",
  "incompleteTitle": "Finish the question first",
  "incompleteDescription": "The question needs text, filled answers, and a correct answer before saving to the bank."
}
```

In `ar.json`, inside `editor` add:

```json
"bank": {
  "saveAction": "حفظ في البنك",
  "saveDialogTitle": "حفظ السؤال في بنك الأسئلة",
  "saveButton": "حفظ في البنك",
  "savedToast": "تم حفظ السؤال في البنك",
  "saveFailedTitle": "تعذّر الحفظ في البنك",
  "incompleteTitle": "أكمل السؤال أولًا",
  "incompleteDescription": "يحتاج السؤال إلى نص وإجابات مكتملة وإجابة صحيحة قبل حفظه في البنك."
}
```

- [ ] **Step 5: Verify + commit**

Run: `npm run check && npm test && npm run build`
Expected: all green. Browser: open editor → fill a question → Save to bank (with subject/tags) → toast → question appears on /question-bank. Incomplete question → blocked with toast.

```bash
git add client/src/components/bank/SaveToBankDialog.tsx client/src/pages/quiz-editor.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(bank): save-to-bank from the quiz editor (strips provenance, validates completeness)"
```

---

### Task 11: "Add from bank" picker in the quiz editor

**Files:**
- Create: `client/src/components/bank/BankPickerDialog.tsx`
- Modify: `client/src/pages/quiz-editor.tsx` (button under "Add question" in the left rail, line ~556)
- Modify: `client/src/locales/en.json`, `client/src/locales/ar.json` (extend `editor.bank.*`)

**Interfaces:**
- Consumes: `GET /api/bank/questions` + `/meta` (Task 5), `BankQuestionRow` (Task 8).
- Produces:

```tsx
interface BankPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (questions: Question[]) => void; // deep copies, sourceQuestionId stamped
}
```

- [ ] **Step 1: Implement `client/src/components/bank/BankPickerDialog.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import type { Question } from "@shared/schema";
import type { BankQuestionRow } from "./BankQuestionDialog";

const ALL_SUBJECTS = "__all__";

interface BankPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (questions: Question[]) => void;
}

// Multi-select picker over the live bank. Selected questions are DEEP-COPIED
// into the quiz with sourceQuestionId stamped (copy + provenance): later bank
// edits do NOT propagate; the id enables a future "re-sync?" feature.
export function BankPickerDialog({ open, onOpenChange, onAdd }: BankPickerDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState(ALL_SUBJECTS);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (subject !== ALL_SUBJECTS) params.set("subject", subject);
    if (activeTags.length) params.set("tags", activeTags.join(","));
    const qs = params.toString();
    return `/api/bank/questions${qs ? `?${qs}` : ""}`;
  }, [search, subject, activeTags]);

  const { data: rows } = useQuery<BankQuestionRow[]>({ queryKey: [listUrl], enabled: open });
  const { data: meta } = useQuery<{ subjects: string[]; tags: string[] }>({
    queryKey: ["/api/bank/questions/meta"],
    enabled: open,
  });

  const toggleRow = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleTag = (tag: string) =>
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  const handleAdd = () => {
    const chosen = (rows ?? []).filter((r) => selected.has(r.id));
    const copies: Question[] = chosen.map((r) => {
      // Deep copy; overwrite any stale nested provenance with THIS row's id.
      const copy = JSON.parse(JSON.stringify(r.question)) as Question;
      return { ...copy, sourceQuestionId: r.id };
    });
    onAdd(copies);
    setSelected(new Set());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setSelected(new Set()); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("editor.bank.pickerTitle")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("bank.searchPlaceholder")} />
          </div>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SUBJECTS}>{t("bank.allSubjects")}</SelectItem>
              {(meta?.subjects ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(meta?.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {meta!.tags.map((tag) => (
              <button key={tag} type="button" onClick={() => toggleTag(tag)} aria-pressed={activeTags.includes(tag)}>
                <Badge variant={activeTags.includes(tag) ? "default" : "outline"}>{tag}</Badge>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px]">
          {(rows ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">{t("editor.bank.pickerEmpty")}</p>
          ) : (
            (rows ?? []).map((row) => (
              <label key={row.id} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-gray-50">
                <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleRow(row.id)} className="mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm font-medium line-clamp-2">{row.question.question}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {row.subject && <Badge variant="default">{row.subject}</Badge>}
                    {row.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("bank.cancel")}</Button>
          <Button onClick={handleAdd} disabled={selected.size === 0}>
            {t("editor.bank.addSelected", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire into `quiz-editor.tsx`.** Import + state:

```ts
import { BankPickerDialog } from "@/components/bank/BankPickerDialog";
// inside the component:
const [bankPickerOpen, setBankPickerOpen] = useState(false);

const addFromBank = (picked: Question[]) => {
  if (!picked.length) return;
  setQuiz((prev) => {
    // If the quiz still only has the initial blank question, replace it.
    const onlyBlank = prev.questions.length === 1 && !prev.questions[0].question.trim()
      && prev.questions[0].answers.every((a) => !a.trim());
    const questions = onlyBlank ? picked : [...prev.questions, ...picked];
    return { ...prev, questions };
  });
  setCurrentIndex(quiz.questions.length);
  toast({ title: t("editor.bank.addedToast", { count: picked.length }) });
};
```

Render next to the other dialogs:

```tsx
<BankPickerDialog open={bankPickerOpen} onOpenChange={setBankPickerOpen} onAdd={addFromBank} />
```

Add the button in the left rail directly under the existing Add-question button (line ~556):

```tsx
<Button variant="outline" className="w-auto lg:w-full shrink-0 self-center lg:self-auto" size="sm" onClick={() => setBankPickerOpen(true)}>
  <Library className="w-4 h-4 me-1" /> {t("editor.bank.addFromBank")}
</Button>
```

Add `Library` to the editor's existing `lucide-react` import.

- [ ] **Step 3: Add i18n keys.** Extend `editor.bank` in `en.json`:

```json
"pickerTitle": "Add from bank",
"pickerEmpty": "No matching bank questions",
"addFromBank": "From bank",
"addSelected_one": "Add {{count}} question",
"addSelected_other": "Add {{count}} questions",
"addedToast_one": "Added {{count}} question from the bank",
"addedToast_other": "Added {{count}} questions from the bank"
```

And in `ar.json` (Arabic needs the full CLDR plural set — the parity test is plural-suffix aware; mirror the suffix pattern used by existing pluralized keys like `history.questionsCount`, check that file and use the same suffixes):

```json
"pickerTitle": "إضافة من البنك",
"pickerEmpty": "لا توجد أسئلة مطابقة في البنك",
"addFromBank": "من البنك",
"addSelected_zero": "أضف {{count}} سؤال",
"addSelected_one": "أضف سؤالًا واحدًا",
"addSelected_two": "أضف سؤالين",
"addSelected_few": "أضف {{count}} أسئلة",
"addSelected_many": "أضف {{count}} سؤالًا",
"addSelected_other": "أضف {{count}} سؤال",
"addedToast_zero": "تمت إضافة {{count}} سؤال من البنك",
"addedToast_one": "تمت إضافة سؤال واحد من البنك",
"addedToast_two": "تمت إضافة سؤالين من البنك",
"addedToast_few": "تمت إضافة {{count}} أسئلة من البنك",
"addedToast_many": "تمت إضافة {{count}} سؤالًا من البنك",
"addedToast_other": "تمت إضافة {{count}} سؤال من البنك"
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all green (Arabic plural test passes).

Browser (full reuse loop): create bank questions → new quiz → "From bank" → filter, select 2, add → both appear in the rail → save quiz → reopen in editor → questions intact. Confirm provenance: `GET /api/quizzes/:id` as owner shows `sourceQuestionId` on the copied questions. Host a quick game on the quiz — plays normally (gameplay ignores the field). Editor regression: create + edit flows still work.

- [ ] **Step 5: Commit + PR**

```bash
git add client/src/components/bank/BankPickerDialog.tsx client/src/pages/quiz-editor.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(bank): add-from-bank picker in the quiz editor (deep copy + sourceQuestionId provenance)"
git push -u origin feat/question-bank-editor
gh pr create --title "feat(bank): editor integration — save-to-bank + add-from-bank (PR 3/3)" --body "$(cat <<'EOF'
## Summary
- Save to bank: button in the editor's properties panel → subject/tags mini-dialog → POST /api/bank/questions (strips stale provenance; blocks incomplete questions).
- Add from bank: picker dialog (search/subject/tags, multi-select) → deep-copies into the quiz with sourceQuestionId stamped. Copy + provenance per spec — no gameplay changes.
- EN+AR strings incl. full Arabic CLDR plurals for count keys.

## Spec
docs/superpowers/specs/2026-07-18-question-bank-design.md (PR 3 of 3 — completes the full reuse loop)

## Browser verification
Full loop verified: bank → quiz → save → reopen → host a game (plays normally). Editor create/edit regression checked. EN LTR + AR RTL.

## Rollback
Revert the PR; client-only changes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (done at plan-writing time)

- **Spec coverage:** §3 data model → Tasks 1–2; §4 storage/routes → Tasks 3–5; §5 bank page/QuestionForm/i18n → Tasks 7–9; §5 editor integration → Tasks 10–11; §6 tests → embedded per task (schema round-trip, storage filters, HTTP 401/400/404, RLS integration, en↔ar parity); §7 3-PR rollout → PR boundaries above; §8 risks → extraction is its own commit (Task 7), provenance round-trip tested (Task 1), migration copies 0006 verbatim + policy-parity assertion (Task 2), tag normalization tested (Tasks 1, 5).
- **Known deviations from spec (both safety-neutral):** `QuestionForm` extraction is logic-level (see header note); storage filter named `archived` (archived-only semantics) instead of `includeArchived`, matching `getUserQuizzes` and the UI toggle.
- **Type consistency:** `BankQuestionFilters`/method names identical across Tasks 3/4/5; `BankQuestionRow` defined once (Task 8) and imported by Tasks 9/11; `registerBankRoutes(app, { storage, requireAuth, tctx })` matches Task 5's routes.ts wiring; i18n key names match between components and locale JSON.
