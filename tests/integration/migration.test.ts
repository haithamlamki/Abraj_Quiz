import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { endPool } from "./helpers";

// Verifies migration 0006_game_players.sql produced the schema and security
// invariants it promises, and that the legacy JSON roster was backfilled with
// no loss. Run AFTER applying the migration to the target database:
//   psql "$DATABASE_URL" -f migrations/0006_game_players.sql   (as an admin/owner)
// then:  npm run integration
//
// Everything here reads in system context (app.role='system') because the
// tables carry FORCE ROW LEVEL SECURITY — a plain query matches zero rows.

async function sys<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.role', 'system', true)");
    const res = await client.query(sql, params);
    await client.query("commit");
    return res.rows as T[];
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

describe("migration 0006_game_players — schema, RLS, and backfill", () => {
  beforeAll(async () => {
    const [{ present }] = await sys<{ present: boolean }>(
      `select to_regclass('public.game_players') is not null as present`,
    );
    if (!present) {
      throw new Error(
        "game_players table not found. Apply migrations/0006_game_players.sql to the target DB before running the migration test.",
      );
    }
  });

  afterAll(async () => {
    await endPool();
  });

  it("has the case-insensitive unique index on (game_id, lower(name))", async () => {
    const rows = await sys<{ indexdef: string }>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'game_players'
         and indexname = 'game_players_game_name_uq'`,
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef.toLowerCase();
    expect(def).toContain("unique");
    expect(def).toContain("game_id");
    expect(def).toContain("lower(name)");
  });

  it("enforces FORCE ROW LEVEL SECURITY with a tenant_isolation policy", async () => {
    const [rel] = await sys<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relrowsecurity, relforcerowsecurity
       from pg_class where oid = 'public.game_players'::regclass`,
    );
    expect(rel.relrowsecurity).toBe(true);
    expect(rel.relforcerowsecurity).toBe(true);

    const policies = await sys<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'game_players'`,
    );
    expect(policies.map((p) => p.policyname)).toContain("tenant_isolation");
  });

  it("carries the tenant_id + game_id columns with the expected foreign keys", async () => {
    const cols = await sys<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'game_players'`,
    );
    const names = cols.map((c) => c.column_name);
    for (const required of ["id", "tenant_id", "game_id", "name", "score", "joined_at"]) {
      expect(names).toContain(required);
    }

    const fks = await sys<{ foreign_table: string }>(
      `select ccu.table_name as foreign_table
       from information_schema.table_constraints tc
       join information_schema.constraint_column_usage ccu
         on tc.constraint_name = ccu.constraint_name
       where tc.table_schema = 'public' and tc.table_name = 'game_players'
         and tc.constraint_type = 'FOREIGN KEY'`,
    );
    const foreignTables = fks.map((f) => f.foreign_table);
    expect(foreignTables).toContain("games");
    expect(foreignTables).toContain("tenants");
  });

  it("backfilled the legacy JSON roster with no lost players", async () => {
    // For every game, game_players must hold at least as many rows as there are
    // DISTINCT case-insensitive names in the legacy JSON array. (It can hold the
    // same or more; the unique index legitimately collapses any case-variant
    // duplicates that existed only in the JSON.)
    const mismatches = await sys<{ game_id: number; legacy_distinct: number; migrated: number }>(
      `select g.id as game_id,
              (select count(distinct lower(elem->>'name'))
                 from jsonb_array_elements(coalesce(g.players, '[]'::jsonb)) elem
                 where elem->>'name' is not null and length(trim(elem->>'name')) > 0
              ) as legacy_distinct,
              (select count(*) from game_players gp where gp.game_id = g.id) as migrated
       from games g`,
    );
    const lost = mismatches.filter((r) => Number(r.migrated) < Number(r.legacy_distinct));
    expect(lost).toEqual([]);
  });
});
