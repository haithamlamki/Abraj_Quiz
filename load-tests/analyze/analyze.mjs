// Merges one run's artifacts into run-summary.json and evaluates the SLOs.
// Usage: node load-tests/analyze/analyze.mjs <runDir>
import { createReadStream, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import readline from "node:readline";
import path from "node:path";
import { percentile, broadcastDeltas, maxRollingCpuPct, memGrowthPct, evalSlos } from "./lib.mjs";

const runDir = process.argv[2];
if (!runDir) throw new Error("usage: analyze.mjs <runDir>");
const read = (f) => JSON.parse(readFileSync(path.join(runDir, f), "utf8"));
const ndjson = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const summary = read("k6-summary.json");
const hostEvents = ndjson(path.join(runDir, "host-events.ndjson"));
const dbVerify = existsSync(path.join(runDir, "db-verify.json")) ? read("db-verify.json") : { persisted: null };

const counter = (name) => summary.metrics[name]?.values?.count ?? 0;
const rate = (name) => summary.metrics[name]?.values?.rate ?? 0;
const trendP95 = (name) => summary.metrics[name]?.values?.["p(95)"] ?? NaN;

// Broadcast deltas from the raw k6 json stream (Point lines of broadcast_recv_epoch).
const points = [];
await new Promise((resolve, reject) => {
  const rl = readline.createInterface({
    input: createReadStream(path.join(runDir, "raw.json.gz")).pipe(createGunzip()),
  });
  rl.on("line", (line) => {
    if (!line.includes('"broadcast_recv_epoch"') || !line.includes('"type":"Point"')) return;
    const o = JSON.parse(line);
    points.push({ evt: o.data.tags.evt, q: o.data.tags.q, epochMs: o.data.value });
  });
  rl.on("close", resolve);
  rl.on("error", reject);
});
const deltas = broadcastDeltas(points);

// Agent samples clipped to the run window (created -> completed/last event).
const startT = hostEvents[0]?.t ?? 0;
const endT = hostEvents[hostEvents.length - 1]?.t ?? Date.now();
const agentFile = path.join(runDir, "..", "agent.ndjson");
const agent = existsSync(agentFile) ? ndjson(agentFile).filter((s) => s.t >= startT && s.t <= endT) : [];

const metrics = {
  n: Number(process.env.N || summary.metrics.vus_max?.values?.max || 0),
  scenario: process.env.SCENARIO || "quiz",
  joinFailRate: rate("join_fail"),
  joinP95: trendP95("join_latency"),
  ackP95: trendP95("answer_ack_latency"),
  broadcastP95: percentile(deltas, 95),
  broadcastP99: percentile(deltas, 99),
  broadcastMax: deltas[deltas.length - 1] ?? NaN,
  disconnectRate: rate("ws_disconnect"),
  wsJoined: counter("ws_joined"),
  accepted: counter("answers_accepted"),
  rejected: counter("answers_rejected"),
  inducedDrops: counter("induced_drops"),
  reconnectP95: trendP95("reconnect_time"),
  persisted: dbVerify.persisted,
  cpuMaxRollingPct: maxRollingCpuPct(agent),
  elDelayP99MaxMs: Math.max(0, ...agent.map((s) => s.elDelayP99Ms)),
  gcMaxMs: Math.max(0, ...agent.map((s) => s.gcMaxMs)),
  memGrowthPct: process.env.SOAK === "1" ? memGrowthPct(agent) : null,
};

const slo = evalSlos(metrics);
const out = { runDir, scenario: process.env.SCENARIO || "quiz", metrics, slo, startT, endT };
writeFileSync(path.join(runDir, "run-summary.json"), JSON.stringify(out, null, 2));

for (const c of slo.checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(22)} ${String(c.value).slice(0, 12).padEnd(14)} (${c.limit})`);
}
console.log(slo.pass ? "\n=> STABLE at this level" : "\n=> NOT stable at this level");
process.exit(slo.pass ? 0 : 1);
