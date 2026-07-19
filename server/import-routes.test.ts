import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";
// Node's test runner isolates each file in its own process, and this file
// never imports ./storage or ./db (the modules that pull in dotenv/config),
// so OPENAI_API_KEY isn't populated from .env here. The route's real
// OpenAI-key gate (mirrors the existing check on every /api/generate-quiz/*
// route in routes.ts) still needs *something* present to exercise the
// injected extractQuizFromText/extractDocxText seams below 200/403/400.
process.env.OPENAI_API_KEY ||= "sk-test-not-a-real-key";

const { registerImportRoutes } = await import("./import-routes");
const { buildTemplateXlsx } = await import("./import-service");
const { extractedQuizSchema } = await import("@shared/schema");

const passThrough = (_req: any, _res: any, next: any) => next();

const fakeExtract = async (_text: string) =>
  extractedQuizSchema.parse({
    title: "Doc",
    description: "",
    subject: "History",
    tags: ["docx"],
    questions: [
      { question: "Extracted?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" },
    ],
  });

// Same harness idiom as bank-routes.test.ts: real express, auth faked via
// x-test-user; AI seams injected so no OpenAI/mammoth is touched.
function makeApp(overrides: Record<string, unknown> = {}) {
  const app = express();
  const requireAuth = (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ message: "Authentication required" });
    req.authUserId = parseInt(String(uid), 10);
    next();
  };
  registerImportRoutes(app, {
    requireAuth,
    aiLimiter: passThrough,
    hasAiFeature: () => true,
    extractQuizFromText: fakeExtract,
    extractDocxText: async () => "x".repeat(100),
    ...overrides,
  } as any);
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

function upload(base: string, name: string, content: Buffer | string, fields: Record<string, string> = {}, auth = true) {
  const form = new FormData();
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  form.append("file", new Blob([bytes]), name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return fetch(`${base}/api/import/parse`, {
    method: "POST",
    headers: auth ? { "x-test-user": "1" } : {},
    body: form,
  });
}

const CSV_HEADER = "question,type,answer1,answer2,answer3,answer4,answer5,answer6,correct,timeLimit,points,difficulty,explanation,subject,tags";

test("import routes: 401 without auth", async () => {
  await withServer(makeApp(), async (base) => {
    assert.equal((await fetch(`${base}/api/import/template.xlsx`)).status, 401);
    assert.equal((await fetch(`${base}/api/import/template.csv`)).status, 401);
    assert.equal((await upload(base, "a.csv", CSV_HEADER, {}, false)).status, 401);
  });
});

test("template downloads: correct content types and parseable bodies", async () => {
  await withServer(makeApp(), async (base) => {
    const xlsx = await fetch(`${base}/api/import/template.xlsx`, { headers: { "x-test-user": "1" } });
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get("content-type") ?? "", /spreadsheetml/);
    assert.ok((await xlsx.arrayBuffer()).byteLength > 0);
    const csv = await fetch(`${base}/api/import/template.csv`, { headers: { "x-test-user": "1" } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(await csv.text(), /question,type,answer1/);
  });
});

test("parse: template xlsx roundtrip through the endpoint", async () => {
  await withServer(makeApp(), async (base) => {
    const res = await upload(base, "template.xlsx", await buildTemplateXlsx());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, "template");
    assert.equal(body.valid.length, 2);
    assert.equal(body.errors.length, 0);
    assert.equal(body.meta.totalRows, 2);
  });
});

test("parse: csv with bad rows reports Excel row numbers; defaults applied", async () => {
  await withServer(makeApp(), async (base) => {
    const csv = [
      CSV_HEADER,
      "Good?,quiz,a,b,,,,,1,,,,,,",          // row 2: valid, no subject/tags
      "Bad?,quiz,a,b,,,,,9,,,,,,",           // row 3: correct out of range
    ].join("\r\n");
    const res = await upload(base, "quiz.csv", csv, { defaultSubject: "Hist", defaultTags: "a;b" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.valid.length, 1);
    assert.equal(body.valid[0].subject, "Hist");
    assert.deepEqual(body.valid[0].tags, ["a", "b"]);
    assert.deepEqual(body.errors.map((e: any) => e.row), [3]);
  });
});

test("parse: over 200 data rows → 400 with split message", async () => {
  await withServer(makeApp(), async (base) => {
    const rows = Array.from({ length: 201 }, (_, i) => `Q${i}?,quiz,a,b,,,,,1,,,,,,`);
    const res = await upload(base, "big.csv", [CSV_HEADER, ...rows].join("\n"));
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /200/);
  });
});

test("parse: disallowed extension → 400; unreadable xlsx → 400 (never 500)", async () => {
  await withServer(makeApp(), async (base) => {
    assert.equal((await upload(base, "notes.txt", "hello")).status, 400);
    assert.equal((await upload(base, "fake.xlsx", "not an xlsx")).status, 400);
  });
});

test("parse: docx lane maps extracted quiz; quiz-level subject/tags used as fallback", async () => {
  await withServer(makeApp(), async (base) => {
    const res = await upload(base, "doc.docx", "binary-ignored-by-fake");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, "ai");
    assert.equal(body.valid.length, 1);
    assert.equal(body.valid[0].subject, "History");
    assert.deepEqual(body.valid[0].tags, ["docx"]);
  });
});

test("parse: docx with user defaults overrides extracted subject/tags", async () => {
  await withServer(makeApp(), async (base) => {
    const res = await upload(base, "doc.docx", "x", { defaultSubject: "Mine", defaultTags: "t1" });
    const body = await res.json();
    assert.equal(body.valid[0].subject, "Mine");
    assert.deepEqual(body.valid[0].tags, ["t1"]);
  });
});

test("parse: docx without the AI feature → 403; empty docx text → 400", async () => {
  await withServer(makeApp({ hasAiFeature: () => false }), async (base) => {
    assert.equal((await upload(base, "doc.docx", "x")).status, 403);
  });
  await withServer(makeApp({ extractDocxText: async () => "short" }), async (base) => {
    assert.equal((await upload(base, "doc.docx", "x")).status, 400);
  });
});
