// S5: repeat full quiz cycles at 60% of the verified max for SOAK_MINUTES,
// then check for monotonic memory growth across the whole window.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runOnce } from "./run.mjs";
import { memGrowthPct } from "./analyze/lib.mjs";

const N = Number(process.env.SOAK_N);
if (!N) throw new Error("Set SOAK_N (60% of the verified max, rounded)");
const MINUTES = Number(process.env.SOAK_MINUTES || 60);
const deadline = Date.now() + MINUTES * 60_000;
const startT = Date.now();
const cycles = [];
let cycle = 0;

while (Date.now() < deadline) {
  cycle += 1;
  console.log(`\n===== SOAK CYCLE ${cycle} (N=${N}) =====`);
  const s = await runOnce({ n: N, runId: `soak-c${cycle}`, soak: true });
  cycles.push({ cycle, pass: s.slo.pass, runDir: s.runDir });
}

const agent = readFileSync(path.join(import.meta.dirname, "results", "agent.ndjson"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l))
  .filter((s) => s.t >= startT);
const growth = memGrowthPct(agent, 10);
const perCyclePass = cycles.every((c) => c.pass);
const out = { n: N, minutes: MINUTES, cycles, memGrowthPct: growth, pass: perCyclePass && growth !== null && growth < 10 };
writeFileSync(path.join(import.meta.dirname, "results", "soak-summary.json"), JSON.stringify(out, null, 2));
console.log(`\n[soak] cycles=${cycles.length} allPass=${perCyclePass} memGrowth=${growth?.toFixed(1)}% -> ${out.pass ? "PASS" : "FAIL"}`);
process.exit(out.pass ? 0 : 1);
