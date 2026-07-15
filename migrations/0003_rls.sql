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
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
-- Note: ALTER DEFAULT PRIVILEGES applies to objects created by the executing role;
-- if future migrations run as a different role, repeat these revokes FOR ROLE that role.

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
