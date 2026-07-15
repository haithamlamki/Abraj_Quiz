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

  it("keeps every player when 10 join simultaneously", async () => {
    const { agent, prefix } = await createTestUser("concjoin");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(agent);
    const { pin } = await createTestGame(agent, quiz.id);

    const N = 10;
    const names = Array.from({ length: N }, (_, i) => `${prefix}_p${i}`);
    const statuses = await Promise.all(
      names.map((playerName) =>
        fetch(`${BASE_URL}/api/games/${pin}/join`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify({ playerName }),
        }).then((r) => r.status),
      ),
    );
    expect(statuses.every((s) => s === 200)).toBe(true);

    // The authoritative roster must contain all N players — none lost to a
    // read-modify-write race on the jsonb players array.
    const snap = await fetch(`${BASE_URL}/api/games/${pin}`, { headers: { origin: ORIGIN } });
    expect(snap.status).toBe(200);
    const game = await snap.json();
    const persisted = (game.players as Array<{ name: string }>).map((p) => p.name).sort();
    expect(persisted).toEqual([...names].sort());
  });

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

    // Owner can read their own private quiz (with correctAnswer).
    const ownerRes = await owner.fetch(`/api/quizzes/${priv.id}`);
    expect(ownerRes.status).toBe(200);
    const ownerBody = await ownerRes.json();
    expect(typeof ownerBody.questions[0].correctAnswer).toBe("number");

    // A different authenticated user in the same tenant gets 404, not the quiz.
    const { agent: other, prefix: otherPrefix } = await createTestUser("privother");
    usedPrefixes.push(otherPrefix);
    const otherRes = await other.fetch(`/api/quizzes/${priv.id}`);
    expect(otherRes.status).toBe(404);

    // Unauthenticated request also gets 404.
    const anonRes = await fetch(`${BASE_URL}/api/quizzes/${priv.id}`, { headers: { origin: ORIGIN } });
    expect(anonRes.status).toBe(404);

    // A public quiz remains readable by others (correctAnswer stripped).
    const pub = await createTestQuiz(owner, { isPublic: true });
    const pubRes = await other.fetch(`/api/quizzes/${pub.id}`);
    expect(pubRes.status).toBe(200);
    const pubBody = await pubRes.json();
    expect(pubBody.questions[0].correctAnswer).toBeUndefined();
  });
});
