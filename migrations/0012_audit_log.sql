-- 0012_audit_log.sql — append-only tenant audit trail.
--
-- Written fire-and-forget from mutation sites (server/audit.ts). details is
-- scalars-only by application contract — never question content/answer keys.
-- Read surface: super-admin only until RBAC ships a tenant-facing viewer.
--
-- ORDERING: run as the migration owner (Supabase `postgres`) AFTER 0003_rls.sql
-- and 0005_quiz_app_role.sql. Idempotent — safe to re-run.
begin;

create table if not exists public.audit_log (
  id           serial primary key,
  tenant_id    integer not null references public.tenants(id),
  actor_id     integer not null,
  actor_name   text    not null,
  action       text    not null,
  target_type  text,
  target_id    integer,
  target_label text,
  details      jsonb   not null default '{}'::jsonb,
  created_at   timestamptz default now()
);

create index if not exists audit_log_tenant_id_idx
  on public.audit_log (tenant_id, id);
create index if not exists audit_log_tenant_target_idx
  on public.audit_log (tenant_id, target_type, target_id);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;
drop policy if exists tenant_isolation on public.audit_log;
create policy tenant_isolation on public.audit_log
  using (public.is_system_context() or tenant_id = public.current_tenant_id())
  with check (public.is_system_context() or tenant_id = public.current_tenant_id());

grant select, insert on public.audit_log to quiz_app;
grant usage, select on sequence public.audit_log_id_seq to quiz_app;

commit;

-- Append-only by grant: quiz_app gets NO update/delete on audit_log.
-- VERIFY (system context): select count(*) from audit_log;  -- 0 fresh
