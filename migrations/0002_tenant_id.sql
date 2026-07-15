-- 0002_tenant_id.sql — add tenant_id to business tables and backfill Abraj (=1).
-- Safe to run while the OLD backend is live: default 1 keeps old inserts working.
begin;

alter table public.users          add column if not exists tenant_id integer not null default 1 references public.tenants(id);
alter table public.quizzes        add column if not exists tenant_id integer not null default 1 references public.tenants(id);
alter table public.games          add column if not exists tenant_id integer not null default 1 references public.tenants(id);
alter table public.game_responses add column if not exists tenant_id integer not null default 1 references public.tenants(id);

-- The merged backend's Drizzle schema selects this column, so it must exist before that
-- deploy; backward compatible with the old backend (which never references it).
alter table public.users add column if not exists is_super_admin boolean not null default false;

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
