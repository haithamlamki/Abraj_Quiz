// S6: step ramp until an SLO breaks, bisect to the edge, verify 3x (worst-of-3).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { runOnce } from "./run.mjs";
import { nextBisectLevel } from "./analyze/lib.mjs";

const LEVELS = (process.env.LEVELS || "100,200,400,600,800,1000,1500,2000").split(",").map(Number);
const RESOLUTION = Number(process.env.RESOLUTION || 50);
const VERIFY_RUNS = Number(process.env.VERIFY_RUNS || 3);
const results = [];
const record = (n, summary) => results.push({ n, pass: summary.slo.pass, runDir: summary.runDir });

let lastPass = 0;
let firstFail = null;
for (const n of LEVELS) {
  console.log(`\n===== RAMP LEVEL N=${n} =====`);
  const s = await runOnce({ n, runId: `ramp-n${n}` });
  record(n, s);
  if (s.slo.pass) lastPass = n;
  else { firstFail = n; break; }
}

if (firstFail !== null) {
  let next;
  while ((next = nextBisectLevel(lastPass, firstFail, RESOLUTION)) !== null) {
    console.log(`\n===== BISECT N=${next} (pass ${lastPass} / fail ${firstFail}) =====`);
    const s = await runOnce({ n: next, runId: `bisect-n${next}` });
    record(next, s);
    if (s.slo.pass) lastPass = next; else firstFail = next;
  }
}
let edge = lastPass;

// Worst-of-3 verification: the edge is only "verified" if ALL repeats pass.
let verified = null;
const verifyRuns = [];
while (edge > 0 && verified === null) {
  let allPass = true;
  for (let i = 1; i <= VERIFY_RUNS; i++) {
    console.log(`\n===== VERIFY ${i}/${VERIFY_RUNS} at N=${edge} =====`);
    const s = await runOnce({ n: edge, runId: `verify-n${edge}-r${i}` });
    verifyRuns.push({ n: edge, attempt: i, pass: s.slo.pass, runDir: s.runDir });
    if (!s.slo.pass) { allPass = false; break; }
  }
  if (allPass) verified = edge;
  else { console.log(`[ramp] verification failed at ${edge}; dropping by ${RESOLUTION}`); edge -= RESOLUTION; }
}

const out = { levels: results, edge, verified, verifyRuns };
writeFileSync(path.join(import.meta.dirname, "results", "ramp-summary.json"), JSON.stringify(out, null, 2));
console.log(`\n[ramp] VERIFIED STABLE CONCURRENCY: ${verified}`);
