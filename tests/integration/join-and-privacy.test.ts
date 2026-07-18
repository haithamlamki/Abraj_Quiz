import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  BASE_URL,
  assertServerUp,
  cleanupTestData,
  createTestGame,
  createTestQuiz,
  createTestUser,
  endPool,
  sweepAllPrefixedTestData,
} from "./helpers";

const ORIGIN = BASE_URL;

describe("POST /api/games/:pin/join — concurrent joins do not overwrite each other", () => {
  const usedPrefixes: string[] = [];

  beforeAll(async () => {
    await assertServerUp();
    await sweepAllPrefixedTestData();
  });

  afterEach(async () => {
    while (usedPrefixes.length) {
      const p = usedPrefixes.pop();
      if (p) await cleanupTestData(p);
    }
  });

  afterAll(async () => {
    await sweepAllPrefixedTestData();
  });

  it("keeps every player when 400 join simultaneously (concentrated rush)", async () => {
    const { agent, prefix } = await createTestUser("concjoin");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(agent);
    const { pin } = await createTestGame(agent, quiz.id);

    // The realistic worst case: up to 400 players hit /join in a rush at the
    // start of the quiz.
    const N = 400;
    const names = Array.from({ length: N }, (_, i) => `${prefix}_p${i}`);
    const results = await Promise.all(
      names.map((playerName) =>
        fetch(`${BASE_URL}/api/games/${pin}/join`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify({ playerName }),
        }).then((r) => r.status),
      ),
    );

    // The invariant Fix #2 guarantees, independent of pool size / DB proximity:
    //   1. NO HTTP 500s. The old row-locked path exhausted the pool and 500'd
    //      under this load; the new path either accepts (200) or applies
    //      CONTROLLED backpressure (503 GAME_BUSY) — never an uncontrolled 500.
    //   2. NO data loss / duplication: every accepted (200) player appears in
    //      the authoritative roster exactly once.
    // Reaching 100% first-try 200s additionally needs Fix #3 (pool) / Fix #4
    // (co-location) — deferred — so we don't assert 400/400 here.
    const ok = results.filter((s) => s === 200).length;
    const busy = results.filter((s) => s === 503).length;
    expect(results.filter((s) => s >= 500 && s !== 503)).toHaveLength(0);
    expect(ok + busy).toBe(N); // only accepted or controlled-busy — nothing else
    expect(ok).toBeGreaterThan(0);

    // The roster must equal exactly the accepted players — none lost, none
    // duplicated, none phantom-inserted by a busy/rejected attempt.
    const snap = await fetch(`${BASE_URL}/api/games/${pin}`, { headers: { origin: ORIGIN } });
    expect(snap.status).toBe(200);
    const game = await snap.json();
    const persisted = (game.players as Array<{ name: string }>).map((p) => p.name).sort();
    expect(new Set(persisted).size).toBe(persisted.length); // no duplicates
    expect(persisted.every((n) => names.includes(n))).toBe(true); // no phantoms
    expect(persisted).toHaveLength(ok); // roster count == accepted count
  }, 60_000);

  it("rejects a duplicate name even under concurrency (only one wins)", async () => {
    const { agent, prefix } = await createTestUser("concdup");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(agent);
    const { pin } = await createTestGame(agent, quiz.id);

    const name = `${prefix}_same`;
    const statuses = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`${BASE_URL}/api/games/${pin}/join`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify({ playerName: name }),
        }).then((r) => r.status),
      ),
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(4);

    const snap = await fetch(`${BASE_URL}/api/games/${pin}`, { headers: { origin: ORIGIN } });
    const game = await snap.json();
    expect((game.players as any[]).filter((p) => p.name === name)).toHaveLength(1);
  });

  // GAME_FULL enforcement is server-side (the cap comes from the server's
  // MAX_PLAYERS_PER_GAME env, which the test process can't set). To exercise it
  // end-to-end, start the dev server with a small cap and mirror it here:
  //   MAX_PLAYERS_PER_GAME=3 npm run dev
  //   IT_MAX_PLAYERS=3 npm run integration
  // Unit tests cover the cap deterministically; this is the HTTP-contract check.
  const cap = Number(process.env.IT_MAX_PLAYERS);
  const capConfigured = Number.isInteger(cap) && cap > 0 && cap <= 50;
  (capConfigured ? it : it.skip)(
    "returns 409 GAME_FULL once the configured cap is reached",
    async () => {
      const { agent, prefix } = await createTestUser("gamefull");
      usedPrefixes.push(prefix);
      const quiz = await createTestQuiz(agent);
      const { pin } = await createTestGame(agent, quiz.id);

      // Fill exactly to the cap.
      for (let i = 0; i < cap; i++) {
        const r = await fetch(`${BASE_URL}/api/games/${pin}/join`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify({ playerName: `${prefix}_p${i}` }),
        });
        expect(r.status).toBe(200);
      }

      // One past the cap is a controlled 409 GAME_FULL, not a 500.
      const overflow = await fetch(`${BASE_URL}/api/games/${pin}/join`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ playerName: `${prefix}_overflow` }),
      });
      expect(overflow.status).toBe(409);
      expect((await overflow.json()).code).toBe("GAME_FULL");
    },
  );
});

describe("GET /api/quizzes/:id — private quizzes are owner-only", () => {
  const usedPrefixes: string[] = [];

  beforeAll(async () => {
    await assertServerUp();
    await sweepAllPrefixedTestData();
  });

  afterEach(async () => {
    while (usedPrefixes.length) {
      const p = usedPrefixes.pop();
      if (p) await cleanupTestData(p);
    }
  });

  afterAll(async () => {
    await sweepAllPrefixedTestData();
    await endPool();
  });

  it("hides a private quiz from non-owners (404) but lets its owner read it", async () => {
    const { agent: owner, prefix: ownerPrefix } = await createTestUser("privowner");
    usedPrefixes.push(ownerPrefix);
    const priv = await createTestQuiz(owner, { isPublic: false });

    // Owner can read their own private quiz (with the canonical correctAnswers).
    const ownerRes = await owner.fetch(`/api/quizzes/${priv.id}`);
    expect(ownerRes.status).toBe(200);
    const ownerBody = await ownerRes.json();
    expect(Array.isArray(ownerBody.questions[0].correctAnswers)).toBe(true);
    expect(typeof ownerBody.questions[0].correctAnswers[0]).toBe("number");

    // A different authenticated user in the same tenant gets 404, not the quiz.
    const { agent: other, prefix: otherPrefix } = await createTestUser("privother");
    usedPrefixes.push(otherPrefix);
    const otherRes = await other.fetch(`/api/quizzes/${priv.id}`);
    expect(otherRes.status).toBe(404);

    // Unauthenticated request also gets 404.
    const anonRes = await fetch(`${BASE_URL}/api/quizzes/${priv.id}`, { headers: { origin: ORIGIN } });
    expect(anonRes.status).toBe(404);

    // A public quiz remains readable by others (both answer-key fields stripped).
    const pub = await createTestQuiz(owner, { isPublic: true });
    const pubRes = await other.fetch(`/api/quizzes/${pub.id}`);
    expect(pubRes.status).toBe(200);
    const pubBody = await pubRes.json();
    expect(pubBody.questions[0].correctAnswer).toBeUndefined();
    expect(pubBody.questions[0].correctAnswers).toBeUndefined();
  });

  it("prevents a non-owner from hosting (creating a game from) a private quiz", async () => {
    const { agent: owner, prefix: ownerPrefix } = await createTestUser("privhost");
    usedPrefixes.push(ownerPrefix);
    const priv = await createTestQuiz(owner, { isPublic: false });

    const { agent: other, prefix: otherPrefix } = await createTestUser("privhost");
    usedPrefixes.push(otherPrefix);

    // Non-owner cannot create a game from someone else's private quiz — this
    // closes the /results-based read of a private quiz.
    const attackRes = await other.fetch("/api/games", {
      method: "POST",
      body: JSON.stringify({ quizId: priv.id }),
    });
    expect(attackRes.status).toBe(404);

    // The owner still can.
    const ownerRes = await owner.fetch("/api/games", {
      method: "POST",
      body: JSON.stringify({ quizId: priv.id }),
    });
    expect(ownerRes.status).toBe(201);
  });
});
