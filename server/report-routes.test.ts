import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { MemStorage } = await import("./storage");
const { registerReportRoutes } = await import("./report-routes");
const { REPORT_STRINGS } = await import("./reports");

function makeApp(storage: InstanceType<typeof MemStorage>) {
  const app = express();
  const requireAuth = (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ message: "Authentication required" });
    req.authUserId = parseInt(String(uid), 10);
    next();
  };
  registerReportRoutes(app, { storage, requireAuth, tctx: () => ({ tenantId: 1 }) });
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

const AUTH = { "x-test-user": "1" };

// Seed: quiz owned by user 1 with one completed, played game.
async function seed(s: InstanceType<typeof MemStorage>) {
  const ctx = { tenantId: 1 };
  const quiz = await s.createQuiz(ctx, {
    title: "Report Quiz", description: "", createdBy: 1, isPublic: false,
    questions: [
      { question: "q1?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" },
      { question: "q2?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [1], timeLimit: 20, points: "standard" },
    ],
  } as any);
  // Deviation from the brief: joinGame() only accepts games in "waiting"
  // status (see server/storage.ts MemStorage#joinGame), so the "done" game
  // must be created waiting, populated, THEN transitioned to completed via
  // updateGame — creating it pre-completed (as the brief's snippet did)
  // makes joinGame silently no-op (status "not_waiting") and the roster/
  // response rows disappear. Route code is unaffected; only this seed
  // helper changed.
  let done = await s.createGame(ctx, { quizId: quiz.id, gamePin: "700001", hostId: 1, status: "waiting" } as any);
  const open = await s.createGame(ctx, { quizId: quiz.id, gamePin: "700002", hostId: 1, status: "active" } as any);
  const foreign = await s.createGame(ctx, { quizId: quiz.id, gamePin: "700003", hostId: 2, status: "completed" } as any);
  await s.joinGame(ctx, "700001", "amy");
  await s.joinGame(ctx, "700001", "bob");
  await s.setGamePlayerScores(ctx, done.id, [{ name: "amy", score: 800 }, { name: "bob", score: 300 }]);
  // Deviation from the brief: InsertGameResponse requires tenantId explicitly
  // (createGameResponse doesn't derive it from ctx the way createGame does —
  // see server/game-room-manager.ts's own callers, which always pass it), so
  // omitting it (as the brief's snippet did) leaves response.tenantId
  // undefined and MemStorage's inTenant() filter silently drops every row.
  await s.createGameResponse(ctx, { tenantId: 1, gameId: done.id, playerName: "amy", questionIndex: 0, selectedAnswer: 0, responseTime: 900, isCorrect: true, pointsEarned: 800 } as any);
  await s.createGameResponse(ctx, { tenantId: 1, gameId: done.id, playerName: "bob", questionIndex: 0, selectedAnswer: 1, responseTime: 1200, isCorrect: false, pointsEarned: 0 } as any);
  done = (await s.updateGame(ctx, done.id, { status: "completed" } as any))!;
  return { quiz, done, open, foreign };
}

test("report routes: 401 without auth on all four endpoints", async () => {
  const s = new MemStorage();
  const { quiz } = await seed(s);
  await withServer(makeApp(s), async (base) => {
    for (const path of [
      "/api/games/700001/report.xlsx", "/api/games/700001/report.csv",
      `/api/quizzes/${quiz.id}/report.xlsx`, `/api/quizzes/${quiz.id}/report.csv`,
    ]) {
      assert.equal((await fetch(base + path)).status, 401, path);
    }
  });
});

test("game report: 404 unknown pin, 403 non-host, 409 not completed", async () => {
  const s = new MemStorage();
  await seed(s);
  await withServer(makeApp(s), async (base) => {
    assert.equal((await fetch(`${base}/api/games/999999/report.xlsx`, { headers: AUTH })).status, 404);
    assert.equal((await fetch(`${base}/api/games/700003/report.xlsx`, { headers: AUTH })).status, 403);
    assert.equal((await fetch(`${base}/api/games/700002/report.xlsx`, { headers: AUTH })).status, 409);
  });
});

test("game report xlsx: attachment with parseable workbook, ranked players", async () => {
  const s = new MemStorage();
  await seed(s);
  await withServer(makeApp(s), async (base) => {
    const res = await fetch(`${base}/api/games/700001/report.xlsx`, { headers: AUTH });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /spreadsheetml/);
    assert.match(res.headers.get("content-disposition") ?? "", /report-quiz-game-700001-report\.xlsx/);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
    assert.equal(wb.worksheets.length, 3);
    const players = wb.worksheets[1];
    assert.equal(players.getRow(2).getCell(2).text, "amy"); // 800 ranks first
    assert.equal(players.getRow(2).getCell(4).text, "1/2");
  });
});

test("game report csv honors ?lang=ar headers", async () => {
  const s = new MemStorage();
  await seed(s);
  await withServer(makeApp(s), async (base) => {
    const res = await fetch(`${base}/api/games/700001/report.csv?lang=ar`, { headers: AUTH });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    const text = await res.text();
    assert.ok(text.includes(REPORT_STRINGS.ar.player));
  });
});

test("quiz report: 404 unknown, 403 non-owner, xlsx includes only completed games", async () => {
  const s = new MemStorage();
  const { quiz } = await seed(s);
  await withServer(makeApp(s), async (base) => {
    assert.equal((await fetch(`${base}/api/quizzes/424242/report.xlsx`, { headers: AUTH })).status, 404);
    assert.equal((await fetch(`${base}/api/quizzes/${quiz.id}/report.xlsx`, { headers: { "x-test-user": "9" } })).status, 403);
    const res = await fetch(`${base}/api/quizzes/${quiz.id}/report.xlsx`, { headers: AUTH });
    assert.equal(res.status, 200);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
    const sessions = wb.worksheets[1];
    const pins: string[] = [];
    sessions.eachRow((row, n) => { if (n > 1) pins.push(row.getCell(2).text); });
    assert.deepEqual(pins.sort(), ["700001", "700003"]); // completed only; active 700002 excluded
  });
});
