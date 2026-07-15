-- 0004_admin_hardening.sql — drops transitional tenant_id defaults.
-- Run after the Task-10 backend deploy. All inserts now set tenant_id explicitly.
-- (is_super_admin now lands in 0002_tenant_id.sql, since the merged backend's Drizzle
-- schema selects it and needs it present before that deploy.)
begin;

alter table public.users          alter column tenant_id drop default;
alter table public.quizzes        alter column tenant_id drop default;
alter table public.games          alter column tenant_id drop default;
alter table public.game_responses alter column tenant_id drop default;

commit;
