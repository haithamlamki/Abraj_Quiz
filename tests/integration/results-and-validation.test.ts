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

describe("GET /api/games/:pin/results — correctAnswer is not leaked mid-game", () => {
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
    // Note: the pg pool is a module singleton shared with the describe block
    // below; it is closed once in that block's afterAll (the file's last hook).
  });

  it("strips answer keys while the game is still in progress, and includes correctAnswers once completed", async () => {
    const { agent, prefix } = await createTestUser("resultsleak");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(agent); // 3 questions (stored in canonical correctAnswers[] shape)
    const { pin } = await createTestGame(agent, quiz.id);

    // While the game is in the lobby (status "waiting"), any caller could poll
    // this endpoint — it must NOT expose upcoming answers.
    const waitingRes = await fetch(`${BASE_URL}/api/games/${pin}/results`);
    expect(waitingRes.status).toBe(200);
    const waitingBody = await waitingRes.json();
    const waitingQuestions = waitingBody.game?.quiz?.questions ?? [];
    expect(waitingQuestions.length).toBeGreaterThan(0);
    for (const q of waitingQuestions) {
      // Both the legacy field and the canonical correct-set must be stripped.
      expect(q.correctAnswer).toBeUndefined();
      expect(q.correctAnswers).toBeUndefined();
    }
    // The games row's questions_snapshot (full question set incl. answer keys)
    // must never ride along on the game object either.
    expect(waitingBody.game.questionsSnapshot).toBeUndefined();

    // Host drives the game to completion over HTTP.
    const start = await agent.fetch(`/api/games/${pin}/start`, { method: "POST" });
    expect(start.status).toBe(200);
    let complete = false;
    for (let i = 0; i < quiz.questions.length && !complete; i++) {
      const adv = await agent.fetch(`/api/games/${pin}/next-question`, { method: "POST" });
      expect(adv.status).toBe(200);
      const advBody = await adv.json();
      complete = Boolean(advBody.gameComplete);
    }
    expect(complete).toBe(true);

    // After completion the final review + PDF report legitimately include answers.
    const doneRes = await fetch(`${BASE_URL}/api/games/${pin}/results`);
    expect(doneRes.status).toBe(200);
    const doneBody = await doneRes.json();
    const doneQuestions = doneBody.game?.quiz?.questions ?? [];
    expect(doneQuestions.length).toBeGreaterThan(0);
    for (const q of doneQuestions) {
      // Canonical shape: the completed-game review exposes correctAnswers[].
      expect(Array.isArray(q.correctAnswers)).toBe(true);
      expect(typeof q.correctAnswers[0]).toBe("number");
    }
    // quiz.questions legitimately carries answers post-completion, but the raw
    // games.questions_snapshot column must still never reach the client.
    expect(doneBody.game.questionsSnapshot).toBeUndefined();
  });
});

describe("Quiz id validation", () => {
  beforeAll(async () => {
    await assertServerUp();
  });

  afterAll(async () => {
    await endPool();
  });

  it("returns 400 (not 500) for a non-numeric quiz id", async () => {
    const res = await fetch(`${BASE_URL}/api/quizzes/not-a-number`);
    expect(res.status).toBe(400);
  });
});
