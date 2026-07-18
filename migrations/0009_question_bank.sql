-- 0009_question_bank.sql — per-tenant reusable question library ("Question Bank").
--
-- `question` holds the canonical question JSON (shared/schema.ts questionSchema)
-- — the same shape quizzes.questions entries use, so bank → quiz is a copy.
-- Soft delete mirrors quizzes.deleted_at (0008).
--
-- ORDERING: run as the migration owner (Supabase `postgres`) AFTER 0003_rls.sql
-- and 0005_quiz_app_role.sql. Idempotent — safe to re-run.
begin;

create table if not exists public.bank_questions (
  id          serial primary key,
  tenant_id   integer not null references public.tenants(id),
  created_by  integer not null,
  question    jsonb   not null,
  subject     text,
  tags        jsonb   not null default '[]'::jsonb,
  deleted_at  timestamptz,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Listing is always tenant-scoped; subject filter rides the composite.
create index if not exists bank_questions_tenant_idx
  on public.bank_questions (tenant_id);
create index if not exists bank_questions_tenant_subject_idx
  on public.bank_questions (tenant_id, subject);
-- Tag containment filtering (tags @> '["x"]').
create index if not exists bank_questions_tags_gin
  on public.bank_questions using gin (tags);

-- Tenant isolation (CLAUDE.md hard rule: every business table gets tenant_id +
-- the tenant_isolation policy pair). FORCE so the owner is subject too and the
-- quiz_app role cannot bypass it.
alter table public.bank_questions enable row level security;
alter table public.bank_questions force row level security;
drop policy if exists tenant_isolation on public.bank_questions;
create policy tenant_isolation on public.bank_questions
  using (public.is_system_context() or tenant_id = public.current_tenant_id())
  with check (public.is_system_context() or tenant_id = public.current_tenant_id());

-- Explicit grants for the application role. 0005's ALTER DEFAULT PRIVILEGES
-- already covers tables created by the same owner, but grant here too so this
-- migration is correct even if a different owner runs it.
grant select, insert, update, delete on public.bank_questions to quiz_app;
grant usage, select on sequence public.bank_questions_id_seq to quiz_app;

commit;

-- VERIFY (run in system context — see 0003 header):
--   select set_config('app.role','system',false);
--   select count(*) from bank_questions;   -- 0 on a fresh install
