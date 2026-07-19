import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import {
  assertServerUp, cleanupTestData, createTestQuiz, createTestUser, endPool,
  type TestQuiz,
} from "./helpers";

// Verifies migration 0011_quiz_versioning.sql + the versioned save path.
// Run AFTER applying:  psql "$DATABASE_URL" -f migrations/0011_quiz_versioning.sql
// then:                npm run integration

const PUT_BODY = (quiz: TestQuiz, title: string) => JSON.stringify({
  title,
  description: "integration test quiz",
  isPublic: quiz.isPublic,
  background: "classroom",
  createdBy: quiz.createdBy,
  questions: quiz.questions,
});

describe("quiz versioning + drafts", () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  let quiz: TestQuiz;

  beforeAll(async () => {
    await assertServerUp();
    owner = await createTestUser("vsnowner");
    other = await createTestUser("vsnother");
    quiz = await createTestQuiz(owner.agent, { title: `${owner.prefix}_quiz` });
  });

  afterAll(async () => {
    await cleanupTestData(owner.prefix);
    await cleanupTestData(other.prefix);
    await endPool();
  });

  it("save banks the PREVIOUS state as version 1 and returns light list metadata", async () => {
    const put = await owner.agent.fetch(`/api/quizzes/${quiz.id}`, {
      method: "PUT", body: PUT_BODY(quiz, `${owner.prefix}_renamed`),
    });
    expect(put.status).toBe(200);

    const list = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].versionNumber).toBe(1);
    expect(list[0].title).toBe(`${owner.prefix}_quiz`);   // previous state
    expect(list[0].questionCount).toBe(3);
    expect(list[0]).not.toHaveProperty("questions");       // list stays light

    const detail = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions/1`)).json();
    expect(detail.title).toBe(`${owner.prefix}_quiz`);
    expect(detail.questions).toHaveLength(3);
    expect(detail.questions[0].correctAnswers).toEqual([2]); // full snapshot, owner-only
  });

  it("draft lifecycle: upsert → get → deleted by save; DELETE idempotent", async () => {
    const put = await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      body: JSON.stringify({ title: "wip", questions: [{ question: "half", answers: ["x"], correctAnswers: [] }] }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).updatedAt).toBeTruthy();

    const got = await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`);
    expect(got.status).toBe(200);
    expect((await got.json()).payload.title).toBe("wip");

    // Explicit save wipes the draft in the same transaction.
    const save = await owner.agent.fetch(`/api/quizzes/${quiz.id}`, {
      method: "PUT", body: PUT_BODY(quiz, `${owner.prefix}_saved2`),
    });
    expect(save.status).toBe(200);
    expect((await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`)).status).toBe(404);

    expect((await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`, { method: "DELETE" })).status).toBe(204);
    expect((await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`, { method: "DELETE" })).status).toBe(204);
  });

  it("draft rejects oversize payloads", async () => {
    const res = await owner.agent.fetch(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      body: JSON.stringify({ questions: Array.from({ length: 101 }, () => ({})) }),
    });
    expect(res.status).toBe(400);
  });

  it("non-owner gets 403 on every route; unauthenticated gets 401", async () => {
    const routes: Array<[string, string, string | undefined]> = [
      ["GET", `/api/quizzes/${quiz.id}/versions`, undefined],
      ["GET", `/api/quizzes/${quiz.id}/versions/1`, undefined],
      ["GET", `/api/quizzes/${quiz.id}/draft`, undefined],
      ["PUT", `/api/quizzes/${quiz.id}/draft`, "{}"],
      ["DELETE", `/api/quizzes/${quiz.id}/draft`, undefined],
    ];
    for (const [method, path, body] of routes) {
      const res = await other.agent.fetch(path, { method, body });
      expect(res.status, `${method} ${path}`).toBe(403);
      const anon = await fetch(`${process.env.INTEGRATION_BASE_URL ?? "http://localhost:5000"}${path}`, {
        method, body, headers: { origin: process.env.INTEGRATION_BASE_URL ?? "http://localhost:5000", "content-type": "application/json" },
      });
      expect(anon.status, `anon ${method} ${path}`).toBe(401);
    }
  });

  it("prunes to 20 versions, oldest first", async () => {
    const fresh = await createTestQuiz(owner.agent, { title: `${owner.prefix}_prune` });
    for (let i = 1; i <= 21; i++) {
      const res = await owner.agent.fetch(`/api/quizzes/${fresh.id}`, {
        method: "PUT", body: PUT_BODY(fresh, `${owner.prefix}_prune_${i}`),
      });
      expect(res.status).toBe(200);
    }
    const list = await (await owner.agent.fetch(`/api/quizzes/${fresh.id}/versions`)).json();
    expect(list).toHaveLength(20);
    expect(list[0].versionNumber).toBe(21);
    expect(list[19].versionNumber).toBe(2);
    expect((await owner.agent.fetch(`/api/quizzes/${fresh.id}/versions/1`)).status).toBe(404);
    // 21 sequential live-DB saves through the Supabase pooler routinely exceed
    // vitest's 60s default — the loop is the point of the test, so raise it.
  }, 180_000);

  it("restore-then-save yields a NEW version; prior versions unchanged", async () => {
    const v = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions/1`)).json();
    const before = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions`)).json();
    const res = await owner.agent.fetch(`/api/quizzes/${quiz.id}`, {
      method: "PUT",
      body: JSON.stringify({
        title: v.title, description: v.description ?? "", isPublic: v.isPublic ?? true,
        background: v.background ?? "classroom", createdBy: quiz.createdBy, questions: v.questions,
      }),
    });
    expect(res.status).toBe(200);
    const after = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions`)).json();
    expect(after.length).toBe(before.length + 1);
    // Version 1 still holds the original state.
    const v1 = await (await owner.agent.fetch(`/api/quizzes/${quiz.id}/versions/1`)).json();
    expect(v1.title).toBe(v.title);
  });

  it("RLS: another tenant's GUC sees zero version/draft rows", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      // CI connects as the postgres superuser, which bypasses RLS even with
      // FORCE. Drop to the app role (a no-op when already quiz_app, e.g.
      // against Render's URL) so the policy actually applies to the probe.
      await client.query("set local role quiz_app");
      // Tenant 999999 does not exist — with RLS forced, both tables must be empty.
      await client.query("select set_config('app.tenant_id', '999999', true)");
      const versions = await client.query("select count(*)::int as n from quiz_versions where quiz_id = $1", [quiz.id]);
      const drafts = await client.query("select count(*)::int as n from quiz_drafts where quiz_id = $1", [quiz.id]);
      expect(versions.rows[0].n).toBe(0);
      expect(drafts.rows[0].n).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});
