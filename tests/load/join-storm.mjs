// Load-test harness for the 400-player concentrated join rush.
//
// Reproduces the scenario from the scaling plan: N players hit POST
// /api/games/:pin/join at once at the start of a quiz. Reports join success
// rate, throughput, and p50/p95 latency, and verifies roster integrity.
//
// PREREQ: a dev server must be running against the target DB, and DATABASE_URL
// must be set here so the harness can clean up its it_-prefixed rows afterward.
//
//   # terminal 1 (co-located with / pointed at the target DB):
//   npm run dev
//   # terminal 2:
//   node tests/load/join-storm.mjs                 # defaults: N=400
//   N=400 BASE_URL=http://localhost:5000 node tests/load/join-storm.mjs
//
// Run it BEFORE the change (on main) and AFTER (on this branch) for the
// before/after numbers. ALWAYS let it finish so cleanup runs; it deletes only
// rows whose username/name starts with the run's it_ prefix.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
// Tenant resolution keys off the Origin hostname; when targeting the prod API
// host directly, pass the tenant's client origin (e.g. https://www.abrajquiz.com).
const ORIGIN = process.env.ORIGIN ?? BASE_URL;
const N = Number(process.env.N ?? 400);
const PREFIX = `it_load_${randomUUID().slice(0, 8)}`;

function pct(sortedMs, p) {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx];
}

async function j(path, init = {}) {
  const headers = { "content-type": "application/json", origin: ORIGIN, ...(init.headers ?? {}) };
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  return res;
}

async function registerHost() {
  const username = `${PREFIX}_host`;
  const res = await j("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "TestPass123!" }),
  });
  if (res.status !== 201) throw new Error(`register host failed: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  return cookie;
}

async function createQuiz(cookie) {
  const res = await j("/api/quizzes", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({
      title: `${PREFIX}_quiz`,
      description: "load test",
      isPublic: true,
      background: "classroom",
      createdBy: 0,
      questions: [
        { question: "Q1?", answers: ["a", "b", "c", "d"], correctAnswer: 0, timeLimit: 10 },
      ],
    }),
  });
  if (res.status !== 201) throw new Error(`create quiz failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function createGame(cookie, quizId) {
  const res = await j("/api/games", { method: "POST", headers: { cookie }, body: JSON.stringify({ quizId }) });
  if (res.status !== 201) throw new Error(`create game failed: ${res.status} ${await res.text()}`);
  return (await res.json()).gamePin;
}

async function cleanup() {
  if (!process.env.DATABASE_URL) {
    console.warn("\n[cleanup] DATABASE_URL not set — skipping. Remove it_ rows manually.");
    return;
  }
  const useSsl = /supabase\.(co|com)|pooler\.supabase\.com/.test(process.env.DATABASE_URL) ||
    process.env.NODE_ENV === "production";
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: useSsl ? { rejectUnauthorized: false } : undefined, max: 4 });
  const like = PREFIX.replace(/([\\%_])/g, "\\$1") + "%";
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.role', 'system', true)");
    const gameIds = `SELECT g.id FROM games g JOIN users u ON u.id = g.host_id WHERE u.username LIKE $1 ESCAPE '\\'`;
    await client.query(`DELETE FROM game_players WHERE game_id IN (${gameIds})`, [like]);
    await client.query(`DELETE FROM game_responses WHERE game_id IN (${gameIds})`, [like]);
    await client.query(`DELETE FROM games WHERE host_id IN (SELECT id FROM users WHERE username LIKE $1 ESCAPE '\\')`, [like]);
    await client.query(`DELETE FROM quizzes WHERE created_by IN (SELECT id FROM users WHERE username LIKE $1 ESCAPE '\\')`, [like]);
    await client.query(`DELETE FROM users WHERE username LIKE $1 ESCAPE '\\'`, [like]);
    await client.query("commit");
    console.log(`[cleanup] removed rows for prefix ${PREFIX}`);
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  console.log(`Join-storm load test → ${BASE_URL}  N=${N}  prefix=${PREFIX}`);
  const cookie = await registerHost();
  const quizId = await createQuiz(cookie);
  const pin = await createGame(cookie, quizId);
  console.log(`Host + quiz + game ready (pin ${pin}). Firing ${N} concurrent joins...`);

  const names = Array.from({ length: N }, (_, i) => `${PREFIX}_p${i}`);
  const byStatus = new Map();
  const latencies = [];
  const successLatencies = [];

  const t0 = performance.now();
  const results = await Promise.all(
    names.map(async (playerName) => {
      const start = performance.now();
      try {
        const res = await j(`/api/games/${pin}/join`, { method: "POST", body: JSON.stringify({ playerName }) });
        const ms = performance.now() - start;
        latencies.push(ms);
        if (res.status === 200) successLatencies.push(ms);
        byStatus.set(res.status, (byStatus.get(res.status) ?? 0) + 1);
        return res.status;
      } catch (err) {
        latencies.push(performance.now() - start);
        byStatus.set("ERR", (byStatus.get("ERR") ?? 0) + 1);
        return "ERR";
      }
    }),
  );
  const wallSec = (performance.now() - t0) / 1000;

  const ok = results.filter((s) => s === 200).length;
  latencies.sort((a, b) => a - b);
  successLatencies.sort((a, b) => a - b);

  // Roster integrity: the snapshot must show exactly the accepted players.
  const snap = await j(`/api/games/${pin}`);
  const game = await snap.json();
  const roster = Array.isArray(game.players) ? game.players.map((p) => p.name) : [];

  console.log("\n=== RESULTS ===");
  console.log(`join success:   ${ok}/${N}  (${((ok / N) * 100).toFixed(1)}%)`);
  console.log(`status codes:   ${JSON.stringify(Object.fromEntries(byStatus))}`);
  console.log(`throughput:     ${(ok / wallSec).toFixed(1)} joins/s   (wallclock ${wallSec.toFixed(2)}s)`);
  console.log(`latency p50:    ${pct(latencies, 50).toFixed(0)} ms  (all attempts)`);
  console.log(`latency p95:    ${pct(latencies, 95).toFixed(0)} ms  (all attempts)`);
  console.log(`latency p50/p95 (success only): ${pct(successLatencies, 50).toFixed(0)} / ${pct(successLatencies, 95).toFixed(0)} ms`);
  console.log(`roster integrity: ${roster.length}/${ok} accepted players present in snapshot ${roster.length === ok ? "✓" : "✗ MISMATCH"}`);
}

main()
  .catch((err) => {
    console.error("\nLoad test failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup error:", e));
  });
