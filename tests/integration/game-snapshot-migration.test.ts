import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { endPool } from "./helpers";

// Verifies migration 0010_game_question_snapshot.sql. Run AFTER applying:
//   psql "$DATABASE_URL" -f migrations/0010_game_question_snapshot.sql
// then:  npm run integration

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

describe("migration 0010_game_question_snapshot — schema", () => {
  beforeAll(async () => {
    const [{ present }] = await sys<{ present: boolean }>(
      `select to_regclass('public.games') is not null as present`,
    );
    if (!present) throw new Error("games table not found — wrong database?");
  });

  afterAll(async () => {
    await endPool();
  });

  it("games has a nullable jsonb questions_snapshot column", async () => {
    const rows = await sys<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'games' and column_name = 'questions_snapshot'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("jsonb");
    expect(rows[0].is_nullable).toBe("YES");
  });
});
