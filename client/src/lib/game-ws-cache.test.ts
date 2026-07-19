import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveGameCacheAction } from "./game-ws-cache";

// The server pushes the full ClientGame snapshot inside game_started /
// game_updated / next_question / game_completed broadcasts (same shape the
// GET /api/games/:pin snapshot returns). These tests pin the client-side
// decision: apply pushed state directly, refetch only when the push can't
// cover us (reconnect catch-up), never refetch when the cache is already
// in sync — that refetch is what made the host render Q1 after the players.

const game = (over: Record<string, unknown> = {}) => ({
  gamePin: "12345",
  status: "active",
  currentQuestion: 0,
  players: [],
  ...over,
});

describe("resolveGameCacheAction", () => {
  for (const type of ["game_started", "game_updated", "next_question", "game_completed"] as const) {
    it(`${type} with a game payload applies it to the cache`, () => {
      const pushed = game();
      const action = resolveGameCacheAction({ type, game: pushed } as any, undefined);
      assert.deepEqual(action, { kind: "set", game: pushed });
    });

    it(`${type} without a game payload falls back to invalidate`, () => {
      const action = resolveGameCacheAction({ type } as any, game());
      assert.deepEqual(action, { kind: "invalidate" });
    });
  }

  it("question_started with an in-sync cache does nothing (no refetch stampede)", () => {
    const action = resolveGameCacheAction(
      { type: "question_started", gamePin: "12345", questionIndex: 2 } as any,
      game({ currentQuestion: 2 }),
    );
    assert.deepEqual(action, { kind: "none" });
  });

  it("question_started with a stale question index invalidates (reconnect catch-up)", () => {
    const action = resolveGameCacheAction(
      { type: "question_started", gamePin: "12345", questionIndex: 3 } as any,
      game({ currentQuestion: 2 }),
    );
    assert.deepEqual(action, { kind: "invalidate" });
  });

  it("question_started with a non-active cached status invalidates", () => {
    const action = resolveGameCacheAction(
      { type: "question_started", gamePin: "12345", questionIndex: 0 } as any,
      game({ status: "waiting" }),
    );
    assert.deepEqual(action, { kind: "invalidate" });
  });

  it("question_started with an empty cache invalidates", () => {
    const action = resolveGameCacheAction(
      { type: "question_started", gamePin: "12345", questionIndex: 0 } as any,
      undefined,
    );
    assert.deepEqual(action, { kind: "invalidate" });
  });

  it("question_closed invalidates (scores changed server-side)", () => {
    const action = resolveGameCacheAction({ type: "question_closed" } as any, game());
    assert.deepEqual(action, { kind: "invalidate" });
  });

  for (const type of ["time_remaining", "joined", "error"] as const) {
    it(`${type} leaves the cache alone`, () => {
      const action = resolveGameCacheAction({ type } as any, game());
      assert.deepEqual(action, { kind: "none" });
    });
  }
});
