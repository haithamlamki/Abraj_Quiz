import type { WsServerMessage } from "@shared/ws-protocol";

// What a WS server message should do to the cached ["/api/games", pin] query.
//
// The game-carrying broadcasts (game_started / game_updated / next_question /
// game_completed) embed the same ClientGame snapshot that GET /api/games/:pin
// returns (both go through applyRuntimeState on the server), so the client
// applies them directly instead of refetching. Refetching here was the root
// cause of the host rendering Q1 after the players: the host's start-mutation
// onSuccess invalidation cancel-restarted the WS-triggered refetch, so the
// host's status flip always finished ~1 RTT behind. It also meant every
// connected player issued a GET on every transition.
export type GameCacheAction =
  | { kind: "set"; game: unknown }
  | { kind: "invalidate" }
  | { kind: "none" };

export interface CachedGameLike {
  status?: string;
  currentQuestion?: number | null;
}

export function resolveGameCacheAction(
  message: WsServerMessage,
  cachedGame: CachedGameLike | undefined,
): GameCacheAction {
  switch (message.type) {
    case "game_started":
    case "game_updated":
    case "next_question":
    case "game_completed":
      // `game` is z.any() in the protocol — guard against an empty payload
      // (older server build) by falling back to a refetch.
      return message.game ? { kind: "set", game: message.game } : { kind: "invalidate" };

    case "question_started": {
      // In the normal flow this message is preceded by a game-carrying
      // broadcast that already synced the cache — refetching again would
      // re-create the per-transition GET stampede. The exception is reconnect
      // catch-up (sendCurrentQuestionState sends question_started alone), so
      // refetch only when the cache doesn't already reflect this question.
      const inSync =
        !!cachedGame &&
        cachedGame.status === "active" &&
        (cachedGame.currentQuestion ?? 0) === message.questionIndex;
      return inSync ? { kind: "none" } : { kind: "invalidate" };
    }

    case "question_closed":
      // Closing awards points server-side; the snapshot in cache predates the
      // new scores, and this broadcast carries only the player list.
      return { kind: "invalidate" };

    default:
      return { kind: "none" };
  }
}
