import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { MemStorage } = await import("./storage");
const { registerVersionRoutes } = await import("./version-routes");

function makeApp(storage: InstanceType<typeof MemStorage>) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const requireAuth = (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ message: "Authentication required" });
    req.authUserId = parseInt(String(uid), 10);
    next();
  };
  const passThrough = (_req: any, _res: any, next: any) => next();
  registerVersionRoutes(app, { storage, requireAuth, tctx: () => ({ tenantId: 1 }), draftLimiter: passThrough });
  return app;
}

async function withServer(app: express.Express, fn: (base: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const OWNER = { "x-test-user": "1", "content-type": "application/json" };
const OTHER = { "x-test-user": "2", "content-type": "application/json" };

async function seedQuiz(storage: InstanceType<typeof MemStorage>) {
  return storage.createQuiz({ tenantId: 1 }, {
    title: "seed", description: "", background: "classroom", isPublic: true, createdBy: 1,
    questions: [{ question: "q", answers: ["a", "b"], correctAnswers: [0], type: "quiz", answerType: "single", timeLimit: 20, points: "standard" }],
  } as any);
}

test("version routes: every endpoint 401s without auth", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    const cases: Array<[string, string]> = [
      ["GET", "/api/quizzes/1/versions"],
      ["GET", "/api/quizzes/1/versions/1"],
      ["GET", "/api/quizzes/1/draft"],
      ["PUT", "/api/quizzes/1/draft"],
      ["DELETE", "/api/quizzes/1/draft"],
    ];
    for (const [method, path] of cases) {
      const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });
});

test("version routes: owner-gate — non-owner gets 403 everywhere", async () => {
  const storage = new MemStorage();
  const quiz = await seedQuiz(storage);
  await withServer(makeApp(storage), async (base) => {
    const cases: Array<[string, string, string | undefined]> = [
      ["GET", `/api/quizzes/${quiz.id}/versions`, undefined],
      ["GET", `/api/quizzes/${quiz.id}/versions/1`, undefined],
      ["GET", `/api/quizzes/${quiz.id}/draft`, undefined],
      ["PUT", `/api/quizzes/${quiz.id}/draft`, "{}"],
      ["DELETE", `/api/quizzes/${quiz.id}/draft`, undefined],
    ];
    for (const [method, path, body] of cases) {
      const res = await fetch(base + path, { method, headers: OTHER, body });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
  });
});

test("version routes: 400 bad id, 404 missing quiz / version / draft", async () => {
  const storage = new MemStorage();
  const quiz = await seedQuiz(storage);
  await withServer(makeApp(storage), async (base) => {
    assert.equal((await fetch(`${base}/api/quizzes/abc/versions`, { headers: OWNER })).status, 400);
    assert.equal((await fetch(`${base}/api/quizzes/999999/versions`, { headers: OWNER })).status, 404);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/versions/7`, { headers: OWNER })).status, 404);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/versions/abc`, { headers: OWNER })).status, 400);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/draft`, { headers: OWNER })).status, 404);
  });
});

test("version routes: draft PUT validates, GET round-trips, DELETE idempotent", async () => {
  const storage = new MemStorage();
  const quiz = await seedQuiz(storage);
  await withServer(makeApp(storage), async (base) => {
    // Half-typed draft is accepted…
    const put = await fetch(`${base}/api/quizzes/${quiz.id}/draft`, {
      method: "PUT", headers: OWNER,
      body: JSON.stringify({ title: "", questions: [{ question: "half", answers: ["x"], correctAnswers: [] }] }),
    });
    assert.equal(put.status, 200);
    assert.ok((await put.json()).updatedAt);
    // …oversize is rejected.
    const bad = await fetch(`${base}/api/quizzes/${quiz.id}/draft`, {
      method: "PUT", headers: OWNER,
      body: JSON.stringify({ questions: Array.from({ length: 101 }, () => ({})) }),
    });
    assert.equal(bad.status, 400);

    const got = await fetch(`${base}/api/quizzes/${quiz.id}/draft`, { headers: OWNER });
    assert.equal(got.status, 200);
    const body = await got.json();
    assert.equal(body.payload.questions[0].question, "half");
    assert.ok(body.updatedAt);

    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/draft`, { method: "DELETE", headers: OWNER })).status, 204);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/draft`, { method: "DELETE", headers: OWNER })).status, 204);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/draft`, { headers: OWNER })).status, 404);
  });
});

test("version routes: list is light metadata, detail is the full snapshot", async () => {
  const storage = new MemStorage();
  const quiz = await seedQuiz(storage);
  await storage.updateQuizWithVersion({ tenantId: 1 }, quiz.id, { title: "second" });
  await withServer(makeApp(storage), async (base) => {
    const list = await (await fetch(`${base}/api/quizzes/${quiz.id}/versions`, { headers: OWNER })).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].versionNumber, 1);
    assert.equal(list[0].title, "seed");
    assert.equal(list[0].questionCount, 1);
    assert.ok(!("questions" in list[0]));            // list stays light

    const detail = await (await fetch(`${base}/api/quizzes/${quiz.id}/versions/1`, { headers: OWNER })).json();
    assert.equal(detail.title, "seed");
    assert.equal(detail.questions.length, 1);
    assert.deepEqual(detail.questions[0].correctAnswers, [0]); // owner-only surface
  });
});
