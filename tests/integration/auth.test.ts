import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  BASE_URL,
  assertServerUp,
  cleanupTestData,
  createTestQuiz,
  createTestUser,
  endPool,
  sweepAllPrefixedTestData,
} from "./helpers";

describe("GET /api/quizzes/:id — correctAnswer disclosure", () => {
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

  it("does NOT include correctAnswer for unauthenticated requests", async () => {
    const { agent, prefix } = await createTestUser("authleak");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(agent);

    const res = await fetch(`${BASE_URL}/api/quizzes/${quiz.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.questions)).toBe(true);
    expect(body.questions.length).toBeGreaterThan(0);
    for (const question of body.questions) {
      // Both the legacy field and the canonical correct-set must be stripped.
      expect(question.correctAnswer).toBeUndefined();
      expect(question.correctAnswers).toBeUndefined();
    }
  });

  it("does NOT include correctAnswer for non-creator authenticated requests", async () => {
    const { agent: creatorAgent, prefix: creatorPrefix } = await createTestUser("authleak");
    usedPrefixes.push(creatorPrefix);
    const quiz = await createTestQuiz(creatorAgent);

    const { agent: otherAgent, prefix: otherPrefix } = await createTestUser("authleak");
    usedPrefixes.push(otherPrefix);

    const res = await otherAgent.fetch(`/api/quizzes/${quiz.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const question of body.questions) {
      expect(question.correctAnswer).toBeUndefined();
      expect(question.correctAnswers).toBeUndefined();
    }
  });

  it("DOES include correctAnswers when the creator fetches their own quiz", async () => {
    const { agent, prefix } = await createTestUser("authleak");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(agent);

    const res = await agent.fetch(`/api/quizzes/${quiz.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions.length).toBeGreaterThan(0);
    for (const question of body.questions) {
      // Canonical shape (normalized on write): correctAnswers[] carries the
      // key; the legacy correctAnswer field no longer exists on stored quizzes.
      expect(Array.isArray(question.correctAnswers)).toBe(true);
      expect(question.correctAnswers.length).toBeGreaterThan(0);
      for (const idx of question.correctAnswers) {
        expect(typeof idx).toBe("number");
      }
    }
  });
});
