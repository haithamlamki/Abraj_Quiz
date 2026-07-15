import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { MemStorage, SYSTEM_CTX, requireTenantId } = await import("./storage");

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
