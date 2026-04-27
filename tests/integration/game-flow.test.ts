import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertServerUp,
  cleanupTestData,
  connectAsHost,
  connectAsPlayer,
  createTestGame,
  createTestQuiz,
  createTestUser,
  endPool,
  joinGameAsPlayerHttp,
  sweepAllPrefixedTestData,
} from "./helpers";

describe("WebSocket game flow", () => {
  const usedPrefixes: string[] = [];
  const openStreams: { close: () => Promise<void> }[] = [];

  beforeAll(async () => {
    await assertServerUp();
    await sweepAllPrefixedTestData();
  });

  afterEach(async () => {
    while (openStreams.length) {
      const s = openStreams.pop();
      if (s) await s.close().catch(() => {});
    }
    while (usedPrefixes.length) {
      const p = usedPrefixes.pop();
      if (p) await cleanupTestData(p);
    }
  });

  afterAll(async () => {
    await sweepAllPrefixedTestData();
    await endPool();
  });

  it("1. host creates game and player joins — both see lobby update with player list", async () => {
    const { agent: hostAgent, sessionCookie, prefix } = await createTestUser("flow1");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(hostAgent);
    const { pin } = await createTestGame(hostAgent, quiz.id);

    const hostStream = await connectAsHost(pin, sessionCookie);
    openStreams.push(hostStream);

    await joinGameAsPlayerHttp(pin, "Alice");

    const updateForHost = await hostStream.waitFor((m) => {
      return m.type === "game_updated" && Array.isArray(m.game?.players) && m.game.players.some((p: any) => p.name === "Alice");
    });
    expect(updateForHost.game.players.find((p: any) => p.name === "Alice")).toBeTruthy();

    const playerStream = await connectAsPlayer(pin, "Alice");
    openStreams.push(playerStream);
    expect(playerStream.messages.some((m: any) => m.type === "joined" && m.isHost === false)).toBe(true);
  });

  it("2. multiple players join and every connected client sees the updated list", async () => {
    const { agent: hostAgent, sessionCookie, prefix } = await createTestUser("flow2");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(hostAgent);
    const { pin } = await createTestGame(hostAgent, quiz.id);

    const hostStream = await connectAsHost(pin, sessionCookie);
    openStreams.push(hostStream);

    for (const name of ["P1", "P2", "P3"]) {
      await joinGameAsPlayerHttp(pin, name);
      await hostStream.waitFor(
        (m) => m.type === "game_updated" && m.game?.players?.some((p: any) => p.name === name),
      );
    }

    const lastUpdate = [...hostStream.messages].reverse().find((m: any) => m.type === "game_updated") as any;
    expect(lastUpdate).toBeTruthy();
    const names = lastUpdate.game.players.map((p: any) => p.name).sort();
    expect(names).toEqual(["P1", "P2", "P3"]);

    const p1Stream = await connectAsPlayer(pin, "P1");
    openStreams.push(p1Stream);
    expect(p1Stream.messages.some((m: any) => m.type === "joined" && m.isHost === false)).toBe(true);
  });

  it("3. host starts game and broadcast of question_started has NO correctAnswer", async () => {
    const { agent: hostAgent, sessionCookie, prefix } = await createTestUser("flow3");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(hostAgent);
    const { pin } = await createTestGame(hostAgent, quiz.id);

    const hostStream = await connectAsHost(pin, sessionCookie);
    openStreams.push(hostStream);

    await joinGameAsPlayerHttp(pin, "Bob");
    const playerStream = await connectAsPlayer(pin, "Bob");
    openStreams.push(playerStream);

    const startRes = await hostAgent.fetch(`/api/games/${pin}/start`, { method: "POST", body: "{}" });
    expect(startRes.status).toBe(200);

    const questionStartedHost = await hostStream.waitFor((m) => m.type === "question_started" && m.questionIndex === 0);
    const questionStartedPlayer = await playerStream.waitFor((m) => m.type === "question_started" && m.questionIndex === 0);

    expect((questionStartedHost as any).correctAnswer).toBeUndefined();
    expect((questionStartedPlayer as any).correctAnswer).toBeUndefined();
    for (const m of [...hostStream.messages, ...playerStream.messages]) {
      if ((m as any).type === "question_started") {
        expect((m as any).correctAnswer).toBeUndefined();
      }
    }
  });

  it("4. player submits correct answer and is scored after host advances", async () => {
    const { agent: hostAgent, sessionCookie, prefix } = await createTestUser("flow4");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(hostAgent);
    const { pin } = await createTestGame(hostAgent, quiz.id);

    const hostStream = await connectAsHost(pin, sessionCookie);
    openStreams.push(hostStream);

    await joinGameAsPlayerHttp(pin, "Carol");
    const playerStream = await connectAsPlayer(pin, "Carol");
    openStreams.push(playerStream);

    await hostAgent.fetch(`/api/games/${pin}/start`, { method: "POST", body: "{}" });
    await playerStream.waitFor((m) => m.type === "question_started" && m.questionIndex === 0);

    const correctIndex = quiz.questions[0].correctAnswer;
    const answerRes = await fetch(`http://localhost:5000/api/games/${pin}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5000" },
      body: JSON.stringify({ playerName: "Carol", questionIndex: 0, selectedAnswer: correctIndex, responseTime: 1000 }),
    });
    expect(answerRes.status).toBe(200);
    const answerBody = await answerRes.json();
    expect(answerBody).toEqual({ success: true });
    expect((answerBody as any).correctAnswer).toBeUndefined();
    expect((answerBody as any).pointsEarned).toBeUndefined();
    expect((answerBody as any).isCorrect).toBeUndefined();

    const advanceRes = await hostAgent.fetch(`/api/games/${pin}/next-question`, { method: "POST", body: "{}" });
    expect(advanceRes.status).toBe(200);
    const advanceBody = (await advanceRes.json()) as { game: { players: Array<{ name: string; score: number }> } };
    const carol = advanceBody.game.players.find((p) => p.name === "Carol");
    expect(carol).toBeTruthy();
    expect(carol!.score).toBeGreaterThan(0);
  });

  it("5. duplicate answer is rejected with code DUPLICATE_ANSWER", async () => {
    const { agent: hostAgent, sessionCookie, prefix } = await createTestUser("flow5");
    usedPrefixes.push(prefix);
    const quiz = await createTestQuiz(hostAgent);
    const { pin } = await createTestGame(hostAgent, quiz.id);

    const hostStream = await connectAsHost(pin, sessionCookie);
    openStreams.push(hostStream);

    await joinGameAsPlayerHttp(pin, "Dave");
    const playerStream = await connectAsPlayer(pin, "Dave");
    openStreams.push(playerStream);

    await hostAgent.fetch(`/api/games/${pin}/start`, { method: "POST", body: "{}" });
    await playerStream.waitFor((m) => m.type === "question_started" && m.questionIndex === 0);

    const submit = (selected: number) =>
      fetch(`http://localhost:5000/api/games/${pin}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:5000" },
        body: JSON.stringify({ playerName: "Dave", questionIndex: 0, selectedAnswer: selected, responseTime: 800 }),
      });

    const first = await submit(quiz.questions[0].correctAnswer);
    expect(first.status).toBe(200);

    const second = await submit(quiz.questions[0].correctAnswer);
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.code).toBe("DUPLICATE_ANSWER");
  });

  it("6. non-host cannot start the game (403)", async () => {
    const { agent: hostAgent, sessionCookie: hostCookie, prefix: hostPrefix } = await createTestUser("flow6h");
    usedPrefixes.push(hostPrefix);
    const quiz = await createTestQuiz(hostAgent);
    const { pin } = await createTestGame(hostAgent, quiz.id);

    const { agent: playerAgent, prefix: playerPrefix } = await createTestUser("flow6p");
    usedPrefixes.push(playerPrefix);

    await joinGameAsPlayerHttp(pin, "Eve");

    const hostStream = await connectAsHost(pin, hostCookie);
    openStreams.push(hostStream);
    const playerStream = await connectAsPlayer(pin, "Eve");
    openStreams.push(playerStream);

    const res = await playerAgent.fetch(`/api/games/${pin}/start`, { method: "POST", body: "{}" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/host/i);
  });
});
