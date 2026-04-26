import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

class FakeSocket {
  readyState = WebSocket.OPEN;
  sent: any[] = [];
  closed = false;

  send(payload: string) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
  }

  terminate() {
    this.close();
  }

  ping() {
    // no-op for tests
  }
}

async function createRuntimeFixture() {
  const [{ GameRoomManager }, { MemStorage }] = await Promise.all([
    import("./game-room-manager"),
    import("./storage"),
  ]);

  const storage = new MemStorage();
  const game = await storage.createGame({
    quizId: 1,
    gamePin: "123456",
    hostId: 1,
    status: "waiting",
  });
  await storage.updateGame(game.id, {
    players: [{ name: "Alice", score: 0 }],
  });

  const manager = new GameRoomManager(storage);
  const hostSocket = new FakeSocket();
  const playerSocket = new FakeSocket();

  await manager.registerClient({
    ws: hostSocket as unknown as WebSocket,
    gamePin: "123456",
    userId: 1,
    wantsHostRole: true,
  });
  await manager.registerClient({
    ws: playerSocket as unknown as WebSocket,
    gamePin: "123456",
    wantsHostRole: false,
    playerName: "Alice",
  });

  return { manager, storage, hostSocket, playerSocket };
}

test("runtime room starts a server-authoritative question", async () => {
  const { manager, hostSocket, playerSocket } = await createRuntimeFixture();

  const game = await manager.startGame("123456", 1);

  assert.equal(game.status, "active");
  assert.equal(game.currentQuestion, 0);
  assert.ok(hostSocket.sent.some((event) => event.type === "game_started"));
  assert.ok(hostSocket.sent.some((event) => event.type === "question_started"));
  assert.ok(playerSocket.sent.some((event) => event.type === "question_started"));

  const questionStarted = playerSocket.sent.find((event) => event.type === "question_started");
  assert.equal(questionStarted.questionIndex, 0);
  assert.equal(typeof questionStarted.timeRemaining, "number");
});

test("runtime room rejects duplicate answers and flushes accepted answers on question close", async () => {
  const { manager, storage, hostSocket } = await createRuntimeFixture();

  await manager.startGame("123456", 1);

  const answer = await manager.submitAnswer({
    gamePin: "123456",
    playerName: "Alice",
    questionIndex: 0,
    selectedAnswer: 0,
  });
  assert.deepEqual(answer, { success: true });

  const duplicate = await manager.submitAnswer({
    gamePin: "123456",
    playerName: "Alice",
    questionIndex: 0,
    selectedAnswer: 0,
  }).catch((error) => manager.toHttpError(error));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "DUPLICATE_ANSWER");

  const next = await manager.advanceQuestion("123456", 1);
  assert.equal(next.gameComplete, false);
  assert.equal(next.game.currentQuestion, 1);

  const responses = await storage.getGameResponses(1);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].playerName, "Alice");
  assert.equal(responses[0].isCorrect, true);
  assert.ok(responses[0].pointsEarned > 0);
  assert.ok(hostSocket.sent.some((event) => event.type === "question_closed"));
});

test("runtime room rejects late answers after the question is closed", async () => {
  const { manager } = await createRuntimeFixture();

  await manager.startGame("123456", 1);
  await manager.advanceQuestion("123456", 1);

  const lateAnswer = await manager.submitAnswer({
    gamePin: "123456",
    playerName: "Alice",
    questionIndex: 0,
    selectedAnswer: 0,
  }).catch((error) => manager.toHttpError(error));

  assert.equal(lateAnswer.status, 409);
  assert.equal(lateAnswer.body.code, "QUESTION_CLOSED");
});

test("runtime room persists final scores when completing the game", async () => {
  const { manager, storage } = await createRuntimeFixture();

  await manager.startGame("123456", 1);
  await manager.submitAnswer({
    gamePin: "123456",
    playerName: "Alice",
    questionIndex: 0,
    selectedAnswer: 0,
  });

  await manager.advanceQuestion("123456", 1);
  await manager.advanceQuestion("123456", 1);
  const completed = await manager.advanceQuestion("123456", 1);

  assert.equal(completed.gameComplete, true);
  assert.equal(completed.game.status, "completed");

  const persistedGame = await storage.getGameByPin("123456");
  assert.equal(persistedGame?.status, "completed");
  const players = persistedGame?.players as any[];
  assert.ok(players[0].score > 0);
});
