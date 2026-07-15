-- 0005_quiz_app_role.sql — version the application database role.
--
-- WHY: The backend MUST connect as a non-superuser role that does NOT carry
-- BYPASSRLS, otherwise the FORCE ROW LEVEL SECURITY policies from 0003 are
-- silently inert and tenant isolation collapses to the app layer only. The
-- Supabase `postgres` role has BYPASSRLS and must never be the app's
-- DATABASE_URL. This migration makes the `quiz_app` role and its grants
-- reproducible from source instead of a manual, unverifiable deploy step.
--
-- ORDERING: run as an admin/superuser (e.g. Supabase `postgres`) AFTER the base
-- tables exist and AFTER 0003_rls.sql. Idempotent — safe to re-run; safe when
-- the role was already created manually in an existing environment.
--
-- PASSWORD: set out-of-band and rotate as normal; this migration never embeds a
-- credential. In a fresh environment run, after this migration:
--   ALTER ROLE quiz_app WITH PASSWORD '<strong-password>';
-- then point DATABASE_URL at quiz_app (NOT postgres).
begin;

-- Create the role if it does not already exist (LOGIN, no password yet).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'quiz_app') then
    create role quiz_app with login;
  end if;
end
$$;

-- Enforce the security-critical attributes regardless of how the role was
-- originally created. A role that can bypass RLS defeats 0003 entirely.
alter role quiz_app with nosuperuser nobypassrls;

-- DML on all current business/session tables (no DDL, no ownership — owners
-- bypass RLS unless FORCE is set, so quiz_app is intentionally NOT the owner).
grant usage on schema public to quiz_app;
grant select, insert, update, delete on all tables in schema public to quiz_app;
grant usage, select on all sequences in schema public to quiz_app;

-- Cover future tables/sequences created by the migration-running (owner) role.
alter default privileges in schema public
  grant select, insert, update, delete on tables to quiz_app;
alter default privileges in schema public
  grant usage, select on sequences to quiz_app;

commit;

-- VERIFY (should return rolbypassrls=f, rolsuper=f):
--   select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'quiz_app';
