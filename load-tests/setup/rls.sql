-- Tenant-isolation RLS for the LOAD-TEST database only. Mirrors
-- migrations/0003_rls.sql (forced tenant_isolation policy pair on every
-- tenant_id table) and 0005_quiz_app_role.sql (NOBYPASSRLS app role), minus
-- Supabase-specific anon/authenticated revokes. The embedded password is
-- acceptable here because this database must never be anything but local.
begin;

create or replace function public.current_tenant_id() returns integer
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::integer
$$;

create or replace function public.is_system_context() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.role', true), '') = 'system'
$$;

-- connect-pg-simple session table (drizzle push does not create it).
create table if not exists "session" (
  "sid" varchar not null collate "default",
  "sess" json not null,
  "expire" timestamp(6) not null,
  constraint "session_pkey" primary key ("sid")
);
create index if not exists "IDX_session_expire" on "session" ("expire");

-- Forced tenant_isolation pair on every public table that has tenant_id.
do $$
declare t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
  loop
    execute format('alter table public.%I enable row level security', t.table_name);
    execute format('alter table public.%I force row level security', t.table_name);
    execute format('drop policy if exists tenant_isolation on public.%I', t.table_name);
    execute format(
      'create policy tenant_isolation on public.%I using (public.is_system_context() or tenant_id = public.current_tenant_id()) with check (public.is_system_context() or tenant_id = public.current_tenant_id())',
      t.table_name);
  end loop;
end $$;

-- tenants registry: system context only.
alter table public.tenants enable row level security;
alter table public.tenants force row level security;
drop policy if exists tenants_system_only on public.tenants;
create policy tenants_system_only on public.tenants
  using (public.is_system_context()) with check (public.is_system_context());

-- session: open policy (unguessable sids), matches 0003.
alter table public.session enable row level security;
alter table public.session force row level security;
drop policy if exists session_open on public.session;
create policy session_open on public.session using (true) with check (true);

-- App role: NOSUPERUSER NOBYPASSRLS, DML only (mirrors 0005).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'quiz_app') then
    create role quiz_app with login;
  end if;
end $$;
alter role quiz_app with nosuperuser nobypassrls password 'loadtest_app_pw';
grant usage on schema public to quiz_app;
grant select, insert, update, delete on all tables in schema public to quiz_app;
grant usage, select on all sequences in schema public to quiz_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to quiz_app;
alter default privileges in schema public
  grant usage, select on sequences to quiz_app;

commit;
