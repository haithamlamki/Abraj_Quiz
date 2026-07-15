-- 0001_tenants.sql — create and seed the tenants registry.
-- Run in Supabase SQL editor. Safe to run before deploying any new code.
begin;

create table if not exists public.tenants (
  id serial primary key,
  slug text not null unique,
  name text not null,
  domains jsonb not null default '[]'::jsonb,
  branding jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamp default now()
);

create index if not exists tenants_domains_gin on public.tenants using gin (domains);

insert into public.tenants (id, slug, name, domains, branding, features) values
  (1, 'abraj', 'Abraj Quiz',
   '["abrajquiz.com", "www.abrajquiz.com", "abraj-quiz.vercel.app", "localhost", "127.0.0.1"]'::jsonb,
   '{"appName": "Abraj Quiz"}'::jsonb,
   '{}'::jsonb),
  (2, 'pdo', 'PDO Quiz',
   '["pdoquiz.com", "www.pdoquiz.com"]'::jsonb,
   '{"appName": "PDO Quiz", "colors": {"primary": "hsl(356, 74%, 44%)", "secondary": "hsl(356, 74%, 32%)"}, "pdf": {"headerText": "PDO QUIZ COMPLETE REPORT", "footerText": "© 2026 PDO Quiz Platform", "footerTagline": "", "primaryColor": [196, 30, 58]}}'::jsonb,
   '{}'::jsonb)
on conflict (slug) do nothing;

select setval('public.tenants_id_seq', greatest((select max(id) from public.tenants), 1));

commit;
