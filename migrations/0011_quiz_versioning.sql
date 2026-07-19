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
