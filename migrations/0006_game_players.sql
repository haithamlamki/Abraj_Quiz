-- 0006_game_players.sql — authoritative per-row roster for game participants.
--
-- WHY: joining a game used to lock the single games row (SELECT ... FOR UPDATE)
-- and rewrite the whole games.players JSON array on every join. At a 400-player
-- join storm that fully serializes (~1 join / join-latency) and is O(n^2) in
-- array rewrites, producing HTTP 500s under load. This table makes each join an
-- INDEPENDENT insert with a database-level, case-insensitive uniqueness guard,
-- so joins no longer contend on a shared row.
--
-- ORDERING: run as the migration owner (Supabase `postgres`) AFTER the base
-- tables and AFTER 0003_rls.sql / 0005_quiz_app_role.sql. Idempotent — safe to
-- re-run (guards on IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT).
--
-- BACKWARD COMPATIBILITY: existing games keep their legacy games.players JSON;
-- this migration backfills every historical player into game_players so reads
-- switch cleanly to the new table with no data loss. games.players is frozen
-- afterwards (the app stops reading/writing it) — see shared/schema.ts.
begin;

-- The backfill SELECT reads games, which carries FORCE ROW LEVEL SECURITY from
-- 0003. Even the owner is subject to FORCE RLS, so without system context the
-- SELECT matches zero rows and the backfill silently does nothing. Mirror the
-- game engine's SYSTEM_CTX for the duration of this transaction.
select set_config('app.role', 'system', true);

create table if not exists public.game_players (
  id         serial primary key,
  tenant_id  integer not null references public.tenants(id),
  game_id    integer not null references public.games(id),
  name       text    not null,
  score      integer not null default 0,
  joined_at  timestamp default now()
);

-- Case-insensitive uniqueness per game: the second layer that makes duplicate
-- name rejection reliable under concurrency (two simultaneous joins with the
-- same name — even differing only in case — cannot both win).
create unique index if not exists game_players_game_name_uq
  on public.game_players (game_id, lower(name));

-- Roster/count lookups are always scoped to one game.
create index if not exists game_players_game_id_idx
  on public.game_players (game_id);

-- Backfill historical participants from the legacy JSON array. ON CONFLICT DO
-- NOTHING tolerates any (theoretical) case-variant duplicate already in the
-- array and makes re-running this migration a no-op.
insert into public.game_players (tenant_id, game_id, name, score)
select g.tenant_id,
       g.id,
       (elem->>'name')::text,
       coalesce(nullif(elem->>'score', '')::int, 0)
from public.games g
     cross join lateral jsonb_array_elements(coalesce(g.players, '[]'::jsonb)) as elem
where (elem->>'name') is not null
  and length(trim(elem->>'name')) > 0
on conflict do nothing;

-- Tenant isolation (CLAUDE.md hard rule: every business table gets tenant_id +
-- the tenant_isolation policy pair). FORCE so the owner is subject too and the
-- quiz_app role cannot bypass it.
alter table public.game_players enable row level security;
alter table public.game_players force row level security;
drop policy if exists tenant_isolation on public.game_players;
create policy tenant_isolation on public.game_players
  using (public.is_system_context() or tenant_id = public.current_tenant_id())
  with check (public.is_system_context() or tenant_id = public.current_tenant_id());

-- Explicit grants for the application role. 0005's ALTER DEFAULT PRIVILEGES
-- already covers tables/sequences created by the same owner, but grant here too
-- so this migration is correct even if a different owner runs it.
grant select, insert, update, delete on public.game_players to quiz_app;
grant usage, select on sequence public.game_players_id_seq to quiz_app;

commit;

-- VERIFY (run in system context — see 0003 header):
--   select set_config('app.role','system',false);
--   select count(*) from game_players;                       -- backfilled rows
--   -- roster parity vs legacy JSON for every game:
--   select g.id,
--          jsonb_array_length(coalesce(g.players,'[]'::jsonb)) as legacy_n,
--          (select count(*) from game_players gp where gp.game_id = g.id) as new_n
--   from games g
--   where jsonb_array_length(coalesce(g.players,'[]'::jsonb))
--         <> (select count(*) from game_players gp where gp.game_id = g.id);
--   -- ^ expect zero rows (every game's counts match, modulo pre-existing
--   --   case-variant dupes which the unique index legitimately collapses).
