-- 0004_admin_hardening.sql — super admin flag + drop transitional tenant_id defaults.
-- Run after the Task-10 backend deploy. All inserts now set tenant_id explicitly.
begin;

alter table public.users add column if not exists is_super_admin boolean not null default false;

alter table public.users          alter column tenant_id drop default;
alter table public.quizzes        alter column tenant_id drop default;
alter table public.games          alter column tenant_id drop default;
alter table public.game_responses alter column tenant_id drop default;

commit;
