# Multi-Tenant SaaS Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Abraj Quiz into a multi-tenant SaaS platform: one codebase, many companies on custom domains (abrajquiz.com, pdoquiz.com), per-tenant data isolation via Postgres RLS, dynamic branding, feature flags, and a super-admin panel — while preserving all current functionality.

**Architecture:** The existing split stays: static React/Vite frontends on Vercel (one Vercel project per tenant domain, same repo), one shared Express + WebSocket backend on a persistent Node host (Render), one shared Supabase Postgres. The backend resolves the tenant from the request `Origin`/`Host` header against a `tenants` table, threads a `StorageCtx` ({tenantId} or SYSTEM) through every storage call, and sets a per-transaction Postgres GUC (`app.tenant_id` / `app.role`) that RLS policies enforce. The frontend fetches `/api/tenant/config` at boot and applies branding by overriding the existing `--abraj-*` CSS variables.

**Tech Stack:** React 18 + Vite + Wouter + TanStack Query, Express 4 + express-session (connect-pg-simple), Drizzle ORM (node-postgres), Supabase Postgres, Zod, jsPDF, node:test + vitest.

## Global Constraints

Copied from the repo's `CLAUDE.md` and `DEPLOYMENT.md` — every task implicitly includes these:

- Backend NEVER deploys to Vercel Functions. Vercel hosts the static frontend only.
- Single-instance backend; live game state is in-memory in `server/game-room-manager.ts`.
- Never leak `correctAnswer` in answer-submission API responses before question close.
- Host-only routes must validate `session.userId === game.hostId`.
- Run `npm run check && npm test && npm run build` before EVERY commit.
- Node >= 22 (`package.json` engines).
- `games.game_pin` stays **globally unique** across tenants (the in-memory room registry and WebSocket protocol are keyed by pin alone; per-tenant pins would collide). Tenant isolation for pins is enforced by tenant-scoped lookups on all HTTP routes.
- GUC names are exactly `app.tenant_id` (integer as text) and `app.role` (value `'system'`).
- Tenant seed IDs: `abraj` = 1, `pdo` = 2.
- SQL migrations live in `migrations/NNNN_*.sql` and are run manually in the Supabase SQL editor (project `bvtbjijbebhubowvhbrp`) in numeric order, per the runbook in Task 13. `drizzle-kit push` is NOT used to apply them.
- All work happens in repo `haithamlamki/Abraj_Quiz` (local clone: `C:\projects\PDO Quiz\Abraj_Quiz`). Work on a feature branch `feat/multi-tenant`.

## File Structure

New files:

| File | Responsibility |
|---|---|
| `migrations/0001_tenants.sql` | Create + seed `tenants` table |
| `migrations/0002_tenant_id.sql` | Add `tenant_id` to business tables, backfill, per-tenant username uniqueness |
| `migrations/0003_rls.sql` | Revoke anon grants, enable+force RLS, policies, helper functions |
| `migrations/0004_admin_hardening.sql` | `users.is_super_admin`, drop transitional `tenant_id` defaults |
| `server/tenant-cache.ts` | In-memory registry of active tenants, hostname→tenant lookup, origin list |
| `server/tenant.ts` | `extractHostname`, tenant-resolution middleware, `requireFeature` |
| `server/tenant.test.ts` | Unit tests for hostname extraction + cache lookup |
| `server/origins.ts` | Env origins + tenant-domain origins, one allowlist provider |
| `server/storage.test.ts` | Unit tests for tenant-scoped MemStorage |
| `server/admin-routes.ts` | Super-admin tenant CRUD API |
| `client/src/lib/tenant.tsx` | `TenantProvider`, `useTenant`, branding application, PDF-branding helpers |
| `client/src/pages/admin-tenants.tsx` | Super-admin tenant management UI |
| `docs/DEPLOYMENT_MULTI_TENANT.md` | Vercel/Render/Supabase deployment + migration runbook |

Modified files: `shared/schema.ts`, `server/storage.ts`, `server/routes.ts`, `server/index.ts`, `server/websocket.ts`, `server/game-room-manager.ts`, `server/game-room-manager.test.ts`, `client/src/App.tsx`, `client/src/components/navigation.tsx`, `client/src/pages/login.tsx`, `client/src/pages/home.tsx`, `client/src/pages/create-quiz.tsx`, `client/src/pages/game-results.tsx`, `client/src/pages/quiz-pdf.tsx`, `client/src/utils/enhanced-pdf-generator.ts`, `client/src/utils/quiz-pdf-generator.ts`, `client/index.html`, `package.json`, `.env.example`, `CLAUDE.md`.

---

### Task 1: Tenants table — schema, Zod config schemas, seed migration

**Files:**
- Modify: `shared/schema.ts`
- Create: `migrations/0001_tenants.sql`

**Interfaces:**
- Produces: Drizzle table `tenants`; types `Tenant`, `InsertTenant`; Zod schemas `brandingSchema` (type `TenantBranding`), `featuresSchema` (type `TenantFeatures`), `insertTenantSchema`. Branding shape: `{ appName, logoUrl, faviconUrl, colors: { primary, secondary }, pdf: { headerText, footerText, primaryColor: [r,g,b] }, emailFromName }`. Features shape: `{ aiGeneration, pdfReports, publicQuizzes }` (all boolean, default true).

- [ ] **Step 1: Create branch**

```bash
cd "C:/projects/PDO Quiz/Abraj_Quiz"
git checkout -b feat/multi-tenant
```

- [ ] **Step 2: Add tenants table + config schemas to `shared/schema.ts`**

At the top of `shared/schema.ts`, the existing import line stays. Insert the following block immediately BEFORE `export const users = pgTable(...)` (line 5):

```ts
// ── Multi-tenancy ────────────────────────────────────────────────
export const brandingSchema = z.object({
  appName: z.string().default("Abraj Quiz"),
  logoUrl: z.string().default(""),      // URL or data: URL; empty = bundled default logo
  faviconUrl: z.string().default(""),
  colors: z
    .object({
      primary: z.string().default("hsl(184, 100%, 47%)"),
      secondary: z.string().default("hsl(184, 85%, 35%)"),
    })
    .default({}),
  pdf: z
    .object({
      headerText: z.string().default("ABRAJ QUIZ COMPLETE REPORT"),
      footerText: z.string().default("© 2025 Abraj Quiz Platform"),
      primaryColor: z.array(z.number()).length(3).default([1, 158, 189]),
    })
    .default({}),
  emailFromName: z.string().default(""),
});
export type TenantBranding = z.infer<typeof brandingSchema>;

export const featuresSchema = z.object({
  aiGeneration: z.boolean().default(true),
  pdfReports: z.boolean().default(true),
  publicQuizzes: z.boolean().default(true),
});
export type TenantFeatures = z.infer<typeof featuresSchema>;

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  domains: jsonb("domains").$type<string[]>().notNull().default([]),
  branding: jsonb("branding").$type<Partial<TenantBranding>>().notNull().default({}),
  features: jsonb("features").$type<Partial<TenantFeatures>>().notNull().default({}),
  status: text("status").notNull().default("active"), // 'active' | 'suspended'
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTenantSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, digits, hyphens"),
  name: z.string().min(1),
  domains: z.array(z.string()).default([]),
  branding: brandingSchema.partial().default({}),
  features: featuresSchema.partial().default({}),
  status: z.enum(["active", "suspended"]).default("active"),
});
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
```

Note: `z` is already imported in this file; `jsonb`, `serial`, `text`, `timestamp`, `pgTable` are already imported on line 1.

- [ ] **Step 3: Type check**

Run: `npm run check`
Expected: PASS (no errors — additions are purely additive).

- [ ] **Step 4: Write `migrations/0001_tenants.sql`**

```sql
-- 0001_tenants.sql — create and seed the tenants registry.
-- Run in Supabase SQL editor. Safe to run before deploying any new code.
begin;

create table if not exists public.tenants (
  id serial primary key,
  slug text not null unique,
  name text not null,
  domains jsonb not null default '[]'::jsonb,
  branding jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamp default now()
);

create index if not exists tenants_domains_gin on public.tenants using gin (domains);

insert into public.tenants (id, slug, name, domains, branding, features) values
  (1, 'abraj', 'Abraj Quiz',
   '["abrajquiz.com", "www.abrajquiz.com", "abraj-quiz.vercel.app", "localhost", "127.0.0.1"]'::jsonb,
   '{"appName": "Abraj Quiz"}'::jsonb,
   '{}'::jsonb),
  (2, 'pdo', 'PDO Quiz',
   '["pdoquiz.com", "www.pdoquiz.com"]'::jsonb,
   '{"appName": "PDO Quiz", "colors": {"primary": "hsl(356, 74%, 44%)", "secondary": "hsl(356, 74%, 32%)"}, "pdf": {"headerText": "PDO QUIZ COMPLETE REPORT", "footerText": "© 2026 PDO Quiz Platform", "primaryColor": [196, 30, 58]}}'::jsonb,
   '{}'::jsonb)
on conflict (slug) do nothing;

select setval('public.tenants_id_seq', greatest((select max(id) from public.tenants), 1));

commit;
```

- [ ] **Step 5: Run migration 0001 against Supabase**

Paste `migrations/0001_tenants.sql` into the Supabase SQL editor (project `bvtbjijbebhubowvhbrp`) and run it.
Verify: `select id, slug, domains from public.tenants order by id;`
Expected: 2 rows — `(1, abraj, ...)`, `(2, pdo, ...)`.

- [ ] **Step 6: Verify build and commit**

```bash
npm run check && npm test && npm run build
git add shared/schema.ts migrations/0001_tenants.sql
git commit -m "feat: add tenants table, branding/feature schemas, seed migration"
```

---

### Task 2: tenant_id columns on business tables + backfill migration

**Files:**
- Modify: `shared/schema.ts`
- Modify: `server/storage.ts` (MemStorage sample data + constructed rows only)
- Create: `migrations/0002_tenant_id.sql`

**Interfaces:**
- Consumes: `tenants` from Task 1.
- Produces: `users`, `quizzes`, `games`, `gameResponses` tables each gain `tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id)`. `users.username` loses its global `.unique()`; replaced by unique index `users_tenant_username_uq (tenant_id, username)`. `insertGameResponseSchema` picks `tenantId`. The Drizzle-side `.default(1)` is transitional; Task 11 removes it (with migration 0004 dropping the DB default).

- [ ] **Step 1: Update table definitions in `shared/schema.ts`**

Replace the four table definitions with:

```ts
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
    username: text("username").notNull(),
    password: text("password").notNull(),
  },
  (t) => [uniqueIndex("users_tenant_username_uq").on(t.tenantId, t.username)],
);

export const quizzes = pgTable("quizzes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  title: text("title").notNull(),
  description: text("description"),
  createdBy: integer("created_by").notNull(),
  questions: jsonb("questions").notNull(),
  background: text("background").default("classroom"), // Can store theme name or base64 data URL
  isPublic: boolean("is_public").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  quizId: integer("quiz_id").notNull(),
  gamePin: text("game_pin").notNull().unique(), // globally unique — see Global Constraints
  hostId: integer("host_id").notNull(),
  status: text("status").notNull(), // 'waiting', 'active', 'completed'
  currentQuestion: integer("current_question").default(0),
  players: jsonb("players").default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const gameResponses = pgTable("game_responses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  gameId: integer("game_id").notNull(),
  playerName: text("player_name").notNull(),
  questionIndex: integer("question_index").notNull(),
  selectedAnswer: integer("selected_answer").notNull(),
  responseTime: integer("response_time").notNull(), // in milliseconds
  isCorrect: boolean("is_correct").notNull(),
  pointsEarned: integer("points_earned").notNull(),
});
```

If the installed drizzle-orm version rejects the array form of the `users` table's third argument, use the object form instead:

```ts
  (t) => ({ tenantUsername: uniqueIndex("users_tenant_username_uq").on(t.tenantId, t.username) }),
```

Update the import on line 1 to include `uniqueIndex`:

```ts
import { pgTable, text, serial, integer, boolean, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Add tenantId to insertGameResponseSchema**

In `shared/schema.ts`, change `insertGameResponseSchema` to also pick `tenantId` (the game engine writes responses from system context and must state the tenant explicitly):

```ts
export const insertGameResponseSchema = createInsertSchema(gameResponses).pick({
  tenantId: true,
  gameId: true,
  playerName: true,
  questionIndex: true,
  selectedAnswer: true,
  responseTime: true,
  isCorrect: true,
  pointsEarned: true,
});
```

`insertUserSchema`, `insertQuizSchema`, `insertGameSchema` stay unchanged — the storage layer stamps `tenantId` from the request context (Task 4).

- [ ] **Step 3: Fix MemStorage type errors**

`npm run check` will now fail because `MemStorage` constructs `User`/`Quiz`/`Game`/`GameResponse` literals that lack `tenantId`. In `server/storage.ts`:

1. Sample user (line ~232): add `tenantId: 1,` after `id: 1,`.
2. Each of the 3 sample quizzes (lines ~242, ~271, ~294): add `tenantId: 1,` after `id: N,`.
3. `MemStorage.createUser` (line ~330): change constructed object to `const user: User = { ...insertUser, id, tenantId: 1 };`
4. `MemStorage.createQuiz` (line ~354): add `tenantId: 1,` after `id,` in the `newQuiz` literal.
5. `MemStorage.createGame` (line ~403): add `tenantId: 1,` after `id,` in the `game` literal.
6. `MemStorage.createGameResponse` (line ~436): no change needed — `InsertGameResponse` now includes `tenantId`, so the spread carries it. (Task 4's fixture updates pass it.)

These `tenantId: 1` literals are transitional; Task 4 replaces them with context-derived values.

- [ ] **Step 4: Type check and tests**

Run: `npm run check && npm test`
Expected: `check` PASS. `npm test` FAILS in `game-room-manager.test.ts` if `createGame` fixtures now require `tenantId` — they don't (`insertGameSchema` unchanged, `InsertGame` has no tenantId), so expected: PASS. If it fails, the failure will name the missing property; fix by adding `tenantId: 1` to the offending literal only.

- [ ] **Step 5: Write `migrations/0002_tenant_id.sql`**

```sql
-- 0002_tenant_id.sql — add tenant_id to business tables and backfill Abraj (=1).
-- Safe to run while the OLD backend is live: default 1 keeps old inserts working.
begin;

alter table public.users          add column if not exists tenant_id integer not null default 1 references public.tenants(id);
alter table public.quizzes        add column if not exists tenant_id integer not null default 1 references public.tenants(id);
alter table public.games          add column if not exists tenant_id integer not null default 1 references public.tenants(id);
alter table public.game_responses add column if not exists tenant_id integer not null default 1 references public.tenants(id);

-- Existing rows all belong to Abraj; the DEFAULT 1 on ADD COLUMN already backfilled them.

create index if not exists users_tenant_idx          on public.users (tenant_id);
create index if not exists quizzes_tenant_idx        on public.quizzes (tenant_id);
create index if not exists games_tenant_idx          on public.games (tenant_id);
create index if not exists game_responses_tenant_idx on public.game_responses (tenant_id);

-- Replace global username uniqueness with per-tenant uniqueness.
-- Drops whatever unique constraint exists on users(username) regardless of its generated name.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.users'::regclass and contype = 'u'
  loop
    execute format('alter table public.users drop constraint %I', c.conname);
  end loop;
end $$;

create unique index if not exists users_tenant_username_uq on public.users (tenant_id, username);

commit;
```

- [ ] **Step 6: Run migration 0002 against Supabase**

Run in Supabase SQL editor. Verify:

```sql
select count(*) filter (where tenant_id = 1) as abraj_rows, count(*) as total from public.quizzes;
```

Expected: `abraj_rows = total` (currently 14). Also verify `\d`-equivalent: `select indexname from pg_indexes where tablename = 'users';` includes `users_tenant_username_uq`.

- [ ] **Step 7: Verify and commit**

```bash
npm run check && npm test && npm run build
git add shared/schema.ts server/storage.ts migrations/0002_tenant_id.sql
git commit -m "feat: add tenant_id to users, quizzes, games, game_responses with backfill"
```

---

### Task 3: Tenant cache, hostname resolver middleware, /api/tenant/config

**Files:**
- Create: `server/tenant-cache.ts`
- Create: `server/tenant.ts`
- Create: `server/tenant.test.ts`
- Modify: `server/routes.ts` (mount middleware + config endpoint)
- Modify: `server/index.ts` (boot the cache)
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `tenants`, `Tenant`, `brandingSchema`, `featuresSchema` from `@shared/schema`; `db` from `./db`.
- Produces:
  - `class TenantDomainCache { constructor(loader?: () => Promise<Tenant[]>); refresh(): Promise<void>; start(intervalMs?: number): void; getByHostname(hostname: string): Tenant | undefined; getBySlug(slug: string): Tenant | undefined; getAllOrigins(): string[] }` and singleton `export const tenantCache`.
  - `export function extractHostname(originHeader: string | undefined, hostHeader: string | undefined): string | undefined`
  - `export function tenantMiddleware(req, res, next)` — attaches `req.tenant: Tenant`, 404s unknown hosts in production, falls back to `DEFAULT_TENANT_SLUG` (default `"abraj"`) in development.
  - `export function requireFeature(flag: keyof TenantFeatures)` — Express middleware factory (consumed in Task 6).
  - Route `GET /api/tenant/config` → `{ slug, name, branding: TenantBranding, features: TenantFeatures }` (fully defaulted via Zod).

- [ ] **Step 1: Write failing tests — `server/tenant.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { extractHostname } = await import("./tenant");
const { TenantDomainCache } = await import("./tenant-cache");

const fakeTenants = [
  {
    id: 1, slug: "abraj", name: "Abraj Quiz",
    domains: ["abrajquiz.com", "www.abrajquiz.com", "localhost"],
    branding: {}, features: {}, status: "active", createdAt: new Date(),
  },
  {
    id: 2, slug: "pdo", name: "PDO Quiz",
    domains: ["pdoquiz.com"],
    branding: {}, features: {}, status: "active", createdAt: new Date(),
  },
] as any[];

test("extractHostname: prefers Origin header and strips scheme/port", () => {
  assert.equal(extractHostname("https://PDOquiz.com:443", "api.example.com"), "pdoquiz.com");
  assert.equal(extractHostname("http://localhost:5173", "localhost:5000"), "localhost");
});

test("extractHostname: falls back to Host header, stripping port", () => {
  assert.equal(extractHostname(undefined, "abrajquiz.com:443"), "abrajquiz.com");
  assert.equal(extractHostname(undefined, "Localhost:5000"), "localhost");
});

test("extractHostname: garbage origin yields undefined origin path, uses host", () => {
  assert.equal(extractHostname("not a url", "pdoquiz.com"), "pdoquiz.com");
  assert.equal(extractHostname(undefined, undefined), undefined);
});

test("TenantDomainCache: resolves hostname to tenant after refresh", async () => {
  const cache = new TenantDomainCache(async () => fakeTenants);
  await cache.refresh();
  assert.equal(cache.getByHostname("pdoquiz.com")?.slug, "pdo");
  assert.equal(cache.getByHostname("www.abrajquiz.com")?.slug, "abraj");
  assert.equal(cache.getByHostname("unknown.com"), undefined);
});

test("TenantDomainCache: getBySlug and getAllOrigins", async () => {
  const cache = new TenantDomainCache(async () => fakeTenants);
  await cache.refresh();
  assert.equal(cache.getBySlug("abraj")?.id, 1);
  const origins = cache.getAllOrigins();
  assert.ok(origins.includes("https://pdoquiz.com"));
  assert.ok(origins.includes("https://abrajquiz.com"));
});

test("TenantDomainCache: suspended tenants are excluded", async () => {
  const cache = new TenantDomainCache(async () => [
    { ...fakeTenants[1], status: "suspended" },
  ] as any[]);
  await cache.refresh();
  assert.equal(cache.getByHostname("pdoquiz.com"), undefined);
});
```

- [ ] **Step 2: Add the new test file to the test script and run to verify failure**

In `package.json`, change the `test` script to:

```json
"test": "node --import tsx --test server/game-room-manager.test.ts server/websocket.test.ts server/tenant.test.ts",
```

Run: `npm test`
Expected: FAIL — `Cannot find module './tenant'`.

- [ ] **Step 3: Implement `server/tenant-cache.ts`**

```ts
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { tenants, type Tenant } from "@shared/schema";

// Loads all active tenants inside a system-context transaction so this keeps
// working after RLS is forced on the tenants table (migration 0003).
async function defaultLoader(): Promise<Tenant[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.role', 'system', true)`);
    return tx.select().from(tenants).where(eq(tenants.status, "active"));
  });
}

export class TenantDomainCache {
  private byHostname = new Map<string, Tenant>();
  private bySlug = new Map<string, Tenant>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly loader: () => Promise<Tenant[]> = defaultLoader) {}

  async refresh(): Promise<void> {
    const rows = await this.loader();
    const byHostname = new Map<string, Tenant>();
    const bySlug = new Map<string, Tenant>();
    for (const tenant of rows) {
      if (tenant.status !== "active") continue;
      bySlug.set(tenant.slug, tenant);
      for (const domain of tenant.domains ?? []) {
        byHostname.set(String(domain).toLowerCase(), tenant);
      }
    }
    this.byHostname = byHostname;
    this.bySlug = bySlug;
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.refresh().catch((err) => {
        console.error("Tenant cache refresh failed:", err);
      });
    }, intervalMs);
    this.timer.unref();
  }

  getByHostname(hostname: string): Tenant | undefined {
    return this.byHostname.get(hostname.toLowerCase());
  }

  getBySlug(slug: string): Tenant | undefined {
    return this.bySlug.get(slug);
  }

  getAllOrigins(): string[] {
    const origins = new Set<string>();
    for (const hostname of this.byHostname.keys()) {
      origins.add(`https://${hostname}`);
    }
    return Array.from(origins);
  }
}

export const tenantCache = new TenantDomainCache();
```

- [ ] **Step 4: Implement `server/tenant.ts`**

```ts
import type { Request, Response, NextFunction } from "express";
import { featuresSchema, type Tenant, type TenantFeatures } from "@shared/schema";
import { tenantCache } from "./tenant-cache";

declare global {
  namespace Express {
    interface Request {
      tenant?: Tenant;
    }
  }
}

// The SPA calls the API cross-origin, so Origin is the tenant signal.
// Same-origin (local dev / curl) requests fall back to the Host header.
export function extractHostname(
  originHeader: string | undefined,
  hostHeader: string | undefined,
): string | undefined {
  if (originHeader) {
    try {
      return new URL(originHeader).hostname.toLowerCase();
    } catch {
      // fall through to Host header
    }
  }
  if (hostHeader) {
    return hostHeader.split(":")[0].trim().toLowerCase() || undefined;
  }
  return undefined;
}

export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const hostname = extractHostname(req.headers.origin, req.headers.host);
  let tenant = hostname ? tenantCache.getByHostname(hostname) : undefined;

  if (!tenant && process.env.NODE_ENV !== "production") {
    tenant = tenantCache.getBySlug(process.env.DEFAULT_TENANT_SLUG || "abraj");
  }

  if (!tenant) {
    return res.status(404).json({ message: "Unknown tenant", hostname: hostname ?? null });
  }

  req.tenant = tenant;
  next();
}

export function requireFeature(flag: keyof TenantFeatures) {
  return (req: Request, res: Response, next: NextFunction) => {
    const features = featuresSchema.parse((req.tenant?.features as object) ?? {});
    if (!features[flag]) {
      return res.status(403).json({ message: "This feature is not enabled for your organization" });
    }
    next();
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS (all tenant tests green; existing suites untouched).

- [ ] **Step 6: Boot the cache in `server/index.ts` and mount middleware + config route in `server/routes.ts`**

In `server/index.ts`, add to the imports:

```ts
import { tenantCache } from "./tenant-cache";
```

Inside the async IIFE (line 100), BEFORE `const server = await registerRoutes(app);`:

```ts
  try {
    await tenantCache.refresh();
  } catch (err) {
    console.error("Initial tenant cache load failed (will retry on interval):", err);
  }
  tenantCache.start();
```

In `server/routes.ts`, add to the imports (`requireFeature` is added later, in Task 6, to avoid an unused-import error):

```ts
import { tenantMiddleware } from "./tenant";
import { brandingSchema, featuresSchema, type Tenant } from "@shared/schema";
```

Immediately AFTER `app.use(sessionMiddleware);` (line 72), add:

```ts
  // Resolve the tenant for every API request. /api/healthz and /api/readyz are
  // registered earlier in server/index.ts and are unaffected.
  app.use("/api", tenantMiddleware);

  app.get("/api/tenant/config", (req, res) => {
    const tenant = req.tenant as Tenant;
    res.json({
      slug: tenant.slug,
      name: tenant.name,
      branding: brandingSchema.parse((tenant.branding as object) ?? {}),
      features: featuresSchema.parse((tenant.features as object) ?? {}),
    });
  });
```

- [ ] **Step 7: Manual smoke test**

```bash
npm run dev
```

In another terminal: `curl -s http://localhost:5000/api/tenant/config`
Expected: JSON with `"slug":"abraj"`, fully populated `branding` and `features` objects (Host header `localhost` matches the seeded abraj domains; if the DB is unreachable the request 404s — check DATABASE_URL). Stop the dev server.

- [ ] **Step 8: Verify and commit**

```bash
npm run check && npm test && npm run build
git add server/tenant-cache.ts server/tenant.ts server/tenant.test.ts server/routes.ts server/index.ts package.json
git commit -m "feat: tenant registry cache, hostname resolution middleware, tenant config endpoint"
```

---

### Task 4: Thread StorageCtx through storage, game engine, and routes

This is the isolation core. Every `IStorage` method gains a `ctx: StorageCtx` first parameter. Request paths pass `{ tenantId }`; the in-memory game engine (keyed by globally-unique pin) passes `SYSTEM_CTX` and stamps `tenantId` on rows it creates. `DatabaseStorage` wraps every call in a transaction that sets the RLS GUC — inert until migration 0003, load-bearing after.

**Files:**
- Modify: `server/storage.ts`
- Create: `server/storage.test.ts`
- Modify: `server/game-room-manager.ts`
- Modify: `server/game-room-manager.test.ts`
- Modify: `server/routes.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: schema types from Task 2.
- Produces:
  - `export type StorageCtx = { tenantId: number } | { system: true }`
  - `export const SYSTEM_CTX: StorageCtx`
  - `export function requireTenantId(ctx: StorageCtx): number` — throws `Error("Tenant context required")` on system ctx.
  - Every `IStorage` method signature becomes e.g. `getQuiz(ctx: StorageCtx, id: number)`, `createQuiz(ctx: StorageCtx, quiz: InsertQuiz)` (tenant stamped from ctx), `createGameResponse(ctx: StorageCtx, response: InsertGameResponse)` (tenantId explicit in the payload), `getLatestCompletedGame(ctx: StorageCtx)`.
  - `RuntimeRoom` gains `tenantId: number`.

- [ ] **Step 1: Write failing tests — `server/storage.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { MemStorage, SYSTEM_CTX, requireTenantId } = await import("./storage");

const T1 = { tenantId: 1 } as const;
const T2 = { tenantId: 2 } as const;

test("requireTenantId throws on system context", () => {
  assert.equal(requireTenantId(T1), 1);
  assert.throws(() => requireTenantId(SYSTEM_CTX), /Tenant context required/);
});

test("users are isolated per tenant and usernames are per-tenant", async () => {
  const s = new MemStorage();
  const u1 = await s.createUser(T1, { username: "haitham", password: "x" });
  const u2 = await s.createUser(T2, { username: "haitham", password: "y" });
  assert.notEqual(u1.id, u2.id);
  assert.equal((await s.getUserByUsername(T1, "haitham"))?.id, u1.id);
  assert.equal((await s.getUserByUsername(T2, "haitham"))?.id, u2.id);
  assert.equal(await s.getUser(T2, u1.id), undefined);
  assert.equal((await s.getUser(SYSTEM_CTX, u1.id))?.id, u1.id);
});

test("quizzes are isolated per tenant", async () => {
  const s = new MemStorage();
  const q = await s.createQuiz(T2, {
    title: "PDO Safety", description: "", questions: [], background: "classroom",
    isPublic: true, createdBy: 1,
  });
  assert.equal(q.tenantId, 2);
  assert.equal(await s.getQuiz(T1, q.id), undefined);
  assert.equal((await s.getQuiz(T2, q.id))?.id, q.id);
  const t1Public = await s.getPublicQuizzes(T1);
  assert.ok(!t1Public.some((row) => row.id === q.id));
});

test("games: tenant-scoped pin lookup, system sees all", async () => {
  const s = new MemStorage();
  const g = await s.createGame(T2, { quizId: 1, gamePin: "654321", hostId: 1, status: "waiting" });
  assert.equal(g.tenantId, 2);
  assert.equal(await s.getGameByPin(T1, "654321"), undefined);
  assert.equal((await s.getGameByPin(T2, "654321"))?.id, g.id);
  assert.equal((await s.getGameByPin(SYSTEM_CTX, "654321"))?.id, g.id);
});

test("game responses carry explicit tenantId and latest-completed is tenant-scoped", async () => {
  const s = new MemStorage();
  const g = await s.createGame(T2, { quizId: 1, gamePin: "111222", hostId: 1, status: "waiting" });
  const r = await s.createGameResponse(SYSTEM_CTX, {
    tenantId: 2, gameId: g.id, playerName: "A", questionIndex: 0,
    selectedAnswer: 1, responseTime: 500, isCorrect: true, pointsEarned: 100,
  });
  assert.equal(r.tenantId, 2);
  await s.updateGame(SYSTEM_CTX, g.id, { status: "completed" });
  // quiz 1 exists in sample data (tenant 1); latest completed for T1 must not be tenant 2's game
  const latestT1 = await s.getLatestCompletedGame(T1);
  assert.notEqual(latestT1?.game.id, g.id);
});
```

- [ ] **Step 2: Add to test script and verify failure**

In `package.json`:

```json
"test": "node --import tsx --test server/game-room-manager.test.ts server/websocket.test.ts server/tenant.test.ts server/storage.test.ts",
```

Run: `npm test`
Expected: FAIL — `SYSTEM_CTX` is not exported / signatures mismatch.

- [ ] **Step 3: Rewrite `server/storage.ts` — context types, interface, DatabaseStorage**

Replace the imports and everything through the end of `DatabaseStorage` with:

```ts
import {
  users, quizzes, games, gameResponses,
  type User, type InsertUser,
  type Quiz, type InsertQuiz,
  type Game, type InsertGame,
  type GameResponse, type InsertGameResponse
} from "@shared/schema";
import { db } from "./db";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";

// ── Tenant context ───────────────────────────────────────────────
// Request paths carry the resolved tenant. The in-memory game engine
// (keyed by globally-unique game PIN) runs in system context.
export type StorageCtx = { tenantId: number } | { system: true };
export const SYSTEM_CTX: StorageCtx = { system: true };

export function requireTenantId(ctx: StorageCtx): number {
  if ("system" in ctx) {
    throw new Error("Tenant context required");
  }
  return ctx.tenantId;
}

function tenantFilter(ctx: StorageCtx, column: typeof users.tenantId | typeof quizzes.tenantId | typeof games.tenantId | typeof gameResponses.tenantId): SQL | undefined {
  return "system" in ctx ? undefined : eq(column, ctx.tenantId);
}

export interface IStorage {
  // Users
  getUser(ctx: StorageCtx, id: number): Promise<User | undefined>;
  getUserByUsername(ctx: StorageCtx, username: string): Promise<User | undefined>;
  createUser(ctx: StorageCtx, user: InsertUser): Promise<User>;

  // Quizzes
  getQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined>;
  getQuizzes(ctx: StorageCtx): Promise<Quiz[]>;
  getPublicQuizzes(ctx: StorageCtx): Promise<Quiz[]>;
  getUserQuizzes(ctx: StorageCtx, userId: number): Promise<Quiz[]>;
  createQuiz(ctx: StorageCtx, quiz: InsertQuiz): Promise<Quiz>;
  updateQuiz(ctx: StorageCtx, id: number, quiz: Partial<InsertQuiz>): Promise<Quiz>;
  deleteQuiz(ctx: StorageCtx, id: number): Promise<boolean>;

  // Games
  getGame(ctx: StorageCtx, id: number): Promise<Game | undefined>;
  getGameByPin(ctx: StorageCtx, pin: string): Promise<Game | undefined>;
  createGame(ctx: StorageCtx, game: InsertGame): Promise<Game>;
  updateGame(ctx: StorageCtx, id: number, game: Partial<Game>): Promise<Game | undefined>;
  deleteGame(ctx: StorageCtx, id: number): Promise<boolean>;

  // Game Responses
  getGameResponses(ctx: StorageCtx, gameId: number): Promise<GameResponse[]>;
  createGameResponse(ctx: StorageCtx, response: InsertGameResponse): Promise<GameResponse>;
  updateGameResponse(ctx: StorageCtx, id: number, updates: Partial<GameResponse>): Promise<GameResponse | undefined>;
  getPlayerResponses(ctx: StorageCtx, gameId: number, playerName: string): Promise<GameResponse[]>;

  // Latest Game Results
  getLatestCompletedGame(ctx: StorageCtx): Promise<{ game: Game; players: any[]; totalQuestions: number } | undefined>;
}

// Every DB call runs in a transaction that sets the RLS GUC:
//   app.tenant_id for request paths, app.role='system' for the game engine.
// Inert until migration 0003 forces RLS; load-bearing after.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function withCtx<T>(ctx: StorageCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if ("system" in ctx) {
      await tx.execute(sql`select set_config('app.role', 'system', true)`);
    } else {
      await tx.execute(sql`select set_config('app.tenant_id', ${String(ctx.tenantId)}, true)`);
    }
    return fn(tx);
  });
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(ctx: StorageCtx, id: number): Promise<User | undefined> {
    return withCtx(ctx, async (tx) => {
      const [user] = await tx.select().from(users)
        .where(and(eq(users.id, id), tenantFilter(ctx, users.tenantId)));
      return user || undefined;
    });
  }

  async getUserByUsername(ctx: StorageCtx, username: string): Promise<User | undefined> {
    return withCtx(ctx, async (tx) => {
      const [user] = await tx.select().from(users)
        .where(and(eq(users.username, username), tenantFilter(ctx, users.tenantId)));
      return user || undefined;
    });
  }

  async createUser(ctx: StorageCtx, insertUser: InsertUser): Promise<User> {
    const tenantId = requireTenantId(ctx);
    return withCtx(ctx, async (tx) => {
      const [user] = await tx.insert(users).values({ ...insertUser, tenantId }).returning();
      return user;
    });
  }

  // Quizzes
  async getQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined> {
    return withCtx(ctx, async (tx) => {
      const [quiz] = await tx.select().from(quizzes)
        .where(and(eq(quizzes.id, id), tenantFilter(ctx, quizzes.tenantId)));
      return quiz || undefined;
    });
  }

  async getQuizzes(ctx: StorageCtx): Promise<Quiz[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(quizzes).where(tenantFilter(ctx, quizzes.tenantId));
    });
  }

  async getPublicQuizzes(ctx: StorageCtx): Promise<Quiz[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(quizzes)
        .where(and(eq(quizzes.isPublic, true), tenantFilter(ctx, quizzes.tenantId)));
    });
  }

  async getUserQuizzes(ctx: StorageCtx, userId: number): Promise<Quiz[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(quizzes)
        .where(and(eq(quizzes.createdBy, userId), tenantFilter(ctx, quizzes.tenantId)));
    });
  }

  async createQuiz(ctx: StorageCtx, insertQuiz: InsertQuiz): Promise<Quiz> {
    const tenantId = requireTenantId(ctx);
    return withCtx(ctx, async (tx) => {
      const [quiz] = await tx.insert(quizzes).values({ ...insertQuiz, tenantId }).returning();
      return quiz;
    });
  }

  async updateQuiz(ctx: StorageCtx, id: number, updates: Partial<InsertQuiz>): Promise<Quiz> {
    return withCtx(ctx, async (tx) => {
      const [quiz] = await tx.update(quizzes).set(updates)
        .where(and(eq(quizzes.id, id), tenantFilter(ctx, quizzes.tenantId)))
        .returning();
      return quiz;
    });
  }

  async deleteQuiz(ctx: StorageCtx, id: number): Promise<boolean> {
    return withCtx(ctx, async (tx) => {
      const result = await tx.delete(quizzes)
        .where(and(eq(quizzes.id, id), tenantFilter(ctx, quizzes.tenantId)));
      return (result.rowCount || 0) > 0;
    });
  }

  // Games
  async getGame(ctx: StorageCtx, id: number): Promise<Game | undefined> {
    return withCtx(ctx, async (tx) => {
      const [game] = await tx.select().from(games)
        .where(and(eq(games.id, id), tenantFilter(ctx, games.tenantId)));
      return game || undefined;
    });
  }

  async getGameByPin(ctx: StorageCtx, pin: string): Promise<Game | undefined> {
    return withCtx(ctx, async (tx) => {
      const [game] = await tx.select().from(games)
        .where(and(eq(games.gamePin, pin), tenantFilter(ctx, games.tenantId)));
      return game || undefined;
    });
  }

  async createGame(ctx: StorageCtx, insertGame: InsertGame): Promise<Game> {
    const tenantId = requireTenantId(ctx);
    return withCtx(ctx, async (tx) => {
      const [game] = await tx.insert(games).values({ ...insertGame, tenantId }).returning();
      return game;
    });
  }

  async updateGame(ctx: StorageCtx, id: number, updates: Partial<Game>): Promise<Game | undefined> {
    return withCtx(ctx, async (tx) => {
      const [game] = await tx.update(games).set(updates)
        .where(and(eq(games.id, id), tenantFilter(ctx, games.tenantId)))
        .returning();
      return game || undefined;
    });
  }

  async deleteGame(ctx: StorageCtx, id: number): Promise<boolean> {
    return withCtx(ctx, async (tx) => {
      const result = await tx.delete(games)
        .where(and(eq(games.id, id), tenantFilter(ctx, games.tenantId)));
      return (result.rowCount || 0) > 0;
    });
  }

  // Game Responses
  async getGameResponses(ctx: StorageCtx, gameId: number): Promise<GameResponse[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(gameResponses)
        .where(and(eq(gameResponses.gameId, gameId), tenantFilter(ctx, gameResponses.tenantId)));
    });
  }

  async createGameResponse(ctx: StorageCtx, insertResponse: InsertGameResponse): Promise<GameResponse> {
    return withCtx(ctx, async (tx) => {
      const [response] = await tx.insert(gameResponses).values(insertResponse).returning();
      return response;
    });
  }

  async updateGameResponse(ctx: StorageCtx, id: number, updates: Partial<GameResponse>): Promise<GameResponse | undefined> {
    return withCtx(ctx, async (tx) => {
      const [response] = await tx.update(gameResponses).set(updates)
        .where(and(eq(gameResponses.id, id), tenantFilter(ctx, gameResponses.tenantId)))
        .returning();
      return response || undefined;
    });
  }

  async getPlayerResponses(ctx: StorageCtx, gameId: number, playerName: string): Promise<GameResponse[]> {
    return withCtx(ctx, async (tx) => {
      return tx.select().from(gameResponses).where(and(
        eq(gameResponses.gameId, gameId),
        eq(gameResponses.playerName, playerName),
        tenantFilter(ctx, gameResponses.tenantId),
      ));
    });
  }

  async getLatestCompletedGame(ctx: StorageCtx): Promise<{ game: Game; players: any[]; totalQuestions: number } | undefined> {
    return withCtx(ctx, async (tx) => {
      const [latestGame] = await tx.select().from(games)
        .where(and(eq(games.status, "completed"), tenantFilter(ctx, games.tenantId)))
        .orderBy(desc(games.id))
        .limit(1);

      if (!latestGame) return undefined;

      const [quiz] = await tx.select().from(quizzes)
        .where(and(eq(quizzes.id, latestGame.quizId), tenantFilter(ctx, quizzes.tenantId)));
      if (!quiz) return undefined;

      const players = (latestGame.players as any[]) || [];
      const totalQuestions = (quiz.questions as any[])?.length || 0;

      return {
        game: latestGame,
        players: players.sort((a, b) => (b.score || 0) - (a.score || 0)),
        totalQuestions,
      };
    });
  }

  // Helper method to generate unique game PIN
  generateGamePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
```

Note the removed dynamic `await import("drizzle-orm")` calls — `and`/`desc` are now static imports.

- [ ] **Step 4: Update `MemStorage` in `server/storage.ts` to the same interface**

Apply the same signature change to every `MemStorage` method. The mechanical rules, followed by the complete non-trivial methods:

- Read methods filter: a row matches only if `("system" in ctx) || row.tenantId === ctx.tenantId`.
- Create methods for users/quizzes/games stamp `tenantId: requireTenantId(ctx)` (replacing the transitional `tenantId: 1` from Task 2).
- `createGameResponse` keeps the tenantId from the payload.
- Update/delete methods look the row up first and return `undefined`/`false`/throw when the tenant filter rejects it.

Add this private helper to `MemStorage`:

```ts
  private inTenant(ctx: StorageCtx, row: { tenantId: number }): boolean {
    return "system" in ctx || row.tenantId === ctx.tenantId;
  }
```

Complete replacements for every method:

```ts
  // Users
  async getUser(ctx: StorageCtx, id: number): Promise<User | undefined> {
    const user = this.users.get(id);
    return user && this.inTenant(ctx, user) ? user : undefined;
  }

  async getUserByUsername(ctx: StorageCtx, username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username && this.inTenant(ctx, user),
    );
  }

  async createUser(ctx: StorageCtx, insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id, tenantId: requireTenantId(ctx) };
    this.users.set(id, user);
    return user;
  }

  // Quizzes
  async getQuiz(ctx: StorageCtx, id: number): Promise<Quiz | undefined> {
    const quiz = this.quizzes.get(id);
    return quiz && this.inTenant(ctx, quiz) ? quiz : undefined;
  }

  async getQuizzes(ctx: StorageCtx): Promise<Quiz[]> {
    return Array.from(this.quizzes.values()).filter((q) => this.inTenant(ctx, q));
  }

  async getPublicQuizzes(ctx: StorageCtx): Promise<Quiz[]> {
    return Array.from(this.quizzes.values()).filter(
      (quiz) => quiz.isPublic && this.inTenant(ctx, quiz),
    );
  }

  async getUserQuizzes(ctx: StorageCtx, userId: number): Promise<Quiz[]> {
    return Array.from(this.quizzes.values()).filter(
      (quiz) => quiz.createdBy === userId && this.inTenant(ctx, quiz),
    );
  }

  async createQuiz(ctx: StorageCtx, quiz: InsertQuiz): Promise<Quiz> {
    const id = this.currentQuizId++;
    const newQuiz: Quiz = {
      id,
      tenantId: requireTenantId(ctx),
      title: quiz.title,
      description: quiz.description || null,
      questions: quiz.questions,
      background: quiz.background || "classroom",
      isPublic: quiz.isPublic ?? true,
      createdBy: quiz.createdBy,
      createdAt: new Date()
    };
    this.quizzes.set(id, newQuiz);
    return newQuiz;
  }

  async updateQuiz(ctx: StorageCtx, id: number, updates: Partial<InsertQuiz>): Promise<Quiz> {
    const existing = this.quizzes.get(id);
    if (!existing || !this.inTenant(ctx, existing)) {
      throw new Error("Quiz not found");
    }

    const updated: Quiz = {
      ...existing,
      ...updates,
      id: existing.id,
      tenantId: existing.tenantId,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt
    };

    this.quizzes.set(id, updated);
    return updated;
  }

  async deleteQuiz(ctx: StorageCtx, id: number): Promise<boolean> {
    const existing = this.quizzes.get(id);
    if (!existing || !this.inTenant(ctx, existing)) return false;
    return this.quizzes.delete(id);
  }

  // Games
  async getGame(ctx: StorageCtx, id: number): Promise<Game | undefined> {
    const game = this.games.get(id);
    return game && this.inTenant(ctx, game) ? game : undefined;
  }

  async getGameByPin(ctx: StorageCtx, pin: string): Promise<Game | undefined> {
    return Array.from(this.games.values()).find(
      (game) => game.gamePin === pin && this.inTenant(ctx, game),
    );
  }

  async createGame(ctx: StorageCtx, insertGame: InsertGame): Promise<Game> {
    const id = this.currentGameId++;
    const game: Game = {
      ...insertGame,
      id,
      tenantId: requireTenantId(ctx),
      currentQuestion: 0,
      players: [],
      createdAt: new Date()
    };
    this.games.set(id, game);
    return game;
  }

  async updateGame(ctx: StorageCtx, id: number, updates: Partial<Game>): Promise<Game | undefined> {
    const game = this.games.get(id);
    if (!game || !this.inTenant(ctx, game)) return undefined;

    const updatedGame = { ...game, ...updates };
    this.games.set(id, updatedGame);
    return updatedGame;
  }

  async deleteGame(ctx: StorageCtx, id: number): Promise<boolean> {
    const game = this.games.get(id);
    if (!game || !this.inTenant(ctx, game)) return false;
    return this.games.delete(id);
  }

  // Game Responses
  async getGameResponses(ctx: StorageCtx, gameId: number): Promise<GameResponse[]> {
    return Array.from(this.gameResponses.values()).filter(
      (response) => response.gameId === gameId && this.inTenant(ctx, response)
    );
  }

  async createGameResponse(ctx: StorageCtx, insertResponse: InsertGameResponse): Promise<GameResponse> {
    const id = this.currentResponseId++;
    const response: GameResponse = { ...insertResponse, id };
    this.gameResponses.set(id, response);
    return response;
  }

  async updateGameResponse(ctx: StorageCtx, id: number, updates: Partial<GameResponse>): Promise<GameResponse | undefined> {
    const response = this.gameResponses.get(id);
    if (!response || !this.inTenant(ctx, response)) return undefined;

    const updatedResponse = { ...response, ...updates };
    this.gameResponses.set(id, updatedResponse);
    return updatedResponse;
  }

  async getPlayerResponses(ctx: StorageCtx, gameId: number, playerName: string): Promise<GameResponse[]> {
    return Array.from(this.gameResponses.values()).filter(
      (response) => response.gameId === gameId && response.playerName === playerName && this.inTenant(ctx, response)
    );
  }

  async getLatestCompletedGame(ctx: StorageCtx): Promise<{ game: Game; players: any[]; totalQuestions: number } | undefined> {
    const completedGames = Array.from(this.games.values())
      .filter((game) => game.status === "completed" && this.inTenant(ctx, game))
      .sort((a, b) => b.id - a.id);

    if (completedGames.length === 0) return undefined;

    const latestGame = completedGames[0];
    const quiz = await this.getQuiz(ctx, latestGame.quizId);
    if (!quiz) return undefined;

    const players = (latestGame.players as any[]) || [];
    const totalQuestions = (quiz.questions as any[])?.length || 0;

    return {
      game: latestGame,
      players: players.sort((a, b) => (b.score || 0) - (a.score || 0)),
      totalQuestions
    };
  }
```

The `MemStorage` sample data keeps `tenantId: 1` (it belongs to the abraj tenant).

- [ ] **Step 5: Run storage tests**

Run: `npm test -- 2>&1 | head -40` (or `node --import tsx --test server/storage.test.ts`)
Expected: `server/storage.test.ts` PASSES. `game-room-manager.test.ts` FAILS to compile (next step). `routes.ts` breaks `npm run check` (step 7).

- [ ] **Step 6: Update `server/game-room-manager.ts` to system context**

1. Import: change line 2-3 area to also import the ctx symbols:

```ts
import { storage as defaultStorage, SYSTEM_CTX } from "./storage";
```

2. Add `tenantId: number;` to `interface RuntimeRoom` right after `gameId: number;` (line 24).
3. In `getOrCreateRoom` (line ~314): `const game = await this.storage.getGameByPin(gamePin);` → `const game = await this.storage.getGameByPin(SYSTEM_CTX, gamePin);` and `const quiz = await this.storage.getQuiz(game.quizId);` → `const quiz = await this.storage.getQuiz(SYSTEM_CTX, game.quizId);`
4. In the `room: RuntimeRoom = {` literal (line ~336): add `tenantId: game.tenantId,` after `gameId: game.id,`.
5. Line ~205: `await this.storage.updateGame(room.gameId, {` → `await this.storage.updateGame(SYSTEM_CTX, room.gameId, {`
6. Line ~285: `await this.storage.updateGame(room.gameId, { currentQuestion: nextQuestion });` → `await this.storage.updateGame(SYSTEM_CTX, room.gameId, { currentQuestion: nextQuestion });`
7. Line ~413: `await this.storage.createGameResponse({` → `await this.storage.createGameResponse(SYSTEM_CTX, {` and add `tenantId: room.tenantId,` as the first property inside that object literal.
8. Line ~458: `await this.storage.updateGame(room.gameId, {` → `await this.storage.updateGame(SYSTEM_CTX, room.gameId, {`

Also check `addPersistedPlayer`, `startGame`, `broadcastGameUpdated`, `submitAnswer`, `advanceQuestion` for any further `this.storage.` calls the greps above missed:

Run: `grep -n "this\.storage\." server/game-room-manager.ts`
Every hit must have a `StorageCtx` first argument (`SYSTEM_CTX`).

- [ ] **Step 7: Update `server/game-room-manager.test.ts` fixtures**

In `createRuntimeFixture()` (and any other fixture in the file — grep for `storage.create` and `storage.update`):

```ts
  const storage = new MemStorage();
  const game = await storage.createGame({ tenantId: 1 }, {
    quizId: 1,
    gamePin: "123456",
    hostId: 1,
    status: "waiting",
  });
  await storage.updateGame({ tenantId: 1 }, game.id, {
    players: [{ name: "Alice", score: 0 }],
  });
```

Apply the same `{ tenantId: 1 }` first argument to every other direct `storage.*` call in the test file.

Run: `node --import tsx --test server/game-room-manager.test.ts`
Expected: PASS.

- [ ] **Step 8: Update every storage call in `server/routes.ts`**

Add near the top of `registerRoutes` (after the `requireAuth` definition, line ~81):

```ts
  // Tenant context for the current request (tenantMiddleware guarantees req.tenant on /api).
  const tctx = (req: any): StorageCtx => ({ tenantId: (req.tenant as Tenant).id });
```

And extend the storage import (line 3):

```ts
import { storage, SYSTEM_CTX, type StorageCtx } from "./storage";
```

(`Tenant` is already imported from `@shared/schema` since Task 3.)

Then update every call site. Exact old → new:

| Line (pre-edit) | Old | New |
|---|---|---|
| 113 | `storage.getUserByUsername(username)` | `storage.getUserByUsername(tctx(req), username)` |
| 122 | `storage.createUser({` | `storage.createUser(tctx(req), {` |
| 151 | `storage.getUserByUsername(username)` | `storage.getUserByUsername(tctx(req), username)` |
| 216 | `storage.getPublicQuizzes()` | `storage.getPublicQuizzes(tctx(req))` |
| 226 | `storage.getQuiz(id)` | `storage.getQuiz(tctx(req), id)` |
| 240 | `storage.getUserQuizzes(userId)` | `storage.getUserQuizzes(tctx(req), userId)` |
| 413 | `storage.createQuiz({` | `storage.createQuiz(tctx(req), {` |
| 433 | `storage.getQuiz(quizId)` | `storage.getQuiz(tctx(req), quizId)` |
| 453 | `storage.updateQuiz(quizId, {` | `storage.updateQuiz(tctx(req), quizId, {` |
| 475 | `storage.getQuiz(quizId)` | `storage.getQuiz(tctx(req), quizId)` |
| 486 | `storage.getGameByPin(gamePin)` | `storage.getGameByPin(SYSTEM_CTX, gamePin)` — PIN collision check must be global |
| 499 | `storage.createGame(gameData)` | `storage.createGame(tctx(req), gameData)` |
| 511 | `storage.getGameByPin(pin)` | `storage.getGameByPin(tctx(req), pin)` |
| 532 | `storage.getGameByPin(pin)` | `storage.getGameByPin(tctx(req), pin)` |
| 549 | `storage.updateGame(game.id, { players: updatedPlayers })` | `storage.updateGame(tctx(req), game.id, { players: updatedPlayers })` |
| 569 | `storage.getGameByPin(pin)` | `storage.getGameByPin(tctx(req), pin)` |
| 621 | `storage.getGameByPin(pin)` | `storage.getGameByPin(tctx(req), pin)` |
| 644 | `storage.getGameByPin(pin)` | `storage.getGameByPin(tctx(req), pin)` |
| 650 | `storage.getQuiz(game.quizId)` | `storage.getQuiz(tctx(req), game.quizId)` |
| 651 | `storage.getGameResponses(game.id)` | `storage.getGameResponses(tctx(req), game.id)` |
| 684 | `storage.getGameByPin(pin)` | `storage.getGameByPin(tctx(req), pin)` |
| 693 | `storage.getGameResponses(game.id)` | `storage.getGameResponses(tctx(req), game.id)` |
| 735 | `storage.getLatestCompletedGame()` | `storage.getLatestCompletedGame(tctx(req))` |
| 745 | `storage.getQuiz(game.quizId)` | `storage.getQuiz(tctx(req), game.quizId)` |

After editing, verify no call was missed:

Run: `grep -n "storage\.\(get\|create\|update\|delete\)" server/routes.ts | grep -v "tctx(req)\|SYSTEM_CTX"`
Expected: no output.

- [ ] **Step 9: Full verification**

Run: `npm run check && npm test && npm run build`
Expected: all PASS.

- [ ] **Step 10: Manual smoke test**

`npm run dev`, then in a browser at `http://localhost:5173` (or the dev port): log in with an existing account, view quizzes, host a game, join as a player from a second tab, answer one question. Everything must behave exactly as before (all existing data is tenant 1 = abraj, and dev resolves to abraj).

- [ ] **Step 11: Commit**

```bash
git add server/storage.ts server/storage.test.ts server/game-room-manager.ts server/game-room-manager.test.ts server/routes.ts package.json
git commit -m "feat: thread tenant context through storage, game engine, and all API routes"
```

---

### Task 5: Dynamic CORS and WebSocket origins from tenant domains

Adding a tenant domain in the DB must allow that origin without a backend redeploy. Env `CLIENT_ORIGIN` remains as bootstrap/fallback (e.g. `*.vercel.app` preview origins).

**Files:**
- Create: `server/origins.ts`
- Modify: `server/index.ts:38-65`
- Modify: `server/websocket.ts` (InitializeOptions + isAllowedOrigin)
- Modify: `server/routes.ts` (initialize call)

**Interfaces:**
- Consumes: `tenantCache` from Task 3.
- Produces: `export const envOrigins: string[]`; `export function getAllowedOrigins(): string[]` (env union `https://<domain>` for every active tenant domain). `websocket.ts` `InitializeOptions` gains `getAllowedOrigins?: () => string[]`. The pure function `isOriginAllowed(allowedOrigins, origin, isProduction)` is unchanged (its tests stay green).

- [ ] **Step 1: Create `server/origins.ts`**

```ts
import { tenantCache } from "./tenant-cache";

export const envOrigins = (process.env.CLIENT_ORIGIN || process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Env origins are the bootstrap allowlist (Vercel preview URLs, local dev).
// Tenant custom domains come from the DB and update without a redeploy.
export function getAllowedOrigins(): string[] {
  return Array.from(new Set([...envOrigins, ...tenantCache.getAllOrigins()]));
}
```

- [ ] **Step 2: Use it in `server/index.ts`**

Replace lines 38-46 (the `allowedOrigins` const and the production guard) with:

```ts
if (process.env.NODE_ENV === "production" && envOrigins.length === 0) {
  throw new Error("CLIENT_ORIGIN must be set in production");
}
```

and add to the imports at the top of the file:

```ts
import { envOrigins, getAllowedOrigins } from "./origins";
```

In the CORS middleware (line ~51), change:

```ts
  if (origin && allowedOrigins.includes(origin)) {
```

to:

```ts
  if (origin && getAllowedOrigins().includes(origin)) {
```

- [ ] **Step 3: Dynamic origins for the WebSocket server**

In `server/websocket.ts`:

1. `InitializeOptions` (line ~23):

```ts
interface InitializeOptions {
  allowedOrigins?: string[];
  getAllowedOrigins?: () => string[];
  sessionMiddleware?: (req: any, res: any, next: (err?: unknown) => void) => void;
}
```

2. Add a provider field next to `private allowedOrigins: string[] = [];` (line ~45):

```ts
  private originProvider: () => string[] = () => this.allowedOrigins;
```

3. In `initialize(...)` right after `this.allowedOrigins = options.allowedOrigins || [];` (line ~54):

```ts
    this.originProvider = options.getAllowedOrigins ?? (() => this.allowedOrigins);
```

4. In the private `isAllowedOrigin` method (line ~282), change the first argument passed to the pure function from `this.allowedOrigins,` to `this.originProvider(),`. Leave the other arguments untouched.

- [ ] **Step 4: Pass the provider from `server/routes.ts`**

Add to imports: `import { getAllowedOrigins } from "./origins";`

Change line ~769:

```ts
  gameWS.initialize(httpServer, { sessionMiddleware, allowedOrigins, getAllowedOrigins });
```

- [ ] **Step 5: Verify and commit**

Run: `npm run check && npm test && npm run build`
Expected: PASS (including the unchanged `websocket.test.ts`).

```bash
git add server/origins.ts server/index.ts server/websocket.ts server/routes.ts
git commit -m "feat: allow CORS and WebSocket origins from tenant domains dynamically"
```

---

### Task 6: Server-side feature flag enforcement

**Files:**
- Modify: `server/routes.ts`

**Interfaces:**
- Consumes: `requireFeature` from `server/tenant.ts` (Task 3), `featuresSchema` (already imported in routes.ts since Task 3).
- Produces: AI-generation routes 403 when `features.aiGeneration` is false; `GET /api/quizzes` returns `[]` when `features.publicQuizzes` is false. (`pdfReports` is enforced client-side in Task 8 — PDF generation is a pure client operation with no server route.)

- [ ] **Step 1: Import requireFeature**

Extend the Task 3 import in `server/routes.ts`:

```ts
import { tenantMiddleware, requireFeature } from "./tenant";
```

- [ ] **Step 2: Gate the five AI routes**

Insert `requireFeature("aiGeneration"), ` after `requireAuth, ` in each of these route registrations:

- line ~268: `app.post("/api/generate-quiz/pdf", requireAuth, requireFeature("aiGeneration"), upload.single('pdf'), async (req, res) => {`
- line ~288: `app.post("/api/generate-quiz/url", requireAuth, requireFeature("aiGeneration"), async (req, res) => {`
- line ~317: `app.post("/api/generate-quiz/topics", requireAuth, requireFeature("aiGeneration"), async (req, res) => {`
- line ~339: `app.post("/api/generate-quiz/text", requireAuth, requireFeature("aiGeneration"), async (req, res) => {`
- line ~361: `app.post("/api/generate-background", requireAuth, requireFeature("aiGeneration"), async (req, res) => {`

- [ ] **Step 3: Gate public quiz listing**

In `GET /api/quizzes` (line ~213), add as the first lines of the `try` block:

```ts
      const features = featuresSchema.parse(((req as any).tenant?.features as object) ?? {});
      if (!features.publicQuizzes) {
        return res.json([]);
      }
```

- [ ] **Step 4: Manual verification**

With `npm run dev` running and a logged-in session:

```sql
-- In Supabase SQL editor (RLS not yet enabled at this point, direct update is fine):
update public.tenants set features = '{"aiGeneration": false}'::jsonb where slug = 'abraj';
```

Wait up to 60s for cache refresh (or restart dev). Try an AI generation from the UI. Expected: 403 "This feature is not enabled for your organization".
Revert: `update public.tenants set features = '{}'::jsonb where slug = 'abraj';`

- [ ] **Step 5: Verify and commit**

```bash
npm run check && npm test && npm run build
git add server/routes.ts
git commit -m "feat: enforce tenant feature flags on AI generation and public quiz routes"
```

---

### Task 7: Row Level Security — migration 0003

**DEPLOY GATE:** run this migration ONLY after the Task 4/5/6 backend is deployed (old code doesn't set the GUCs and would read zero rows). Locally, the dev server must already be on this branch.

**Files:**
- Create: `migrations/0003_rls.sql`

**Interfaces:**
- Consumes: GUCs `app.tenant_id` / `app.role` set by `withCtx` (Task 4) and the tenant-cache loader (Task 3).
- Produces: SQL functions `public.current_tenant_id()`, `public.is_system_context()`; RLS forced on all 6 tables; anon/authenticated grants revoked. This also closes the Supabase "RLS disabled" CRITICAL advisory — today anyone holding the project's anon key can read/write every table through the Supabase Data API.

- [ ] **Step 1: Write `migrations/0003_rls.sql`**

```sql
-- 0003_rls.sql — enforce tenant isolation in the database.
-- PREREQUISITE: backend running code from feat/multi-tenant (sets app.tenant_id / app.role GUCs).
-- NOTE for manual admin SQL after this migration: run
--   select set_config('app.role', 'system', false);
-- first in your session, or every business-table query returns 0 rows.
begin;

create or replace function public.current_tenant_id() returns integer
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::integer
$$;

create or replace function public.is_system_context() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.role', true), '') = 'system'
$$;

-- This app talks to Postgres directly; the Supabase Data API (PostgREST) is unused.
-- Revoke anon/authenticated so the anon key grants nothing, then force RLS as layer two.
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- users
alter table public.users enable row level security;
alter table public.users force row level security;
drop policy if exists tenant_isolation on public.users;
create policy tenant_isolation on public.users
  using (public.is_system_context() or tenant_id = public.current_tenant_id())
  with check (public.is_system_context() or tenant_id = public.current_tenant_id());

-- quizzes
alter table public.quizzes enable row level security;
alter table public.quizzes force row level security;
drop policy if exists tenant_isolation on public.quizzes;
create policy tenant_isolation on public.quizzes
  using (public.is_system_context() or tenant_id = public.current_tenant_id())
  with check (public.is_system_context() or tenant_id = public.current_tenant_id());

-- games
alter table public.games enable row level security;
alter table public.games force row level security;
drop policy if exists tenant_isolation on public.games;
create policy tenant_isolation on public.games
  using (public.is_system_context() or tenant_id = public.current_tenant_id())
  with check (public.is_system_context() or tenant_id = public.current_tenant_id());

-- game_responses
alter table public.game_responses enable row level security;
alter table public.game_responses force row level security;
drop policy if exists tenant_isolation on public.game_responses;
create policy tenant_isolation on public.game_responses
  using (public.is_system_context() or tenant_id = public.current_tenant_id())
  with check (public.is_system_context() or tenant_id = public.current_tenant_id());

-- tenants: only system context (backend cache loader, admin API) may touch the registry.
alter table public.tenants enable row level security;
alter table public.tenants force row level security;
drop policy if exists tenants_system_only on public.tenants;
create policy tenants_system_only on public.tenants
  using (public.is_system_context())
  with check (public.is_system_context());

-- session: accessed by connect-pg-simple outside tenant context; sids are unguessable.
-- RLS enabled with an open policy purely so anon-key access stays impossible
-- (privileges were revoked above; RLS blocks any future accidental re-grant).
alter table public.session enable row level security;
alter table public.session force row level security;
drop policy if exists session_open on public.session;
create policy session_open on public.session
  using (true)
  with check (true);

commit;
```

- [ ] **Step 2: Run migration 0003 in the Supabase SQL editor**

- [ ] **Step 3: Verify isolation with SQL (run as ONE batch in the SQL editor)**

```sql
select count(*) as no_ctx from public.quizzes;                         -- expect 0
select set_config('app.tenant_id', '1', false);
select count(*) as abraj from public.quizzes;                          -- expect current row count (14)
select set_config('app.tenant_id', '2', false);
select count(*) as pdo from public.quizzes;                            -- expect 0
select set_config('app.role', 'system', false);
select count(*) as system_sees_all from public.quizzes;                -- expect 14
```

- [ ] **Step 4: Verify the app still works end-to-end**

With `npm run dev` against the migrated database: log in, list quizzes, host + join + answer a full game round. Everything must work (the `withCtx` wrapper is now load-bearing).

- [ ] **Step 5: Verify the Supabase advisory cleared**

Supabase dashboard, Advisors: the "RLS disabled" critical advisory for these tables must be gone.

- [ ] **Step 6: Commit**

```bash
git add migrations/0003_rls.sql
git commit -m "feat: enforce tenant isolation with forced RLS policies and anon revocation"
```

---

### Task 8: Client TenantProvider — dynamic branding, title, favicon, feature gating

**Files:**
- Create: `client/src/lib/tenant.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/navigation.tsx`
- Modify: `client/src/pages/login.tsx:69`
- Modify: `client/src/pages/home.tsx:177,469`
- Modify: `client/src/pages/create-quiz.tsx` (AI tab gating)
- Modify: `client/index.html` (neutral title)

**Interfaces:**
- Consumes: `GET /api/tenant/config` (Task 3).
- Produces: `TenantProvider` component; `useTenant(): TenantConfig` where `TenantConfig = { slug: string; name: string; branding: {...}; features: { aiGeneration; pdfReports; publicQuizzes } }`; `DEFAULT_TENANT_CONFIG` (abraj values, used until the fetch resolves and as offline fallback).

- [ ] **Step 1: Create `client/src/lib/tenant.tsx`**

```tsx
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export interface TenantConfig {
  slug: string;
  name: string;
  branding: {
    appName: string;
    logoUrl: string;
    faviconUrl: string;
    colors: { primary: string; secondary: string };
    pdf: { headerText: string; footerText: string; primaryColor: number[] };
    emailFromName: string;
  };
  features: { aiGeneration: boolean; pdfReports: boolean; publicQuizzes: boolean };
}

export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  slug: "abraj",
  name: "Abraj Quiz",
  branding: {
    appName: "Abraj Quiz",
    logoUrl: "",
    faviconUrl: "",
    colors: { primary: "hsl(184, 100%, 47%)", secondary: "hsl(184, 85%, 35%)" },
    pdf: {
      headerText: "ABRAJ QUIZ COMPLETE REPORT",
      footerText: "© 2025 Abraj Quiz Platform",
      primaryColor: [1, 158, 189],
    },
    emailFromName: "",
  },
  features: { aiGeneration: true, pdfReports: true, publicQuizzes: true },
};

const TenantContext = createContext<TenantConfig>(DEFAULT_TENANT_CONFIG);

export function useTenant(): TenantConfig {
  return useContext(TenantContext);
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery<TenantConfig>({ queryKey: ["/api/tenant/config"] });
  const tenant = data ?? DEFAULT_TENANT_CONFIG;

  useEffect(() => {
    const root = document.documentElement;
    // The whole UI is already styled via these variables (client/src/index.css:28-34).
    root.style.setProperty("--abraj-primary", tenant.branding.colors.primary);
    root.style.setProperty("--abraj-secondary", tenant.branding.colors.secondary);
    document.title = tenant.branding.appName;
    if (tenant.branding.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = tenant.branding.faviconUrl;
    }
  }, [tenant]);

  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}
```

- [ ] **Step 2: Wrap the app in `client/src/App.tsx`**

Add import: `import { TenantProvider } from "@/lib/tenant";`

Change the `App` component body:

```tsx
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <TooltipProvider>
          <div className="min-h-screen relative">
            {/* Classroom background */}
            <div
              className="classroom-background"
              style={{ backgroundImage: `url(${classroomBg})` }}
            />

            {/* Content */}
            <div className="relative z-10">
              <Navigation />
              <Router />
            </div>
            <Toaster />
          </div>
        </TooltipProvider>
      </TenantProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3: Tenant-aware navigation**

In `client/src/components/navigation.tsx`:

1. Add import: `import { useTenant } from "@/lib/tenant";`
2. Inside the component, after the `useAuth()` line (line ~10): `const tenant = useTenant();`
3. Line ~21: `src={abrajLogo}` becomes `src={tenant.branding.logoUrl || abrajLogo}`
4. Line ~22: `alt="Abraj Quiz Logo"` becomes `alt={tenant.branding.appName + " Logo"}`
5. Line ~25: `<h1 className="font-bold text-2xl text-gray-800">Abraj Quiz</h1>` becomes `<h1 className="font-bold text-2xl text-gray-800">{tenant.branding.appName}</h1>`

- [ ] **Step 4: Tenant-aware copy in login and home**

`client/src/pages/login.tsx`: add the import and `const tenant = useTenant();` inside the component; line 69:

```tsx
          <p className="text-gray-600">Sign in to your {tenant.branding.appName} account</p>
```

`client/src/pages/home.tsx`: add the import and `const tenant = useTenant();` inside the component that renders each line (check which component encloses lines 177 and 469 — if they are different components, add the hook to both).

Line 177:

```tsx
              <p className="mt-6 text-gray-600 max-w-2xl mx-auto text-[13px]">{tenant.name}'s innovative team works tirelessly to create engaging educational experiences for learners worldwide.</p>
```

Line 469:

```tsx
            <p>© {new Date().getFullYear()} {tenant.branding.appName}. All rights reserved.</p>
```

- [ ] **Step 5: Gate the AI tab in `client/src/pages/create-quiz.tsx`**

Add the import and `const tenant = useTenant();` in the page component. Line 673:

```tsx
            {tenant.features.aiGeneration && (
              <TabsTrigger value="generate" className="ml-[8px] mr-[8px] pt-[5px] pb-[5px] data-[state=active]:bg-[#019ebd] data-[state=active]:text-white">Auto Generate</TabsTrigger>
            )}
```

Then find the matching content block: run `grep -n "TabsContent value=\"generate\"" client/src/pages/create-quiz.tsx` and wrap that entire `<TabsContent value="generate" ...>...</TabsContent>` element the same way:

```tsx
          {tenant.features.aiGeneration && (
            /* existing <TabsContent value="generate" ...> element, children unchanged */
          )}
```

- [ ] **Step 6: Neutral fallback title in `client/index.html`**

```html
    <title>Quiz</title>
```

(TenantProvider sets the real name as soon as config loads; a neutral fallback avoids flashing "Abraj Quiz" on pdoquiz.com.)

- [ ] **Step 7: Verify both tenants render**

`npm run dev`: UI shows Abraj branding exactly as before (defaults).
Stop, then run with the PDO fallback tenant:

```bash
cross-env DEFAULT_TENANT_SLUG=pdo npm run dev
```

Expected: nav title "PDO Quiz", primary color switches to the seeded PDO red, browser tab title "PDO Quiz".

- [ ] **Step 8: Verify and commit**

```bash
npm run check && npm test && npm run build
git add client/src/lib/tenant.tsx client/src/App.tsx client/src/components/navigation.tsx client/src/pages/login.tsx client/src/pages/home.tsx client/src/pages/create-quiz.tsx client/index.html
git commit -m "feat: tenant-aware branding, theming, and feature gating in the client"
```

---

### Task 9: Tenant-branded PDF reports

**Files:**
- Modify: `client/src/utils/enhanced-pdf-generator.ts`
- Modify: `client/src/utils/quiz-pdf-generator.ts`
- Modify: `client/src/lib/tenant.tsx` (branding-to-PDF helper)
- Modify: `client/src/pages/game-results.tsx:50-51`
- Modify: `client/src/pages/quiz-pdf.tsx:44`
- Modify: `client/src/pages/create-quiz.tsx:635`

**Interfaces:**
- Consumes: `TenantConfig`, `useTenant` from Task 8.
- Produces:
  - In `enhanced-pdf-generator.ts`: `export interface PdfBranding { appName: string; headerText: string; footerText: string; primaryColor: number[]; logoDataUrl?: string }`; signature becomes `generateEnhancedPDF(data: PdfData, branding?: PdfBranding)`. Omitted branding = current Abraj output.
  - In `quiz-pdf-generator.ts`: `QuizPDFOptions` gains `branding?: PdfBranding`.
  - In `tenant.tsx`: `export async function tenantPdfBranding(tenant: TenantConfig): Promise<PdfBranding>` — resolves `branding.logoUrl` to a data URL (passthrough for `data:` URLs, fetch + FileReader for http(s), `undefined` on failure so the bundled logo is used).

- [ ] **Step 1: Add `PdfBranding` + parameter to `enhanced-pdf-generator.ts`**

At the top (after existing imports):

```ts
export interface PdfBranding {
  appName: string;
  headerText: string;
  footerText: string;
  primaryColor: number[];
  logoDataUrl?: string;
}
```

Change line 18: `export const generateEnhancedPDF = async (data: PdfData) => {` becomes `export const generateEnhancedPDF = async (data: PdfData, branding?: PdfBranding) => {`

Line 31: `primary: [1, 158, 189], // Abraj turquoise` becomes `primary: (branding?.primaryColor ?? [1, 158, 189]) as [number, number, number], // tenant primary`

Logo block (line ~86-92): replace `pdf.addImage(logo, 'PNG', 20, yPosition, logoWidth, logoHeight);` with:

```ts
    const logoData = branding?.logoDataUrl || logo;
    const logoFormat = typeof logoData === "string" && logoData.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
    pdf.addImage(logoData, logoFormat, 20, yPosition, logoWidth, logoHeight);
```

Line 99: `pdf.text('ABRAJ QUIZ COMPLETE REPORT', ...)` becomes `pdf.text(branding?.headerText ?? 'ABRAJ QUIZ COMPLETE REPORT', ...)` (keep the position arguments unchanged).

Line 557: replace so it reads:

```ts
  pdf.text(`Generated by ${branding?.appName ?? 'Abraj Quiz'} System - ${currentTheme.name}`, 25, yPosition + 6);
```

Line 563: `pdf.text('© 2025 Abraj Quiz Platform - Enhancing Education Through Interactive Technology', 25, yPosition + 15);` becomes `pdf.text(branding?.footerText ?? '© 2025 Abraj Quiz Platform - Enhancing Education Through Interactive Technology', 25, yPosition + 15);`

- [ ] **Step 2: Add branding to `quiz-pdf-generator.ts`**

Add import: `import type { PdfBranding } from "./enhanced-pdf-generator";`

Add `branding?: PdfBranding;` to the `QuizPDFOptions` interface (locate with `grep -n "interface QuizPDFOptions" client/src/utils/quiz-pdf-generator.ts`).

Line 87: change the footer template so the literal `© 2025 Abraj Quiz Platform` becomes `${options.branding?.footerText ?? '© 2025 Abraj Quiz Platform'}` (the surrounding `Quiz created on ${creationDate} • ` stays).

Find the logo usage: `grep -n "addImage" client/src/utils/quiz-pdf-generator.ts` and apply the same `options.branding?.logoDataUrl || logo` + format-detection substitution as Step 1 at each hit.

Find remaining hardcoded strings: `grep -in "abraj" client/src/utils/quiz-pdf-generator.ts` — replace each remaining `Abraj Quiz` text occurrence with `${options.branding?.appName ?? 'Abraj Quiz'}` (inside template literals) or `(options.branding?.appName ?? 'Abraj Quiz')` (string concatenation), preserving the surrounding text.

- [ ] **Step 3: Add `tenantPdfBranding` helper to `client/src/lib/tenant.tsx`**

```tsx
import type { PdfBranding } from "@/utils/enhanced-pdf-generator";

async function resolveLogoDataUrl(url: string): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined; // caller falls back to the bundled logo
  }
}

export async function tenantPdfBranding(tenant: TenantConfig): Promise<PdfBranding> {
  return {
    appName: tenant.branding.appName,
    headerText: tenant.branding.pdf.headerText,
    footerText: tenant.branding.pdf.footerText,
    primaryColor: tenant.branding.pdf.primaryColor,
    logoDataUrl: await resolveLogoDataUrl(tenant.branding.logoUrl),
  };
}
```

- [ ] **Step 4: Pass branding at the three call sites**

`client/src/pages/game-results.tsx` — add imports `useTenant, tenantPdfBranding` from `@/lib/tenant`, add `const tenant = useTenant();` in the component, then lines 50-51:

```ts
      const { generateEnhancedPDF } = await import('@/utils/enhanced-pdf-generator');
      await generateEnhancedPDF(results, await tenantPdfBranding(tenant));
```

`client/src/pages/quiz-pdf.tsx` — same imports + hook; in the `generateQuizPDF(quiz, {` options object (line 44), add:

```ts
        branding: await tenantPdfBranding(tenant),
```

`client/src/pages/create-quiz.tsx` — `const tenant = useTenant();` already exists (Task 8); add `import { tenantPdfBranding } from "@/lib/tenant";` and the same `branding: await tenantPdfBranding(tenant),` property into the options object at line 635 (the enclosing function already awaits `generateQuizPDF`, so it is async).

- [ ] **Step 5: Verify**

`npm run check && npm run build`. Then in the dev app: complete a game, download the results PDF — identical to before (abraj defaults). Restart with `DEFAULT_TENANT_SLUG=pdo`, generate a quiz PDF — header/footer/color reflect the PDO seed values.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/enhanced-pdf-generator.ts client/src/utils/quiz-pdf-generator.ts client/src/lib/tenant.tsx client/src/pages/game-results.tsx client/src/pages/quiz-pdf.tsx client/src/pages/create-quiz.tsx
git commit -m "feat: tenant-branded PDF reports"
```

---

### Task 10: Super admin — migration 0004, tenant CRUD storage, admin API

**Files:**
- Create: `migrations/0004_admin_hardening.sql`
- Modify: `shared/schema.ts` (users.isSuperAdmin; remove transitional `.default(1)` from tenantId columns)
- Modify: `server/storage.ts` (tenant CRUD on IStorage + both implementations; MemStorage isSuperAdmin)
- Modify: `server/storage.test.ts`
- Create: `server/admin-routes.ts`
- Modify: `server/routes.ts` (register admin routes)

**Interfaces:**
- Consumes: `insertTenantSchema`, `Tenant`, `InsertTenant` (Task 1); `SYSTEM_CTX`, `StorageCtx` (Task 4); `tenantCache` (Task 3).
- Produces:
  - `users.isSuperAdmin: boolean` (`is_super_admin`, default false).
  - IStorage additions: `getTenants(ctx): Promise<Tenant[]>`, `getTenant(ctx, id: number): Promise<Tenant | undefined>`, `createTenant(ctx, tenant: InsertTenant): Promise<Tenant>`, `updateTenant(ctx, id: number, updates: Partial<InsertTenant>): Promise<Tenant | undefined>` — all four throw `Error("System context required")` unless ctx is system.
  - Routes: `GET /api/admin/tenants`, `POST /api/admin/tenants`, `PATCH /api/admin/tenants/:id` — 401 unauthenticated, 403 non-super-admin. Mutations call `tenantCache.refresh()`.

- [ ] **Step 1: Write failing tests — append to `server/storage.test.ts`**

```ts
test("tenant CRUD requires system context", async () => {
  const s = new MemStorage();
  await assert.rejects(
    () => s.createTenant(T1, { slug: "acme", name: "Acme", domains: [], branding: {}, features: {}, status: "active" }),
    /System context required/,
  );
  const t = await s.createTenant(SYSTEM_CTX, {
    slug: "acme", name: "Acme", domains: ["acmequiz.com"], branding: {}, features: {}, status: "active",
  });
  assert.ok(t.id > 0);
  assert.ok((await s.getTenants(SYSTEM_CTX)).some((x) => x.slug === "acme"));
  const updated = await s.updateTenant(SYSTEM_CTX, t.id, { name: "Acme Inc" });
  assert.equal(updated?.name, "Acme Inc");
  assert.equal((await s.getTenant(SYSTEM_CTX, t.id))?.name, "Acme Inc");
});

test("createUser defaults isSuperAdmin to false", async () => {
  const s = new MemStorage();
  const u = await s.createUser(T1, { username: "regular", password: "x" });
  assert.equal(u.isSuperAdmin, false);
});
```

Run: `npm test`
Expected: FAIL — `createTenant` does not exist / `isSuperAdmin` missing.

- [ ] **Step 2: Schema changes in `shared/schema.ts`**

1. In `users`, add after `tenantId`:

```ts
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
```

2. Remove the transitional `.default(1)` from all four `tenantId` column definitions (users, quizzes, games, gameResponses), leaving:

```ts
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
```

(All inserts have passed tenantId explicitly since Task 4; migration 0004 drops the DB-side default to match.)

- [ ] **Step 3: Storage implementations in `server/storage.ts`**

Extend the schema import with `tenants, type Tenant, type InsertTenant`.

Add to `IStorage` (after the Latest Game Results block):

```ts
  // Tenants (system context only — used by the super-admin API)
  getTenants(ctx: StorageCtx): Promise<Tenant[]>;
  getTenant(ctx: StorageCtx, id: number): Promise<Tenant | undefined>;
  createTenant(ctx: StorageCtx, tenant: InsertTenant): Promise<Tenant>;
  updateTenant(ctx: StorageCtx, id: number, updates: Partial<InsertTenant>): Promise<Tenant | undefined>;
```

Add a module-level guard next to `requireTenantId`:

```ts
function requireSystem(ctx: StorageCtx): void {
  if (!("system" in ctx)) {
    throw new Error("System context required");
  }
}
```

`DatabaseStorage` additions:

```ts
  // Tenants
  async getTenants(ctx: StorageCtx): Promise<Tenant[]> {
    requireSystem(ctx);
    return withCtx(ctx, async (tx) => tx.select().from(tenants));
  }

  async getTenant(ctx: StorageCtx, id: number): Promise<Tenant | undefined> {
    requireSystem(ctx);
    return withCtx(ctx, async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, id));
      return tenant || undefined;
    });
  }

  async createTenant(ctx: StorageCtx, insertTenant: InsertTenant): Promise<Tenant> {
    requireSystem(ctx);
    return withCtx(ctx, async (tx) => {
      const [tenant] = await tx.insert(tenants).values(insertTenant).returning();
      return tenant;
    });
  }

  async updateTenant(ctx: StorageCtx, id: number, updates: Partial<InsertTenant>): Promise<Tenant | undefined> {
    requireSystem(ctx);
    return withCtx(ctx, async (tx) => {
      const [tenant] = await tx.update(tenants).set(updates).where(eq(tenants.id, id)).returning();
      return tenant || undefined;
    });
  }
```

`MemStorage` additions — new fields in the class + constructor:

```ts
  private tenants: Map<number, Tenant> = new Map();
  private currentTenantId = 1;
```

Methods:

```ts
  // Tenants
  async getTenants(ctx: StorageCtx): Promise<Tenant[]> {
    requireSystem(ctx);
    return Array.from(this.tenants.values());
  }

  async getTenant(ctx: StorageCtx, id: number): Promise<Tenant | undefined> {
    requireSystem(ctx);
    return this.tenants.get(id);
  }

  async createTenant(ctx: StorageCtx, insertTenant: InsertTenant): Promise<Tenant> {
    requireSystem(ctx);
    const id = this.currentTenantId++;
    const tenant: Tenant = {
      id,
      slug: insertTenant.slug,
      name: insertTenant.name,
      domains: insertTenant.domains ?? [],
      branding: insertTenant.branding ?? {},
      features: insertTenant.features ?? {},
      status: insertTenant.status ?? "active",
      createdAt: new Date(),
    };
    this.tenants.set(id, tenant);
    return tenant;
  }

  async updateTenant(ctx: StorageCtx, id: number, updates: Partial<InsertTenant>): Promise<Tenant | undefined> {
    requireSystem(ctx);
    const existing = this.tenants.get(id);
    if (!existing) return undefined;
    const updated: Tenant = { ...existing, ...updates, id: existing.id, createdAt: existing.createdAt };
    this.tenants.set(id, updated);
    return updated;
  }
```

Also update `MemStorage` for the new `isSuperAdmin` column:
- sample user literal: add `isSuperAdmin: false,`
- `createUser`: `const user: User = { ...insertUser, id, tenantId: requireTenantId(ctx), isSuperAdmin: false };`

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Create `server/admin-routes.ts`**

```ts
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage, SYSTEM_CTX } from "./storage";
import { insertTenantSchema } from "@shared/schema";
import { tenantCache } from "./tenant-cache";

// Super admins manage the tenant registry across all tenants (system context).
export function registerAdminRoutes(app: Express) {
  const requireSuperAdmin = async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).session?.userId as number | undefined;
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(SYSTEM_CTX, userId);
    if (!user?.isSuperAdmin) {
      return res.status(403).json({ message: "Super admin required" });
    }
    next();
  };

  app.get("/api/admin/tenants", requireSuperAdmin, async (_req, res) => {
    try {
      res.json(await storage.getTenants(SYSTEM_CTX));
    } catch (error) {
      console.error("Failed to list tenants:", error);
      res.status(500).json({ message: "Failed to list tenants" });
    }
  });

  app.post("/api/admin/tenants", requireSuperAdmin, async (req, res) => {
    try {
      const validation = insertTenantSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid tenant data", errors: validation.error.errors });
      }
      const tenant = await storage.createTenant(SYSTEM_CTX, validation.data);
      await tenantCache.refresh();
      res.status(201).json(tenant);
    } catch (error) {
      console.error("Failed to create tenant:", error);
      res.status(500).json({ message: "Failed to create tenant" });
    }
  });

  app.patch("/api/admin/tenants/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = z.coerce.number().int().positive().safeParse(req.params.id);
      if (!id.success) {
        return res.status(400).json({ message: "Invalid tenant id" });
      }
      const validation = insertTenantSchema.partial().safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid tenant data", errors: validation.error.errors });
      }
      const tenant = await storage.updateTenant(SYSTEM_CTX, id.data, validation.data);
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }
      await tenantCache.refresh();
      res.json(tenant);
    } catch (error) {
      console.error("Failed to update tenant:", error);
      res.status(500).json({ message: "Failed to update tenant" });
    }
  });
}
```

- [ ] **Step 6: Register in `server/routes.ts`**

Add import: `import { registerAdminRoutes } from "./admin-routes";`

Immediately after the `/api/tenant/config` route registration (Task 3), add:

```ts
  registerAdminRoutes(app);
```

- [ ] **Step 7: Write `migrations/0004_admin_hardening.sql`**

```sql
-- 0004_admin_hardening.sql — super admin flag + drop transitional tenant_id defaults.
-- Run after the Task-10 backend deploy. All inserts now set tenant_id explicitly.
begin;

alter table public.users add column if not exists is_super_admin boolean not null default false;

alter table public.users          alter column tenant_id drop default;
alter table public.quizzes        alter column tenant_id drop default;
alter table public.games          alter column tenant_id drop default;
alter table public.game_responses alter column tenant_id drop default;

commit;
```

- [ ] **Step 8: Run migration 0004, promote your super admin**

Run 0004 in the Supabase SQL editor, then (one batch — the GUC is needed post-RLS):

```sql
select set_config('app.role', 'system', false);
update public.users set is_super_admin = true
 where tenant_id = 1 and username = 'YOUR_ADMIN_USERNAME';  -- your real abraj username
select username, is_super_admin from public.users where is_super_admin;
```

- [ ] **Step 9: Manual verification**

Dev server up, logged in as the promoted user: `GET /api/admin/tenants` returns both tenants. Logged in as any other user: 403. Logged out: 401.

- [ ] **Step 10: Verify and commit**

```bash
npm run check && npm test && npm run build
git add shared/schema.ts server/storage.ts server/storage.test.ts server/admin-routes.ts server/routes.ts migrations/0004_admin_hardening.sql
git commit -m "feat: super admin flag and tenant management API"
```

---

### Task 11: Super admin panel UI

**Files:**
- Create: `client/src/pages/admin-tenants.tsx`
- Modify: `client/src/App.tsx` (route)

**Interfaces:**
- Consumes: `GET/POST/PATCH /api/admin/tenants` (Task 10); `apiRequest`, `queryClient` from `@/lib/queryClient`; shadcn `Button`, `Input`, `Card` components already in `client/src/components/ui/`.
- Produces: page at `/admin/tenants` (no nav link — super admins navigate directly; non-admins see the API's 403 message).

- [ ] **Step 1: Create `client/src/pages/admin-tenants.tsx`**

```tsx
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface AdminTenant {
  id: number;
  slug: string;
  name: string;
  domains: string[];
  branding: Record<string, any>;
  features: Record<string, any>;
  status: string;
}

interface TenantFormState {
  slug: string;
  name: string;
  domains: string; // comma-separated in the form
  appName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  faviconUrl: string;
  aiGeneration: boolean;
  pdfReports: boolean;
  publicQuizzes: boolean;
  status: string;
}

function toFormState(t: AdminTenant): TenantFormState {
  return {
    slug: t.slug,
    name: t.name,
    domains: (t.domains ?? []).join(", "),
    appName: t.branding?.appName ?? t.name,
    primaryColor: t.branding?.colors?.primary ?? "",
    secondaryColor: t.branding?.colors?.secondary ?? "",
    logoUrl: t.branding?.logoUrl ?? "",
    faviconUrl: t.branding?.faviconUrl ?? "",
    aiGeneration: t.features?.aiGeneration ?? true,
    pdfReports: t.features?.pdfReports ?? true,
    publicQuizzes: t.features?.publicQuizzes ?? true,
    status: t.status,
  };
}

function toPayload(form: TenantFormState) {
  return {
    slug: form.slug.trim(),
    name: form.name.trim(),
    domains: form.domains.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
    branding: {
      appName: form.appName.trim(),
      ...(form.primaryColor || form.secondaryColor
        ? { colors: { ...(form.primaryColor ? { primary: form.primaryColor } : {}), ...(form.secondaryColor ? { secondary: form.secondaryColor } : {}) } }
        : {}),
      ...(form.logoUrl ? { logoUrl: form.logoUrl } : {}),
      ...(form.faviconUrl ? { faviconUrl: form.faviconUrl } : {}),
    },
    features: {
      aiGeneration: form.aiGeneration,
      pdfReports: form.pdfReports,
      publicQuizzes: form.publicQuizzes,
    },
    status: form.status,
  };
}

const EMPTY_FORM: TenantFormState = {
  slug: "", name: "", domains: "", appName: "", primaryColor: "", secondaryColor: "",
  logoUrl: "", faviconUrl: "", aiGeneration: true, pdfReports: true, publicQuizzes: true,
  status: "active",
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function TenantForm({
  form, setForm, onSubmit, submitLabel, disableSlug,
}: {
  form: TenantFormState;
  setForm: (f: TenantFormState) => void;
  onSubmit: () => void;
  submitLabel: string;
  disableSlug?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <label className="text-sm font-medium">Slug
        <Input value={form.slug} disabled={disableSlug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="acme" />
      </label>
      <label className="text-sm font-medium">Company name
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Inc" />
      </label>
      <label className="text-sm font-medium">Domains (comma-separated hostnames)
        <Input value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} placeholder="acmequiz.com, www.acmequiz.com" />
      </label>
      <label className="text-sm font-medium">App name (shown in nav, title, PDFs)
        <Input value={form.appName} onChange={(e) => setForm({ ...form, appName: e.target.value })} placeholder="Acme Quiz" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium">Primary color (CSS value)
          <Input value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} placeholder="hsl(184, 100%, 47%)" />
        </label>
        <label className="text-sm font-medium">Secondary color
          <Input value={form.secondaryColor} onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })} placeholder="hsl(184, 85%, 35%)" />
        </label>
      </div>
      <label className="text-sm font-medium">Logo (stored as data URL)
        <Input type="file" accept="image/png,image/jpeg"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setForm({ ...form, logoUrl: await readFileAsDataUrl(file) });
          }} />
        {form.logoUrl && <img src={form.logoUrl} alt="logo preview" className="h-10 mt-1" />}
      </label>
      <label className="text-sm font-medium">Favicon (stored as data URL)
        <Input type="file" accept="image/png,image/x-icon,image/svg+xml"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setForm({ ...form, faviconUrl: await readFileAsDataUrl(file) });
          }} />
      </label>
      <fieldset className="flex gap-4 text-sm">
        <label><input type="checkbox" checked={form.aiGeneration}
          onChange={(e) => setForm({ ...form, aiGeneration: e.target.checked })} /> AI generation</label>
        <label><input type="checkbox" checked={form.pdfReports}
          onChange={(e) => setForm({ ...form, pdfReports: e.target.checked })} /> PDF reports</label>
        <label><input type="checkbox" checked={form.publicQuizzes}
          onChange={(e) => setForm({ ...form, publicQuizzes: e.target.checked })} /> Public quizzes</label>
      </fieldset>
      <label className="text-sm font-medium">Status
        <select className="block border rounded px-2 py-1 mt-1" value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="active">active</option>
          <option value="suspended">suspended</option>
        </select>
      </label>
      <Button className="abraj-primary text-white" onClick={onSubmit}>{submitLabel}</Button>
    </div>
  );
}

export default function AdminTenants() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<{ id: number; form: TenantFormState } | null>(null);
  const [createForm, setCreateForm] = useState<TenantFormState>(EMPTY_FORM);

  const { data: tenantList, error, isLoading } = useQuery<AdminTenant[]>({
    queryKey: ["/api/admin/tenants"],
  });

  const createMutation = useMutation({
    mutationFn: (payload: object) => apiRequest("POST", "/api/admin/tenants", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] });
      setCreateForm(EMPTY_FORM);
      toast({ title: "Tenant created" });
    },
    onError: (err: Error) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: object }) =>
      apiRequest("PATCH", `/api/admin/tenants/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] });
      setEditing(null);
      toast({ title: "Tenant updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="p-8">Loading…</div>;
  if (error) {
    return (
      <div className="p-8 text-red-600">
        {String((error as any)?.response?.data?.message || error.message)} — super admin access is required.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Tenant Management</h1>

      {(tenantList ?? []).map((t) => (
        <Card key={t.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              {t.name} <span className="text-sm font-normal text-gray-500">({t.slug} · {t.status})</span>
            </CardTitle>
            <Button variant="outline" onClick={() =>
              setEditing(editing?.id === t.id ? null : { id: t.id, form: toFormState(t) })
            }>
              {editing?.id === t.id ? "Cancel" : "Edit"}
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-3">Domains: {(t.domains ?? []).join(", ") || "—"}</p>
            {editing?.id === t.id && (
              <TenantForm
                form={editing.form}
                setForm={(form) => setEditing({ id: t.id, form })}
                disableSlug
                submitLabel={updateMutation.isPending ? "Saving…" : "Save changes"}
                onSubmit={() => updateMutation.mutate({ id: t.id, payload: toPayload(editing.form) })}
              />
            )}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader><CardTitle>Create tenant</CardTitle></CardHeader>
        <CardContent>
          <TenantForm
            form={createForm}
            setForm={setCreateForm}
            submitLabel={createMutation.isPending ? "Creating…" : "Create tenant"}
            onSubmit={() => createMutation.mutate(toPayload(createForm))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

Note: if `client/src/hooks/use-toast.ts` does not exist, check the actual path with `grep -rn "useToast" client/src/hooks client/src/components/ui | head -3` and match the import used elsewhere in the codebase.

- [ ] **Step 2: Add the route in `client/src/App.tsx`**

Lazy import with the others:

```tsx
const AdminTenants = lazy(() => import("@/pages/admin-tenants"));
```

Route (before the catch-all `<Route component={NotFound} />`):

```tsx
        <Route path="/admin/tenants" component={AdminTenants} />
```

- [ ] **Step 3: Manual verification**

Dev server, logged in as super admin, visit `/admin/tenants`:
- Both tenants listed with domains.
- Edit PDO: change primary color, save — within 60s (or immediately after the cache refresh triggered by the PATCH) `DEFAULT_TENANT_SLUG=pdo` dev UI reflects it.
- Create a throwaway tenant `acme` → appears in list → suspend it (status) → save.
- Log in as a non-admin → `/admin/tenants` shows the 403 message.

- [ ] **Step 4: Verify and commit**

```bash
npm run check && npm test && npm run build
git add client/src/pages/admin-tenants.tsx client/src/App.tsx
git commit -m "feat: super admin tenant management panel"
```

---

### Task 12: Deployment docs, env template, repo docs

**Files:**
- Create: `docs/DEPLOYMENT_MULTI_TENANT.md`
- Modify: `.env.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create `docs/DEPLOYMENT_MULTI_TENANT.md`**

````markdown
# Multi-Tenant Deployment

## Topology

- ONE backend (Render or similar persistent Node host) serving ALL tenants.
- ONE Supabase Postgres (project bvtbjijbebhubowvhbrp) with forced RLS tenant isolation.
- ONE Vercel project PER TENANT DOMAIN, all importing the same GitHub repo
  (haithamlamki/Abraj_Quiz). Static frontend only — the backend NEVER deploys to Vercel.

Tenant resolution is by request Origin/Host hostname against tenants.domains.
The frontend is tenant-agnostic at build time; branding loads at runtime from
GET /api/tenant/config.

## Production migration runbook (order matters)

1. `migrations/0001_tenants.sql` and `migrations/0002_tenant_id.sql` in the Supabase
   SQL editor. Both are backward compatible with the live pre-multi-tenant backend
   (tenant_id has DEFAULT 1 until 0004).
2. Deploy the backend from the feature branch (Tasks 1-6 code minimum). Smoke test
   abrajquiz production: login, quizzes list, host+join a game.
3. `migrations/0003_rls.sql`. Re-run the smoke test immediately. Rollback if broken (below).
4. Deploy the Task 10/11 backend+frontend, then `migrations/0004_admin_hardening.sql`.
5. Promote your super admin (single SQL batch):
   ```sql
   select set_config('app.role', 'system', false);
   update public.users set is_super_admin = true
    where tenant_id = 1 and username = 'YOUR_ADMIN_USERNAME';
   ```
6. Verify tenant domains in the tenants table match reality (edit at /admin/tenants).

### RLS rollback (emergency only)

```sql
alter table public.users          no force row level security; alter table public.users          disable row level security;
alter table public.quizzes        no force row level security; alter table public.quizzes        disable row level security;
alter table public.games          no force row level security; alter table public.games          disable row level security;
alter table public.game_responses no force row level security; alter table public.game_responses disable row level security;
alter table public.tenants        no force row level security; alter table public.tenants        disable row level security;
alter table public.session        no force row level security; alter table public.session        disable row level security;
```

### Manual SQL after RLS

Every manual session must start with:
```sql
select set_config('app.role', 'system', false);
```

## Backend environment (Render)

Everything from DEPLOYMENT.md, plus:

```bash
# Bootstrap CORS allowlist: Vercel default domains + local dev.
# Tenant CUSTOM domains come from tenants.domains in the DB (no redeploy needed).
CLIENT_ORIGIN=https://abraj-quiz.vercel.app,https://pdo-quiz.vercel.app
# Optional; dev-only fallback when the hostname resolves no tenant (default: abraj)
# DEFAULT_TENANT_SLUG=abraj
```

## Vercel: one project per tenant

For each tenant (example: PDO):

1. Vercel dashboard → Add New… → Project → import haithamlamki/Abraj_Quiz
   (the repo already has vercel.json: build `npm run build:client`, output `dist/public`).
2. Name it `pdo-quiz`.
3. Environment variables (Production):
   - `VITE_API_BASE_URL=https://<your-backend-host>`
   - `VITE_WS_URL=wss://<your-backend-host>/game-ws`
   (Same values for every tenant project — the backend is shared.)
4. Deploy, then Settings → Domains → add `pdoquiz.com` and `www.pdoquiz.com`.
   Configure DNS at the registrar as Vercel instructs (A 76.76.21.21 for apex or
   the shown ALIAS/CNAME; CNAME cname.vercel-dns.com for www).
5. Add the tenant's Vercel default domain (`pdo-quiz.vercel.app`) to BOTH:
   - the tenant's `domains` array (via /admin/tenants) — so hostname resolution works, and
   - `CLIENT_ORIGIN` on the backend — so preview/default-domain access works pre-DNS.
6. Onboard the tenant in /admin/tenants first (or seed via SQL) BEFORE pointing DNS:
   slug, name, domains, branding, features.

Adding tenant #3 later = one /admin/tenants entry + one Vercel project + DNS. No code.

## Smoke test per tenant

1. https://pdoquiz.com loads with PDO name/colors/favicon (view /api/tenant/config in devtools).
2. Register `testuser` on pdoquiz.com — succeeds even though `testuser` may exist on abrajquiz.com.
3. Create a quiz on pdoquiz.com → it must NOT appear on abrajquiz.com.
4. Host a game on pdoquiz.com, join from a phone, play a round, download the PDF → PDO branding.
5. Enter the pdoquiz game PIN on abrajquiz.com/join → "Game not found".
````

- [ ] **Step 2: Update `.env.example`**

Append to the backend section:

```bash
# Multi-tenancy
# Dev-only fallback tenant when the hostname resolves no tenant (default: abraj)
DEFAULT_TENANT_SLUG=abraj
```

And update the `CLIENT_ORIGIN` comment line to:

```bash
# Bootstrap CORS allowlist (Vercel default/preview domains + local dev).
# Tenant custom domains are read dynamically from the tenants table.
CLIENT_ORIGIN="http://localhost:5173,https://abraj-quiz.vercel.app,https://pdo-quiz.vercel.app"
```

- [ ] **Step 3: Update `CLAUDE.md`**

Add under "## Architecture (already in place)":

```markdown
- Multi-tenant: tenants table maps hostnames to tenants; server/tenant.ts resolves
  req.tenant from Origin/Host; storage calls take a StorageCtx ({tenantId} or SYSTEM_CTX);
  Postgres RLS (GUCs app.tenant_id / app.role) enforces isolation as the second layer.
```

Add under "## Hard rules":

```markdown
- Never call storage methods without a StorageCtx. Request paths use tctx(req);
  only the game engine and admin/registry code use SYSTEM_CTX.
- games.game_pin stays globally unique across tenants (runtime rooms are keyed by pin).
- Never hardcode tenant branding in the client; use useTenant() from client/src/lib/tenant.tsx.
- New business tables MUST have tenant_id + the tenant_isolation RLS policy pair.
```

- [ ] **Step 4: Verify and commit**

```bash
npm run check && npm test && npm run build
git add docs/DEPLOYMENT_MULTI_TENANT.md .env.example CLAUDE.md
git commit -m "docs: multi-tenant deployment guide, env template, repo rules"
```

---

## Execution notes

- Tasks 1→12 are strictly ordered; DB migrations interleave with deploys per the Task 12 runbook (0001/0002 any time; 0003 only after the Task-4+ backend is live; 0004 after Task 10).
- After all tasks: use superpowers:finishing-a-development-branch to merge `feat/multi-tenant`.
- Existing-data migration is complete once 0002 runs: every pre-existing row is tenant 1 (Abraj); no data movement is needed.
- Emails: the app currently sends no email, so there is nothing to brand (YAGNI). The `branding.emailFromName` field is reserved in the schema so a future email feature is tenant-brandable without a migration.
