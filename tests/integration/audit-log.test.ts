import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { assertServerUp, cleanupTestData, createTestQuiz, createTestUser, endPool } from "./helpers";

// Verifies migration 0012_audit_log.sql + the audit trail end-to-end.
// Run AFTER applying:  psql "$DATABASE_URL" -f migrations/0012_audit_log.sql
// then:                npm run integration

async function sys<T = any>(q: string, params: any[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.role', 'system', true)");
    const res = await client.query(q, params);
    await client.query("commit");
    return res.rows as T[];
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// Audit writes are fire-and-forget; poll briefly instead of a blind sleep.
async function waitForRows(actorId: number, minCount: number, tries = 20): Promise<any[]> {
  for (let i = 0; i < tries; i++) {
    const rows = await sys(`SELECT * FROM audit_log WHERE actor_id = $1 ORDER BY id DESC`, [actorId]);
    if (rows.length >= minCount) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return sys(`SELECT * FROM audit_log WHERE actor_id = $1 ORDER BY id DESC`, [actorId]);
}

describe("audit log", () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await assertServerUp();
    owner = await createTestUser("audit");
  });

  afterAll(async () => {
    await cleanupTestData(owner.prefix);
    await endPool();
  });

  it("migration 0012: table exists with FORCE RLS and the tenant policy", async () => {
    const [t] = await sys(`select to_regclass('public.audit_log') is not null as present`);
    expect(t.present).toBe(true);
    const [rls] = await sys(`select relforcerowsecurity as f from pg_class where relname = 'audit_log'`);
    expect(rls.f).toBe(true);
    const pol = await sys(`select 1 from pg_policies where tablename = 'audit_log' and policyname = 'tenant_isolation'`);
    expect(pol).toHaveLength(1);
  });

  it("register + quiz create/save/archive/restore leave a trail with actor snapshots", async () => {
    const quiz = await createTestQuiz(owner.agent, { title: `${owner.prefix}_audited` });
    const save = await owner.agent.fetch(`/api/quizzes/${quiz.id}`, {
      method: "PUT",
      body: JSON.stringify({
        title: `${owner.prefix}_renamed`, description: "", isPublic: quiz.isPublic,
        background: "classroom", createdBy: quiz.createdBy, questions: quiz.questions,
      }),
    });
    expect(save.status).toBe(200);
    expect((await owner.agent.fetch(`/api/quizzes/${quiz.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await owner.agent.fetch(`/api/quizzes/${quiz.id}/restore`, { method: "POST" })).status).toBe(200);

    const rows = await waitForRows(owner.user.id, 5); // register + create + save + archive + restore
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("auth.register");
    expect(actions).toContain("quiz.create");
    expect(actions).toContain("quiz.save");
    expect(actions).toContain("quiz.archive");
    expect(actions).toContain("quiz.restore");
    expect(rows.every((r: any) => r.actor_name === owner.user.username)).toBe(true);
    const saveRow = rows.find((r: any) => r.action === "quiz.save");
    expect(saveRow.details.questionCount).toBe(3);
    expect(saveRow.target_label).toBe(`${owner.prefix}_renamed`);
    // details carry no content: scalars only (questionCount is the one
    // legitimate scalar field whose name contains "question" — excluded here
    // so the assertion targets actual content leakage, not the field name).
    expect(JSON.stringify(saveRow.details)).not.toMatch(/correctAnswers|question(?!Count)/i);
  });

  it("super-admin API: 403 for normal users; promoted admin reads the trail with filters", async () => {
    expect((await owner.agent.fetch(`/api/admin/audit?tenantId=1`)).status).toBe(403);

    const admin = await createTestUser("auditadm");
    await sys(`UPDATE users SET is_super_admin = true WHERE id = $1`, [admin.user.id]);
    const [{ tenant_id }] = await sys<{ tenant_id: number }>(`SELECT tenant_id FROM users WHERE id = $1`, [owner.user.id]);

    const list = await admin.agent.fetch(`/api/admin/audit?tenantId=${tenant_id}&action=quiz.save&limit=10`);
    expect(list.status).toBe(200);
    const rows = await list.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => r.action === "quiz.save")).toBe(true);

    const missing = await admin.agent.fetch(`/api/admin/audit`);
    expect(missing.status).toBe(400);
    await cleanupTestData(admin.prefix);
  });

  it("RLS: a foreign tenant GUC sees zero audit rows", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', '999999', true)");
      const res = await client.query(`SELECT count(*)::int AS n FROM audit_log WHERE actor_id = $1`, [owner.user.id]);
      expect(res.rows[0].n).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});
