// Reconnect policy for the game WebSocket. Kept pure (no DOM, no socket) so it
// is unit-testable under node --test, and so the jitter math is auditable:
// 400 phones dropped by the same venue-AP hiccup must NOT reconnect in
// synchronized waves — full jitter draws uniformly in [0, ceiling].
export const BASE_RECONNECT_DELAY_MS = 1_000;
export const MAX_RECONNECT_DELAY_MS = 30_000;

export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * 2 ** Math.min(attempt, 30));
  return Math.floor(random() * ceiling);
}

// 1008 = policy violation (invalid room, invalid host session, or invalid
// player membership) — retrying cannot succeed, surface failure instead.
export function shouldReconnect(closeCode: number): boolean {
  return closeCode !== 1008;
}
