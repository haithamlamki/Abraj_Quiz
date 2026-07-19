import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { MemStorage, SYSTEM_CTX, requireTenantId, isTransientDbError, escapeLike } = await import("./storage");

const T1 = { tenantId: 1 } as const;
const T2 = { tenantId: 2 } as const;

test("requireTenantId throws on system context", () => {
  assert.equal(requireTenantId(T1), 1);
  assert.throws(() => requireTenantId(SYSTEM_CTX), /Tenant context required/);
});

test("users are isolated per tenant and usernames are per-tenant", async () => {
  const s = new MemStorage();
  const u1 = await s.createUser(T1, { username: "haitham", password: "x" });
  const u2 = await s.createUser(T2, { username: "haitham", password: "y" });
  assert.notEqual(u1.id, u2.id);
  assert.equal((await s.getUserByUsername(T1, "haitham"))?.id, u1.id);
  assert.equal((await s.getUserByUsername(T2, "haitham"))?.id, u2.id);
  assert.equal(await s.getUser(T2, u1.id), undefined);
  assert.equal((await s.getUser(SYSTEM_CTX, u1.id))?.id, u1.id);
});

test("quizzes are isolated per tenant", async () => {
  const s = new MemStorage();
  const q = await s.createQuiz(T2, {
    title: "PDO Safety", description: "", questions: [], background: "classroom",
    isPublic: true, createdBy: 1,
  });
  assert.equal(q.tenantId, 2);
  assert.equal(await s.getQuiz(T1, q.id), undefined);
  assert.equal((await s.getQuiz(T2, q.id))?.id, q.id);
  const t1Public = await s.getPublicQuizzes(T1);
  assert.ok(!t1Public.some((row) => row.id === q.id));
});

test("games: tenant-scoped pin lookup, system sees all", async () => {
  const s = new MemStorage();
  const g = await s.createGame(T2, { quizId: 1, gamePin: "654321", hostId: 1, status: "waiting" });
  assert.equal(g.tenantId, 2);
  assert.equal(await s.getGameByPin(T1, "654321"), undefined);
  assert.equal((await s.getGameByPin(T2, "654321"))?.id, g.id);
  assert.equal((await s.getGameByPin(SYSTEM_CTX, "654321"))?.id, g.id);
});

test("joinGame inserts into game_players and rejects duplicates, closed games, and unknown pins", async () => {
  const s = new MemStorage();
  const g = await s.createGame(T2, { quizId: 1, gamePin: "222333", hostId: 1, status: "waiting" });

  const first = await s.joinGame(T2, "222333", "Alice");
  assert.equal(first.status, "ok");
  assert.equal((first as any).playerCount, 1);
  assert.equal((first as any).player.name, "Alice");

  const second = await s.joinGame(T2, "222333", "Bob");
  assert.equal(second.status, "ok");
  assert.equal((second as any).playerCount, 2);

  // The authoritative roster lives in game_players, NOT games.players (frozen).
  const roster = await s.getGamePlayers(T2, g.id);
  assert.deepEqual(roster.map((p) => p.name), ["Alice", "Bob"]);
  assert.deepEqual(((await s.getGame(T2, g.id))?.players as any[]) ?? [], []);
  assert.equal(await s.countGamePlayers(T2, g.id), 2);

  // Case-insensitive duplicate rejection (DB unique index on lower(name)).
  assert.equal((await s.joinGame(T2, "222333", "alice")).status, "duplicate");

  // Wrong tenant cannot see the game.
  assert.equal((await s.joinGame(T1, "222333", "Eve")).status, "not_found");

  // Unknown pin.
  assert.equal((await s.joinGame(T2, "999999", "Eve")).status, "not_found");

  // Not accepting players once started.
  await s.updateGame(T2, g.id, { status: "active" });
  assert.equal((await s.joinGame(T2, "222333", "Carol")).status, "not_waiting");
});

test("joinGame enforces the configurable player cap with status 'full'", async () => {
  const prev = process.env.MAX_PLAYERS_PER_GAME;
  process.env.MAX_PLAYERS_PER_GAME = "2";
  try {
    const s = new MemStorage();
    await s.createGame(T2, { quizId: 1, gamePin: "770077", hostId: 1, status: "waiting" });

    assert.equal((await s.joinGame(T2, "770077", "P1")).status, "ok");
    assert.equal((await s.joinGame(T2, "770077", "P2")).status, "ok");
    // Third joiner exceeds the cap of 2.
    assert.equal((await s.joinGame(T2, "770077", "P3")).status, "full");
    // The over-cap joiner left no row behind.
    assert.equal((await s.countGamePlayers(T2, (await s.getGameByPin(T2, "770077"))!.id)), 2);
  } finally {
    if (prev === undefined) delete process.env.MAX_PLAYERS_PER_GAME;
    else process.env.MAX_PLAYERS_PER_GAME = prev;
  }
});

test("setGamePlayerScores updates roster scores by case-insensitive name", async () => {
  const s = new MemStorage();
  const g = await s.createGame(T2, { quizId: 1, gamePin: "556677", hostId: 1, status: "waiting" });
  await s.joinGame(T2, "556677", "Alice");
  await s.joinGame(T2, "556677", "Bob");

  await s.setGamePlayerScores(SYSTEM_CTX, g.id, [
    { name: "alice", score: 900 },
    { name: "BOB", score: 400 },
  ]);

  const roster = await s.getGamePlayers(T2, g.id);
  assert.equal(roster.find((p) => p.name === "Alice")?.score, 900);
  assert.equal(roster.find((p) => p.name === "Bob")?.score, 400);
});

test("game responses carry explicit tenantId and latest-completed is tenant-scoped", async () => {
  const s = new MemStorage();
  const g = await s.createGame(T2, { quizId: 1, gamePin: "111222", hostId: 1, status: "waiting" });
  const r = await s.createGameResponse(SYSTEM_CTX, {
    tenantId: 2, gameId: g.id, playerName: "A", questionIndex: 0,
    selectedAnswer: 1, responseTime: 500, isCorrect: true, pointsEarned: 100,
  });
  assert.equal(r.tenantId, 2);
  await s.updateGame(SYSTEM_CTX, g.id, { status: "completed" });
  // quiz 1 exists in sample data (tenant 1); latest completed for T1 must not be tenant 2's game
  const latestT1 = await s.getLatestCompletedGame(T1);
  assert.notEqual(latestT1?.game.id, g.id);
});

test("tenant CRUD requires system context", async () => {
  const s = new MemStorage();
  await assert.rejects(
    () => s.createTenant(T1, { slug: "acme", name: "Acme", domains: [], branding: {}, features: {}, status: "active" }),
    /System context required/,
  );
  const t = await s.createTenant(SYSTEM_CTX, {
    slug: "acme", name: "Acme", domains: ["acmequiz.com"], branding: {}, features: {}, status: "active",
  });
  assert.ok(t.id > 0);
  assert.ok((await s.getTenants(SYSTEM_CTX)).some((x) => x.slug === "acme"));
  const updated = await s.updateTenant(SYSTEM_CTX, t.id, { name: "Acme Inc" });
  assert.equal(updated?.name, "Acme Inc");
  assert.equal((await s.getTenant(SYSTEM_CTX, t.id))?.name, "Acme Inc");
});

test("updateTenant shallow-merges branding and features instead of replacing them", async () => {
  const s = new MemStorage();
  const t = await s.createTenant(SYSTEM_CTX, {
    slug: "merge-co", name: "Merge Co", domains: [],
    branding: { appName: "X", pdf: { headerText: "H" } } as any,
    features: {}, status: "active",
  });
  const updated = await s.updateTenant(SYSTEM_CTX, t.id, { branding: { appName: "Y" } as any });
  assert.equal((updated?.branding as any)?.appName, "Y");
  assert.equal((updated?.branding as any)?.pdf?.headerText, "H");
});

test("createUser defaults isSuperAdmin to false", async () => {
  const s = new MemStorage();
  const u = await s.createUser(T1, { username: "regular", password: "x" });
  assert.equal(u.isSuperAdmin, false);
});

test("isTransientDbError: Supavisor 'max clients reached' rejection maps to busy/503, not 500", () => {
  // Exact shape observed in prod 2026-07-16: Supabase's pooler rejects clients
  // beyond its pool_size with FATAL XX000 (152 joins surfaced as HTTP 500s).
  const supavisorReject = Object.assign(
    new Error("max clients reached in session mode - max clients are limited to pool_size: 15"),
    { code: "XX000", severity: "FATAL" },
  );
  assert.equal(isTransientDbError(supavisorReject), true);
});

test("isTransientDbError: other XX000 internal errors are NOT transient", () => {
  const internal = Object.assign(new Error("could not access status of transaction 12345"), {
    code: "XX000",
  });
  assert.equal(isTransientDbError(internal), false);
});

test("deleteQuiz archives: hidden from listings, getQuiz still resolves, restore reverses", async () => {
  const s = new MemStorage();
  const q = await s.createQuiz(T1, {
    title: "To archive", description: "", questions: [], background: "classroom",
    isPublic: true, createdBy: 7,
  });

  const archived = await s.deleteQuiz(T1, q.id);
  assert.ok(archived?.deletedAt instanceof Date);

  // Hidden from every listing…
  assert.ok(!(await s.getPublicQuizzes(T1)).some((x) => x.id === q.id));
  assert.ok(!(await s.getQuizzes(T1)).some((x) => x.id === q.id));
  assert.ok(!(await s.getUserQuizzes(T1, 7)).some((x) => x.id === q.id));
  // …but still resolvable by id (completed-game results/PDF depend on this).
  assert.equal((await s.getQuiz(T1, q.id))?.id, q.id);
  // Archived listing shows it.
  assert.ok((await s.getUserQuizzes(T1, 7, { archived: true })).some((x) => x.id === q.id));

  const restored = await s.restoreQuiz(T1, q.id);
  assert.equal(restored?.deletedAt, null);
  assert.ok((await s.getUserQuizzes(T1, 7)).some((x) => x.id === q.id));
  assert.ok(!(await s.getUserQuizzes(T1, 7, { archived: true })).some((x) => x.id === q.id));
});

test("deleteQuiz/restoreQuiz respect tenant scoping and unknown ids", async () => {
  const s = new MemStorage();
  const q = await s.createQuiz(T2, {
    title: "Tenant2 quiz", description: "", questions: [], background: "classroom",
    isPublic: true, createdBy: 1,
  });
  // Wrong tenant cannot archive it.
  assert.equal(await s.deleteQuiz(T1, q.id), undefined);
  assert.equal((await s.getQuiz(T2, q.id))?.deletedAt ?? null, null);
  // Unknown id.
  assert.equal(await s.deleteQuiz(T2, 999999), undefined);
  assert.equal(await s.restoreQuiz(T2, 999999), undefined);
});

test("getQuizInsights aggregates completed games only, per-question stats, recent games", async () => {
  const s = new MemStorage();
  const quiz = await s.createQuiz(T1, {
    title: "Insights quiz", description: "", background: "classroom", isPublic: true, createdBy: 9,
    questions: [
      { question: "Q0?", answers: ["a", "b"], correctAnswer: 0, timeLimit: 10 },
      { question: "Q1?", answers: ["a", "b"], correctAnswer: 1, timeLimit: 10 },
    ],
  });

  // Completed game with 2 players and mixed answers.
  const g1 = await s.createGame(T1, { quizId: quiz.id, gamePin: "101010", hostId: 9, status: "waiting" });
  await s.joinGame(T1, "101010", "P1");
  await s.joinGame(T1, "101010", "P2");
  await s.setGamePlayerScores(SYSTEM_CTX, g1.id, [{ name: "P1", score: 800 }, { name: "P2", score: 400 }]);
  await s.createGameResponse(SYSTEM_CTX, { tenantId: 1, gameId: g1.id, playerName: "P1", questionIndex: 0, selectedAnswer: 0, responseTime: 1000, isCorrect: true,  pointsEarned: 800 });
  await s.createGameResponse(SYSTEM_CTX, { tenantId: 1, gameId: g1.id, playerName: "P2", questionIndex: 0, selectedAnswer: 1, responseTime: 3000, isCorrect: false, pointsEarned: 0 });
  await s.createGameResponse(SYSTEM_CTX, { tenantId: 1, gameId: g1.id, playerName: "P1", questionIndex: 1, selectedAnswer: 1, responseTime: 2000, isCorrect: true,  pointsEarned: 0 });
  await s.updateGame(T1, g1.id, { status: "completed" });

  // A waiting (NOT completed) game with a player — must be excluded everywhere.
  await s.createGame(T1, { quizId: quiz.id, gamePin: "202020", hostId: 9, status: "waiting" });
  await s.joinGame(T1, "202020", "Ghost");

  const ins = await s.getQuizInsights(T1, quiz.id);
  assert.ok(ins);
  assert.equal(ins!.gamesPlayed, 1);
  assert.equal(ins!.totalPlayers, 2);
  assert.equal(ins!.avgScore, 600);
  assert.ok(ins!.lastPlayedAt instanceof Date);

  assert.equal(ins!.questions.length, 2);
  const q0 = ins!.questions.find((q) => q.questionIndex === 0)!;
  assert.equal(q0.question, "Q0?");
  assert.equal(q0.totalResponses, 2);
  assert.equal(q0.correctRate, 0.5);
  assert.equal(q0.avgResponseMs, 2000);
  const q1 = ins!.questions.find((q) => q.questionIndex === 1)!;
  assert.equal(q1.totalResponses, 1);
  assert.equal(q1.correctRate, 1);
  // Answer keys never leak into insights.
  assert.ok(!JSON.stringify(ins).includes("correctAnswer"));

  assert.equal(ins!.recentGames.length, 1);
  assert.equal(ins!.recentGames[0].playerCount, 2);
  assert.equal(ins!.recentGames[0].avgScore, 600);

  // Tenant scoping + unknown id.
  assert.equal(await s.getQuizInsights(T2, quiz.id), undefined);
  assert.equal(await s.getQuizInsights(T1, 999999), undefined);
});

test("getQuizInsights: quiz with zero completed games returns zeroed shape with question rows", async () => {
  const s = new MemStorage();
  const quiz = await s.createQuiz(T1, {
    title: "Unplayed", description: "", background: "classroom", isPublic: true, createdBy: 9,
    questions: [{ question: "Only Q?", answers: ["a", "b"], correctAnswer: 0, timeLimit: 10 }],
  });
  const ins = await s.getQuizInsights(T1, quiz.id);
  assert.ok(ins);
  assert.equal(ins!.gamesPlayed, 0);
  assert.equal(ins!.totalPlayers, 0);
  assert.equal(ins!.avgScore, 0);
  assert.equal(ins!.lastPlayedAt, null);
  assert.equal(ins!.questions.length, 1);
  assert.deepEqual(
    ins!.questions[0],
    { questionIndex: 0, question: "Only Q?", totalResponses: 0, correctRate: 0, avgResponseMs: 0 },
  );
  assert.deepEqual(ins!.recentGames, []);
});

const SNAP_Q = (text: string, correct: number): any => ({
  question: text,
  type: "quiz",
  answerType: "single",
  answers: ["1", "2"],
  correctAnswers: [correct],
  timeLimit: 10,
  points: "standard",
});

test("insights: snapshot attribution survives quiz reorder/edit/delete", async () => {
  const s = new MemStorage();
  const quiz = await s.createQuiz(T1, {
    title: "Snap", description: "", background: "classroom", isPublic: true, createdBy: 1,
    questions: [SNAP_Q("Q-A", 0), SNAP_Q("Q-B", 1)],
  });
  const game = await s.createGame(T1, { quizId: quiz.id, gamePin: "424242", hostId: 1, status: "waiting" });
  // Freeze the played set (what room hydration does) and complete the game.
  await s.updateGame(T1, game.id, { questionsSnapshot: quiz.questions as any, status: "completed" });
  // One response per question: Q-A answered correctly, Q-B incorrectly.
  await s.createGameResponses(T1, [
    { tenantId: 1, gameId: game.id, playerName: "P", questionIndex: 0, selectedAnswer: 0, responseTime: 1000, isCorrect: true, pointsEarned: 100 },
    { tenantId: 1, gameId: game.id, playerName: "P", questionIndex: 1, selectedAnswer: 0, responseTime: 2000, isCorrect: false, pointsEarned: 0 },
  ]);
  // Now REORDER + EDIT the quiz: B moves first, A's text is edited away, new C added.
  await s.updateQuiz(T1, quiz.id, { questions: [SNAP_Q("Q-B", 1), SNAP_Q("Q-C", 0)] });

  const insights = await s.getQuizInsights(T1, quiz.id);
  const rows = insights!.questions;
  // Current-quiz order first (Q-B, Q-C), then the historical Q-A row.
  assert.deepEqual(rows.map((r) => r.question), ["Q-B", "Q-C", "Q-A"]);
  const byText = Object.fromEntries(rows.map((r) => [r.question, r]));
  assert.equal(byText["Q-B"].totalResponses, 1);   // via snapshot index 1 — did NOT follow the reorder
  assert.equal(byText["Q-B"].correctRate, 0);
  assert.equal(byText["Q-A"].totalResponses, 1);   // edited-away text keeps its history
  assert.equal(byText["Q-A"].correctRate, 1);
  assert.equal(byText["Q-A"].avgResponseMs, 1000);
  assert.equal(byText["Q-C"].totalResponses, 0);   // new question, no plays yet
});

test("insights: NULL-snapshot legacy game falls back to current-index attribution", async () => {
  const s = new MemStorage();
  const quiz = await s.createQuiz(T1, {
    title: "Legacy", description: "", background: "classroom", isPublic: true, createdBy: 1,
    questions: [SNAP_Q("L-1", 0), SNAP_Q("L-2", 1)],
  });
  const game = await s.createGame(T1, { quizId: quiz.id, gamePin: "434343", hostId: 1, status: "waiting" });
  await s.updateGame(T1, game.id, { status: "completed" }); // questionsSnapshot stays null
  await s.createGameResponses(T1, [
    { tenantId: 1, gameId: game.id, playerName: "P", questionIndex: 0, selectedAnswer: 0, responseTime: 500, isCorrect: true, pointsEarned: 100 },
  ]);
  const rows = (await s.getQuizInsights(T1, quiz.id))!.questions;
  assert.deepEqual(rows.map((r) => r.question), ["L-1", "L-2"]);
  assert.equal(rows[0].totalResponses, 1); // index 0 → current first question (old behavior)
  assert.equal(rows[0].correctRate, 1);
  assert.equal(rows[1].totalResponses, 0);
});

test("quizHasLiveGame: true for waiting/active games, false for completed/none/wrong tenant", async () => {
  const s = new MemStorage();
  const quiz = await s.createQuiz(T1, {
    title: "Live check", description: "", questions: [], background: "classroom",
    isPublic: false, createdBy: 3,
  });
  assert.equal(await s.quizHasLiveGame(T1, quiz.id), false);

  const g = await s.createGame(T1, { quizId: quiz.id, gamePin: "313131", hostId: 3, status: "waiting" });
  assert.equal(await s.quizHasLiveGame(T1, quiz.id), true);
  await s.updateGame(T1, g.id, { status: "active" });
  assert.equal(await s.quizHasLiveGame(T1, quiz.id), true);
  await s.updateGame(T1, g.id, { status: "completed" });
  assert.equal(await s.quizHasLiveGame(T1, quiz.id), false);

  assert.equal(await s.quizHasLiveGame(T2, quiz.id), false);
  assert.equal(await s.quizHasLiveGame(T1, 999999), false);
});

const BANK_Q = {
  question: "What is the boiling point of water?",
  type: "quiz" as const,
  answerType: "single" as const,
  answers: ["90C", "100C"],
  correctAnswers: [1],
  timeLimit: 20,
  points: "standard" as const,
};

test("bank questions: CRUD, tenant isolation, archive/restore", async () => {
  const s = new MemStorage();
  const created = await s.createBankQuestion(T1, { question: BANK_Q, subject: "Science", tags: ["water"], createdBy: 1 });
  assert.equal(created.tenantId, 1);
  assert.equal(created.createdBy, 1);
  assert.equal(created.subject, "Science");
  assert.equal(created.deletedAt, null);

  // Tenant isolation on read.
  assert.equal(await s.getBankQuestion(T2, created.id), undefined);
  assert.equal((await s.getBankQuestion(T1, created.id))?.id, created.id);
  assert.equal((await s.getBankQuestions(T2)).length, 0);

  // Update stamps updatedAt and merges fields.
  const before = created.updatedAt!.getTime();
  await new Promise((r) => setTimeout(r, 5));
  const updated = await s.updateBankQuestion(T1, created.id, { subject: "Physics" });
  assert.equal(updated?.subject, "Physics");
  assert.ok(updated!.updatedAt!.getTime() >= before);
  // Cross-tenant update refused.
  assert.equal(await s.updateBankQuestion(T2, created.id, { subject: "X" }), undefined);

  // Archive: leaves listings, stays resolvable by id, restore reverses.
  await s.archiveBankQuestion(T1, created.id);
  assert.equal((await s.getBankQuestions(T1)).length, 0);
  assert.equal((await s.getBankQuestions(T1, { archived: true })).length, 1);
  assert.ok((await s.getBankQuestion(T1, created.id))?.deletedAt);
  await s.restoreBankQuestion(T1, created.id);
  assert.equal((await s.getBankQuestions(T1)).length, 1);
});

test("bank questions: search / subject / tags filters and newest-updated ordering", async () => {
  const s = new MemStorage();
  const a = await s.createBankQuestion(T1, { question: { ...BANK_Q, question: "Fire extinguisher types?" }, subject: "Safety", tags: ["fire", "ppe"], createdBy: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const b = await s.createBankQuestion(T1, { question: { ...BANK_Q, question: "Boiling point of water?" }, subject: "Science", tags: ["water"], createdBy: 1 });

  // Default order: newest updated first.
  assert.deepEqual((await s.getBankQuestions(T1)).map((r) => r.id), [b.id, a.id]);
  // Search is case-insensitive substring over question text.
  assert.deepEqual((await s.getBankQuestions(T1, { search: "FIRE" })).map((r) => r.id), [a.id]);
  // Subject exact match.
  assert.deepEqual((await s.getBankQuestions(T1, { subject: "Science" })).map((r) => r.id), [b.id]);
  // Tags: row must contain ALL requested tags.
  assert.deepEqual((await s.getBankQuestions(T1, { tags: ["fire", "ppe"] })).map((r) => r.id), [a.id]);
  assert.equal((await s.getBankQuestions(T1, { tags: ["fire", "water"] })).length, 0);
});

test("getBankSubjectsAndTags: distinct over live rows only, tenant-scoped", async () => {
  const s = new MemStorage();
  await s.createBankQuestion(T1, { question: BANK_Q, subject: "Safety", tags: ["fire", "ppe"], createdBy: 1 });
  const dead = await s.createBankQuestion(T1, { question: BANK_Q, subject: "Ghost", tags: ["ghost"], createdBy: 1 });
  await s.archiveBankQuestion(T1, dead.id);
  await s.createBankQuestion(T1, { question: BANK_Q, subject: "Safety", tags: ["fire"], createdBy: 1 });
  await s.createBankQuestion(T2, { question: BANK_Q, subject: "OtherTenant", tags: ["other"], createdBy: 9 });

  const meta = await s.getBankSubjectsAndTags(T1);
  assert.deepEqual(meta.subjects.sort(), ["Safety"]);
  assert.deepEqual(meta.tags.sort(), ["fire", "ppe"]);
});

test("escapeLike escapes LIKE wildcards so ilike search matches literally", () => {
  assert.equal(escapeLike("50%_done\\"), "50\\%\\_done\\\\");
  assert.equal(escapeLike("plain text"), "plain text");
});

test("bank search treats % and _ as literal characters (MemStorage semantics)", async () => {
  const s = new MemStorage();
  await s.createBankQuestion(T1, { question: { ...BANK_Q, question: "Is 50% enough?" }, tags: [], createdBy: 1 });
  await s.createBankQuestion(T1, { question: { ...BANK_Q, question: "Is half enough?" }, tags: [], createdBy: 1 });
  assert.equal((await s.getBankQuestions(T1, { search: "50%" })).length, 1);
  assert.equal((await s.getBankQuestions(T1, { search: "%" })).length, 1);
});

test("createBankQuestions inserts many rows, stamps tenant + createdBy, tenant-isolated", async () => {
  const s = new MemStorage();
  const q = (text: string): any => ({ question: text, type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 10, points: "standard" });
  const rows = await s.createBankQuestions(T1, [
    { question: q("bulk-1"), subject: "S", tags: ["t"], createdBy: 7 },
    { question: q("bulk-2"), subject: undefined, tags: [], createdBy: 7 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tenantId, 1);
  assert.equal(rows[0].createdBy, 7);
  assert.equal((await s.getBankQuestions(T1)).length, 2);
  assert.equal((await s.getBankQuestions(T2)).length, 0);
  // empty input is a no-op
  assert.deepEqual(await s.createBankQuestions(T1, []), []);
});

test("getCompletedQuizGames: only completed games for the quiz, oldest first, tenant-scoped", async () => {
  const s = new MemStorage();
  const ctx = { tenantId: 1 };
  const quiz = await s.createQuiz(ctx, {
    title: "Report quiz", description: "", createdBy: 1, isPublic: false,
    questions: [{ question: "q?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" }],
  } as any);
  const other = await s.createQuiz(ctx, { title: "Other", description: "", createdBy: 1, isPublic: false, questions: [] } as any);

  const g1 = await s.createGame(ctx, { quizId: quiz.id, gamePin: "RPT001", hostId: 1, status: "completed" } as any);
  const g2 = await s.createGame(ctx, { quizId: quiz.id, gamePin: "RPT002", hostId: 1, status: "waiting" } as any);
  const g3 = await s.createGame(ctx, { quizId: quiz.id, gamePin: "RPT003", hostId: 1, status: "completed" } as any);
  await s.createGame(ctx, { quizId: other.id, gamePin: "RPT004", hostId: 1, status: "completed" } as any);

  const rows = await s.getCompletedQuizGames(ctx, quiz.id);
  assert.deepEqual(rows.map((g) => g.gamePin), ["RPT001", "RPT003"]);
  assert.ok(!rows.some((g) => g.id === g2.id));

  // Tenant isolation: a tenant-2 completed game on the same quizId is
  // invisible to tenant 1 and vice versa.
  const ctx2 = { tenantId: 2 };
  const t2game = await s.createGame(ctx2, { quizId: quiz.id, gamePin: "RPT005", hostId: 9, status: "completed" } as any);
  const t1rows = await s.getCompletedQuizGames(ctx, quiz.id);
  assert.ok(!t1rows.some((g) => g.id === t2game.id));
  const t2rows = await s.getCompletedQuizGames(ctx2, quiz.id);
  assert.deepEqual(t2rows.map((g) => g.gamePin), ["RPT005"]);
});

test("updateQuizWithVersion snapshots the PREVIOUS state and deletes the draft", async () => {
  const s = new MemStorage();
  const ctx = { tenantId: 1 };
  const quiz = await s.createQuiz(ctx, {
    title: "v1 title", description: "d", questions: [{ question: "q1", answers: ["a", "b"], correctAnswers: [0], type: "quiz", answerType: "single", timeLimit: 20, points: "standard" }],
    background: "classroom", isPublic: true, createdBy: 1,
  } as any);
  await s.upsertQuizDraft(ctx, quiz.id, { title: "wip", description: "", background: "classroom", isPublic: true, questions: [] });

  const updated = await s.updateQuizWithVersion(ctx, quiz.id, { title: "v2 title" });
  assert.equal(updated.title, "v2 title");

  const list = await s.listQuizVersions(ctx, quiz.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].versionNumber, 1);
  assert.equal(list[0].title, "v1 title");          // PREVIOUS state, not the new one
  assert.equal(list[0].questionCount, 1);

  const full = await s.getQuizVersion(ctx, quiz.id, 1);
  assert.equal(full?.title, "v1 title");
  assert.equal((full?.questions as any[]).length, 1);

  assert.equal(await s.getQuizDraft(ctx, quiz.id), undefined); // save killed the draft
});

test("updateQuizWithVersion prunes to MAX_QUIZ_VERSIONS, oldest first", async () => {
  const s = new MemStorage();
  const ctx = { tenantId: 1 };
  const quiz = await s.createQuiz(ctx, {
    title: "t0", questions: [], background: "classroom", isPublic: true, createdBy: 1,
  } as any);
  for (let i = 1; i <= 21; i++) {
    await s.updateQuizWithVersion(ctx, quiz.id, { title: `t${i}` });
  }
  const list = await s.listQuizVersions(ctx, quiz.id);
  assert.equal(list.length, 20);
  assert.equal(list[0].versionNumber, 21);           // newest first
  assert.equal(list[19].versionNumber, 2);           // version 1 pruned
  assert.equal(await s.getQuizVersion(ctx, quiz.id, 1), undefined);
});

test("quiz draft lifecycle: upsert overwrites, get returns latest, delete is idempotent", async () => {
  const s = new MemStorage();
  const ctx = { tenantId: 1 };
  const quiz = await s.createQuiz(ctx, {
    title: "t", questions: [], background: "classroom", isPublic: true, createdBy: 1,
  } as any);
  const d1 = await s.upsertQuizDraft(ctx, quiz.id, { title: "one", description: "", background: "classroom", isPublic: true, questions: [] });
  const d2 = await s.upsertQuizDraft(ctx, quiz.id, { title: "two", description: "", background: "classroom", isPublic: true, questions: [] });
  assert.equal(d1.quizId, d2.quizId);
  const got = await s.getQuizDraft(ctx, quiz.id);
  assert.equal((got?.payload as any).title, "two");
  await s.deleteQuizDraft(ctx, quiz.id);
  await s.deleteQuizDraft(ctx, quiz.id);             // idempotent — no throw
  assert.equal(await s.getQuizDraft(ctx, quiz.id), undefined);
});

test("versions and drafts are invisible from another tenant ctx", async () => {
  const s = new MemStorage();
  const ctx1 = { tenantId: 1 };
  const ctx2 = { tenantId: 2 };
  const quiz = await s.createQuiz(ctx1, {
    title: "t", questions: [], background: "classroom", isPublic: true, createdBy: 1,
  } as any);
  await s.updateQuizWithVersion(ctx1, quiz.id, { title: "t2" });
  await s.upsertQuizDraft(ctx1, quiz.id, { title: "wip", description: "", background: "classroom", isPublic: true, questions: [] });

  assert.deepEqual(await s.listQuizVersions(ctx2, quiz.id), []);
  assert.equal(await s.getQuizVersion(ctx2, quiz.id, 1), undefined);
  assert.equal(await s.getQuizDraft(ctx2, quiz.id), undefined);
});

test("upsertQuizDraft rejects a quizId from another tenant and leaves the draft untouched", async () => {
  const s = new MemStorage();
  const ctx1 = { tenantId: 1 };
  const ctx2 = { tenantId: 2 };
  const quiz = await s.createQuiz(ctx1, {
    title: "t", questions: [], background: "classroom", isPublic: true, createdBy: 1,
  } as any);
  await s.upsertQuizDraft(ctx1, quiz.id, { title: "mine", description: "", background: "classroom", isPublic: true, questions: [] });

  await assert.rejects(
    () => s.upsertQuizDraft(ctx2, quiz.id, { title: "stolen", description: "", background: "classroom", isPublic: true, questions: [] }),
    /Quiz not found/,
  );
  const draft = await s.getQuizDraft(ctx1, quiz.id);
  assert.equal((draft?.payload as any).title, "mine"); // tenant 1's draft untouched
});

test("createQuiz and updateQuizWithVersion persist the theme blob (overlay round-trip)", async () => {
  const s = new MemStorage();
  const ctx = { tenantId: 1 };
  const theme = { background: "classroom", accent: "#123456", overlay: 0.25 };

  const quiz = await s.createQuiz(ctx, {
    title: "t", questions: [], background: "classroom", isPublic: true, createdBy: 1,
    theme,
  } as any);
  assert.equal((await s.getQuiz(ctx, quiz.id))?.theme?.overlay, 0.25);

  const updated = await s.updateQuizWithVersion(ctx, quiz.id, {
    theme: { ...theme, overlay: 0.4 },
  });
  assert.equal((updated.theme as any)?.overlay, 0.4);
  assert.equal((await s.getQuiz(ctx, quiz.id))?.theme?.overlay, 0.4);
});
