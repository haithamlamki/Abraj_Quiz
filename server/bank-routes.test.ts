import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { MemStorage } = await import("./storage");
const { registerBankRoutes } = await import("./bank-routes");

const VALID_QUESTION = {
  question: "What is 2+2?",
  type: "quiz",
  answerType: "single",
  answers: ["3", "4"],
  correctAnswers: [1],
  timeLimit: 20,
  points: "standard",
};

// Minimal harness: real express + MemStorage; auth faked via x-test-user
// header (mirrors requireAuth's contract: 401 without a session, sets
// req.authUserId with one). tctx pinned to tenant 1.
function makeApp(storage: InstanceType<typeof MemStorage>) {
  const app = express();
  app.use(express.json());
  const requireAuth = (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ message: "Authentication required" });
    req.authUserId = parseInt(String(uid), 10);
    next();
  };
  registerBankRoutes(app, { storage, requireAuth, tctx: () => ({ tenantId: 1 }) });
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

const AUTH = { "x-test-user": "1", "content-type": "application/json" };

test("bank routes: every endpoint 401s without auth", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    const cases: Array<[string, string]> = [
      ["GET", "/api/bank/questions"],
      ["GET", "/api/bank/questions/meta"],
      ["POST", "/api/bank/questions"],
      ["PUT", "/api/bank/questions/1"],
      ["DELETE", "/api/bank/questions/1"],
      ["POST", "/api/bank/questions/1/restore"],
    ];
    for (const [method, path] of cases) {
      const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });
});

test("bank routes: create → list → meta → update → archive → restore happy path", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    // Create (201) — tags normalized, createdBy stamped from auth.
    const createRes = await fetch(`${base}/api/bank/questions`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ question: VALID_QUESTION, subject: "Math", tags: ["Basics", "basics", " arithmetic "] }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.createdBy, 1);
    assert.deepEqual(created.tags, ["Basics", "arithmetic"]);

    // List + filters.
    const list = await (await fetch(`${base}/api/bank/questions`, { headers: AUTH })).json();
    assert.equal(list.length, 1);
    const filtered = await (await fetch(`${base}/api/bank/questions?tags=Basics,arithmetic&subject=Math&search=2%2B2`, { headers: AUTH })).json();
    assert.equal(filtered.length, 1);
    const none = await (await fetch(`${base}/api/bank/questions?search=nomatch`, { headers: AUTH })).json();
    assert.equal(none.length, 0);

    // Meta.
    const meta = await (await fetch(`${base}/api/bank/questions/meta`, { headers: AUTH })).json();
    assert.deepEqual(meta.subjects, ["Math"]);
    assert.deepEqual(meta.tags.sort(), ["Basics", "arithmetic"].sort());

    // Update.
    const updRes = await fetch(`${base}/api/bank/questions/${created.id}`, {
      method: "PUT", headers: AUTH, body: JSON.stringify({ subject: "Arithmetic" }),
    });
    assert.equal(updRes.status, 200);
    assert.equal((await updRes.json()).subject, "Arithmetic");

    // Archive (204) → gone from live list, present with archived=1.
    assert.equal((await fetch(`${base}/api/bank/questions/${created.id}`, { method: "DELETE", headers: AUTH })).status, 204);
    assert.equal(((await (await fetch(`${base}/api/bank/questions`, { headers: AUTH })).json()) as any[]).length, 0);
    assert.equal(((await (await fetch(`${base}/api/bank/questions?archived=1`, { headers: AUTH })).json()) as any[]).length, 1);

    // Restore.
    const restoreRes = await fetch(`${base}/api/bank/questions/${created.id}/restore`, { method: "POST", headers: AUTH });
    assert.equal(restoreRes.status, 200);
    assert.equal(((await (await fetch(`${base}/api/bank/questions`, { headers: AUTH })).json()) as any[]).length, 1);
  });
});

test("bank routes: validation failures → 400, unknown ids → 404", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    // Poll with correctAnswers → Zod 400.
    const bad = await fetch(`${base}/api/bank/questions`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ question: { ...VALID_QUESTION, type: "poll" } }),
    });
    assert.equal(bad.status, 400);

    // Non-numeric id → 400.
    assert.equal((await fetch(`${base}/api/bank/questions/abc`, { method: "DELETE", headers: AUTH })).status, 400);

    // Unknown id → 404 on update / archive / restore.
    assert.equal((await fetch(`${base}/api/bank/questions/999`, { method: "PUT", headers: AUTH, body: JSON.stringify({ subject: "X" }) })).status, 404);
    assert.equal((await fetch(`${base}/api/bank/questions/999`, { method: "DELETE", headers: AUTH })).status, 404);
    assert.equal((await fetch(`${base}/api/bank/questions/999/restore`, { method: "POST", headers: AUTH })).status, 404);
  });
});

test("bank routes: PUT subject clear semantics — empty string clears, absent key leaves unchanged", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    const createRes = await fetch(`${base}/api/bank/questions`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ question: VALID_QUESTION, subject: "Math" }),
    });
    const created = await createRes.json();
    assert.equal(created.subject, "Math");

    // Absent subject key leaves it unchanged.
    const untouched = await fetch(`${base}/api/bank/questions/${created.id}`, {
      method: "PUT", headers: AUTH, body: JSON.stringify({ tags: ["x"] }),
    });
    assert.equal(untouched.status, 200);
    assert.equal((await untouched.json()).subject, "Math");

    // Present-but-empty subject clears it.
    const cleared = await fetch(`${base}/api/bank/questions/${created.id}`, {
      method: "PUT", headers: AUTH, body: JSON.stringify({ subject: "" }),
    });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).subject, null);
  });
});
