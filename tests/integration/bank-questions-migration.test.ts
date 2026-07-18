import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { endPool } from "./helpers";

// Verifies migration 0009_question_bank.sql produced the schema and security
// invariants it promises. Run AFTER applying the migration:
//   psql "$DATABASE_URL" -f migrations/0009_question_bank.sql   (as admin/owner)
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

describe("migration 0009_question_bank — schema, RLS, grants", () => {
  beforeAll(async () => {
    const [{ present }] = await sys<{ present: boolean }>(
      `select to_regclass('public.bank_questions') is not null as present`,
    );
    if (!present) {
      throw new Error(
        "bank_questions table not found. Apply migrations/0009_question_bank.sql before running this test.",
      );
    }
  });

  afterAll(async () => {
    await endPool();
  });

  it("has the expected columns", async () => {
    const cols = await sys<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'bank_questions'`,
    );
    const names = cols.map((c) => c.column_name);
    for (const required of ["id", "tenant_id", "created_by", "question", "subject", "tags", "deleted_at", "created_at", "updated_at"]) {
      expect(names).toContain(required);
    }
  });

  it("enforces FORCE ROW LEVEL SECURITY with a tenant_isolation policy", async () => {
    const [rel] = await sys<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relrowsecurity, relforcerowsecurity
       from pg_class where oid = 'public.bank_questions'::regclass`,
    );
    expect(rel.relrowsecurity).toBe(true);
    expect(rel.relforcerowsecurity).toBe(true);

    const policies = await sys<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'bank_questions'`,
    );
    expect(policies.map((p) => p.policyname)).toContain("tenant_isolation");
  });

  it("tenant_isolation policy expression matches the quizzes policy (same isolation semantics)", async () => {
    const rows = await sys<{ tablename: string; qual: string }>(
      `select tablename, qual from pg_policies
       where schemaname = 'public' and policyname = 'tenant_isolation'
         and tablename in ('quizzes', 'bank_questions')`,
    );
    const byTable = Object.fromEntries(rows.map((r) => [r.tablename, r.qual]));
    expect(byTable.bank_questions).toBeDefined();
    expect(byTable.bank_questions).toBe(byTable.quizzes);
  });

  it("has the tag GIN index and quiz_app grants", async () => {
    const idx = await sys<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'bank_questions'`,
    );
    expect(idx.map((i) => i.indexname)).toContain("bank_questions_tags_gin");

    const grants = await sys<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'bank_questions' and grantee = 'quiz_app'`,
    );
    const privs = grants.map((g) => g.privilege_type);
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(privs).toContain(p);
  });
});
