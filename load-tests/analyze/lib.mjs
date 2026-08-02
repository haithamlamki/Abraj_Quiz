// Pure computation for load-test analysis. No I/O — unit-tested.

export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function broadcastDeltas(points) {
  const groups = new Map();
  for (const pt of points) {
    const key = `${pt.evt} ${pt.q}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pt.epochMs);
  }
  const deltas = [];
  for (const arr of groups.values()) {
    let min = Infinity;
    for (const v of arr) if (v < min) min = v;
    for (const v of arr) deltas.push(v - min);
  }
  return deltas.sort((a, b) => a - b);
}

export function maxRollingCpuPct(samples, windowSec = 30) {
  if (samples.length === 0) return 0;
  const busy = samples.map((s) => (s.cpuUserMs + s.cpuSysMs) / 10); // % of one core per 1s sample
  let best = 0;
  for (let i = 0; i + windowSec <= busy.length; i++) {
    let sum = 0;
    for (let j = i; j < i + windowSec; j++) sum += busy[j];
    best = Math.max(best, sum / windowSec);
  }
  return best || busy.reduce((a, b) => a + b, 0) / busy.length;
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

export function memGrowthPct(samples, windowMinutes = 10) {
  if (samples.length === 0) return null;
  const winMs = windowMinutes * 60_000;
  const t0 = samples[0].t;
  const windows = new Map();
  for (const s of samples) {
    const w = Math.floor((s.t - t0) / winMs);
    if (!windows.has(w)) windows.set(w, []);
    windows.get(w).push(s.rss);
  }
  const keys = [...windows.keys()].sort((a, b) => a - b);
  if (keys.length < 3) return null; // need warm-up + baseline + comparison
  const baseline = median(windows.get(keys[1]));
  const last = median(windows.get(keys[keys.length - 1]));
  return ((last - baseline) / baseline) * 100;
}

export function nextBisectLevel(lastPass, firstFail, resolution = 50) {
  if (firstFail - lastPass <= resolution) return null;
  const mid = Math.floor((lastPass + firstFail) / 2 / resolution) * resolution;
  return mid > lastPass ? mid : null;
}

export function evalSlos(m) {
  // Join-only mode never plays a quiz, so answer-ack and broadcast latency
  // are structurally meaningless (no questions are ever started/answered) —
  // omit those two checks rather than let them NaN-fail every join run.
  const isJoinOnly = m.scenario === "join";
  const checks = [
    { name: "join_success", value: 1 - m.joinFailRate, limit: ">=0.99", pass: m.joinFailRate <= 0.01 },
    { name: "join_p95_ms", value: m.joinP95, limit: "<2000", pass: m.joinP95 < 2000 },
    ...(isJoinOnly ? [] : [
      { name: "answer_ack_p95_ms", value: m.ackP95, limit: "<500", pass: m.ackP95 < 500 },
      { name: "broadcast_p95_ms", value: m.broadcastP95, limit: "<1000", pass: m.broadcastP95 < 1000 },
    ]),
    { name: "ws_disconnect_rate", value: m.disconnectRate, limit: "<0.01", pass: m.disconnectRate < 0.01 },
    { name: "cpu_sustained_pct", value: m.cpuMaxRollingPct, limit: "<80", pass: m.cpuMaxRollingPct < 80 },
    {
      name: "zero_data_loss",
      value: `${m.persisted}/${m.accepted}`,
      limit: "persisted==accepted",
      pass: Number.isInteger(m.persisted) && m.persisted === m.accepted,
    },
  ];
  if (m.memGrowthPct !== null && m.memGrowthPct !== undefined) {
    checks.push({ name: "mem_growth_pct", value: m.memGrowthPct, limit: "<10", pass: m.memGrowthPct < 10 });
  }
  return { pass: checks.every((c) => c.pass), checks };
}
