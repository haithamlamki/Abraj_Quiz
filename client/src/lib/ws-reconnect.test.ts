import test from "node:test";
import assert from "node:assert/strict";

const { reconnectDelayMs, shouldReconnect, BASE_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } =
  await import("./ws-reconnect");

test("reconnectDelayMs ceiling grows exponentially and caps at 30s", () => {
  // random() => 1 pins the draw to the ceiling so we can assert the curve.
  const atCeiling = (attempt: number) => reconnectDelayMs(attempt, () => 1);
  assert.equal(atCeiling(0), 1_000);
  assert.equal(atCeiling(1), 2_000);
  assert.equal(atCeiling(3), 8_000);
  assert.equal(atCeiling(5), 30_000); // 32s uncapped -> capped
  assert.equal(atCeiling(20), 30_000); // stays capped, no overflow
  assert.equal(MAX_RECONNECT_DELAY_MS, 30_000);
  assert.equal(BASE_RECONNECT_DELAY_MS, 1_000);
});

test("reconnectDelayMs applies FULL jitter (uniform down to zero)", () => {
  // 400 phones dropped by one AP hiccup must not reconnect in waves.
  assert.equal(reconnectDelayMs(3, () => 0), 0);
  assert.equal(reconnectDelayMs(3, () => 0.5), 4_000);
});

test("reconnectDelayMs defaults to Math.random and stays within [0, ceiling]", () => {
  for (let i = 0; i < 50; i++) {
    const d = reconnectDelayMs(2);
    assert.ok(d >= 0 && d <= 4_000, `delay ${d} outside [0, 4000]`);
  }
});

test("shouldReconnect: false ONLY for 1008 policy violation", () => {
  assert.equal(shouldReconnect(1008), false);
  for (const code of [1000, 1001, 1006, 1011, 1012, 4000]) {
    assert.equal(shouldReconnect(code), true, `code ${code} should reconnect`);
  }
});
