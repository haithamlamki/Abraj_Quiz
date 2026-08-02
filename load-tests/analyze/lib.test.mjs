import test from "node:test";
import assert from "node:assert/strict";
import {
  percentile, broadcastDeltas, maxRollingCpuPct,
  memGrowthPct, nextBisectLevel, evalSlos,
} from "./lib.mjs";

test("percentile nearest-rank", () => {
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
  assert.equal(percentile([7], 99), 7);
  assert.ok(Number.isNaN(percentile([], 50)));
});

test("broadcastDeltas groups by evt+q and offsets from group min", () => {
  const deltas = broadcastDeltas([
    { evt: "question_closed", q: "0", epochMs: 1000 },
    { evt: "question_closed", q: "0", epochMs: 1300 },
    { evt: "question_closed", q: "1", epochMs: 9000 },
    { evt: "question_started", q: "0", epochMs: 500 },
    { evt: "question_started", q: "0", epochMs: 550 },
  ]);
  assert.deepEqual(deltas, [0, 0, 0, 50, 300]);
});

test("maxRollingCpuPct finds the busiest window", () => {
  const mk = (i, busyMs) => ({ t: i * 1000, cpuUserMs: busyMs, cpuSysMs: 0 });
  const samples = [
    ...Array.from({ length: 30 }, (_, i) => mk(i, 100)),   // 10%
    ...Array.from({ length: 30 }, (_, i) => mk(30 + i, 900)), // 90%
  ];
  const pct = maxRollingCpuPct(samples, 30);
  assert.ok(pct > 85 && pct <= 90, `got ${pct}`);
});

test("memGrowthPct compares second window vs last window, excludes warm-up", () => {
  const samples = [];
  for (let min = 0; min < 40; min++) {
    for (let s = 0; s < 60; s++) {
      const base = min < 10 ? 500 : 100; // warm-up spike then flat 100
      samples.push({ t: (min * 60 + s) * 1000, rss: base * 1e6 });
    }
  }
  assert.equal(memGrowthPct(samples, 10), 0);
  assert.equal(memGrowthPct(samples.slice(0, 120), 10), null); // too little data
});

test("nextBisectLevel", () => {
  assert.equal(nextBisectLevel(400, 800, 50), 600);
  assert.equal(nextBisectLevel(600, 650, 50), null);
  assert.equal(nextBisectLevel(600, 700, 50), 650);
});

test("evalSlos passes only when all hold", () => {
  const good = {
    joinFailRate: 0.001, joinP95: 900, ackP95: 200, broadcastP95: 400,
    disconnectRate: 0, cpuMaxRollingPct: 55, accepted: 1000, persisted: 1000,
    memGrowthPct: null,
  };
  assert.equal(evalSlos(good).pass, true);
  assert.equal(evalSlos({ ...good, ackP95: 600 }).pass, false);
  assert.equal(evalSlos({ ...good, persisted: 999 }).pass, false);
  assert.equal(evalSlos({ ...good, memGrowthPct: 25 }).pass, false);
  const failing = evalSlos({ ...good, joinFailRate: 0.02 }).checks.find((c) => c.name === "join_success");
  assert.equal(failing.pass, false);
});
