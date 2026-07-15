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
   (tenant_id has DEFAULT 1 until 0004). 0002 also adds `users.is_super_admin`
   (defaulted false) — the merged backend's Drizzle schema selects this column, so it
   must exist before that deploy; the old backend never references it, so this is
   backward compatible. Note: `0001_tenants.sql` was amended during
   development to include `"footerTagline": ""` in the PDO seed row; environments that
   ran an earlier version should re-check the PDO tenant row (re-running won't update
   it due to the `on conflict do nothing` clause).
2. Deploy the backend from the feature branch (Tasks 1-6 code minimum). Smoke test
   abrajquiz production: login, quizzes list, host+join a game.
3. `migrations/0003_rls.sql`. Re-run the smoke test immediately. Rollback if broken (below).
   - After applying 0003, verify from a staging/dev backend session that authenticated
     flows still work (the withCtx GUC path is now load-bearing); the SQL verification
     block below covers the DB side.
4. Deploy the Task 10/11 backend+frontend, then `migrations/0004_admin_hardening.sql`
   (drops transitional tenant_id defaults).
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

### IMPORTANT: the `postgres` role bypasses RLS on Supabase

Supabase's `postgres` role has `BYPASSRLS`, so RLS policies do NOT constrain
connections made as `postgres` — including the SQL editor and any backend
whose `DATABASE_URL` uses the `postgres` user. Tenant isolation still holds at
the application layer (every storage call filters by tenant), but for RLS to be
genuinely load-bearing the backend must connect as the dedicated `quiz_app`
role (LOGIN, NOBYPASSRLS, full DML grants on `public`, created 2026-07-15):

```bash
# Render DATABASE_URL — session pooler (IPv4-friendly):
DATABASE_URL=postgres://quiz_app.bvtbjijbebhubowvhbrp:<QUIZ_APP_PASSWORD>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres
```

After swapping, verify `/api/readyz`, login, and a full game round — those
flows now run under RLS. To hand-test the role in the SQL editor first, run
`grant quiz_app to postgres;` once, then `set role quiz_app;` and confirm
`select count(*) from public.quizzes` returns 0 without the GUC.

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
