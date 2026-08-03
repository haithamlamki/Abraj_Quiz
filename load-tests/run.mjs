// Orchestrates ONE load-test run at level N against the local test deployment.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnv, assertLocal } from "./setup/env.mjs";

const here = import.meta.dirname;

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
}

export async function runOnce({ n, scenario = "quiz", runId, soak = false }) {
  loadEnv();
  assertLocal(process.env.DATABASE_URL, "DATABASE_URL");
  assertLocal(process.env.ADMIN_DATABASE_URL, "ADMIN_DATABASE_URL");
  const cfg = JSON.parse(readFileSync(path.join(here, "results", "run-config.json"), "utf8"));

  const health = await fetch(`${cfg.baseUrl}/api/healthz`).then((r) => r.json()).catch(() => null);
  if (!health || health.status !== "ok") throw new Error(`server not healthy at ${cfg.baseUrl} — start it with load-tests/start-server.ps1`);
  if (!existsSync(path.join(here, "results", "agent.ndjson"))) {
    console.warn("[run] WARNING: agent.ndjson missing — server started without the monitor agent; CPU/mem SLOs will fail");
  }

  const id = runId || `${scenario}-n${n}-${Date.now()}`;
  const outDir = path.join(here, "results", id);
  mkdirSync(outDir, { recursive: true });
  // If this run-id directory is being reused, a stale pin.json from a prior
  // run would make the wait-loop below return instantly, pinning k6 to the
  // OLD (already-completed) game instead of the fresh conductor's game.
  rmSync(path.join(outDir, "pin.json"), { force: true });
  console.log(`[run] ${id} (N=${n}, scenario=${scenario})`);

  const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL, max: 2 });
  await admin.query("select pg_stat_statements_reset()").catch(() => {});

  // 1. Conductor creates the game and waits for players (skip start in join-only mode).
  const conductor = spawn(process.execPath, [path.join(here, "conductor", "host.mjs")], {
    env: {
      ...process.env,
      OUT_DIR: outDir,
      TARGET_PLAYERS: scenario === "join" ? String(2 ** 31) : String(n), // join mode: never start
      // join mode's k6 run (RAMP 60s + HOLD 2m = 180s, plus graceful ramp-down/stop)
      // outlasts a 120s deadline, so the conductor's own timeout would fire and
      // start the game before run.mjs kills it below. Give it enough headroom
      // that only the post-k6 conductor.kill() ends the wait.
      GO_TIMEOUT_MS: scenario === "join" ? "600000" : "180000",
    },
    stdio: "inherit",
  });
  // Spawn-time failure (e.g. node itself missing, EACCES) only ever fires 'error',
  // never 'exit' — track it so the pin.json wait below doesn't spin forever.
  let conductorSpawnError = null;
  conductor.on("error", (err) => {
    conductorSpawnError = err;
    console.error(`[run] conductor failed to start: ${err.message}`);
  });

  const pinFile = path.join(outDir, "pin.json");
  const pinDeadline = Date.now() + 60_000;
  while (!existsSync(pinFile)) {
    if (conductorSpawnError) {
      await admin.end().catch(() => {});
      throw new Error(`conductor failed to start: ${conductorSpawnError.message}`);
    }
    if (conductor.exitCode !== null) {
      await admin.end().catch(() => {});
      throw new Error(`conductor exited (code ${conductor.exitCode}) before writing pin.json — it may have died before creating the game; check ${outDir} for its output`);
    }
    if (Date.now() > pinDeadline) {
      conductor.kill();
      await admin.end().catch(() => {});
      throw new Error(`conductor did not write pin.json within 60s — it may have died before creating the game; check ${outDir} for its output`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const { gamePin, gameId } = JSON.parse(readFileSync(pinFile, "utf8"));

  // 2. Poller.
  const poll = spawn(process.execPath, [path.join(here, "monitor", "poll.mjs"), outDir], { stdio: "ignore" });
  let pollSpawnError = null;
  poll.on("error", (err) => {
    pollSpawnError = err;
    console.error(`[run] poller failed to start: ${err.message}`);
  });

  // 3. k6 player swarm.
  // k6 is not always on PATH — allow an explicit binary path via K6_BIN
  // (set in load-tests/.env.loadtest for machines where it isn't installed globally).
  const k6Bin = process.env.K6_BIN || "k6";
  const holdMin = scenario === "join" ? "2m" : "6m";
  const k6 = spawn(k6Bin, [
    "run", "--quiet", "--out", `json=${outDir}/raw.json.gz`, path.join(here, "k6", "players.js"),
  ], {
    env: {
      ...process.env,
      BASE_URL: cfg.baseUrl, ORIGIN: cfg.origin, WS_URL: cfg.wsUrl,
      PIN: gamePin, RUN_ID: id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20), N: String(n),
      RAMP: "60s", HOLD: holdMin, OUT_DIR: outDir.replace(/\\/g, "/"),
      SCENARIO: scenario === "reconnect" ? "quiz" : scenario,
      RECONNECT_PCT: scenario === "reconnect" ? "20" : "0",
    },
    stdio: "inherit",
  });

  // A bad K6_BIN (or missing k6 install) only emits 'error'+'close', never 'exit' —
  // without this, the exit-wait below hangs forever and leaks the conductor/poller.
  const k6Exit = await new Promise((resolve) => {
    let settled = false;
    k6.on("error", (err) => {
      if (settled) return;
      settled = true;
      console.error(`[run] k6 failed to start: ${err.message} (K6_BIN=${k6Bin}) — is k6 installed and K6_BIN set correctly?`);
      resolve(-1);
    });
    k6.on("exit", (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    });
  });
  if (k6Exit === -1) {
    conductor.kill();
    poll.kill();
    await admin.end().catch(() => {});
    throw new Error(`k6 failed to launch (K6_BIN=${k6Bin}); aborting run ${id}`);
  }

  const condExit = await new Promise((r) => {
    if (conductor.exitCode !== null) return r(conductor.exitCode);
    conductor.on("exit", r);
    if (scenario === "join") conductor.kill(); // never starts; end it
  });
  poll.kill();
  console.log(`[run] k6 exit=${k6Exit} conductor exit=${condExit}`);
  if (pollSpawnError) {
    await admin.end().catch(() => {});
    throw new Error(`poller failed to start: ${pollSpawnError.message}`);
  }

  // 4. DB verification (zero data loss) + statement stats.
  await admin.query("select set_config('app.role', 'system', false)");
  const responses = await admin.query(
    "select count(*)::int as c from game_responses where game_id = $1", [gameId]);
  const players = await admin.query(
    "select count(*)::int as c from game_players where game_id = $1", [gameId]);
  const byQuestion = await admin.query(
    "select question_index, count(*)::int as c from game_responses where game_id = $1 group by 1 order by 1", [gameId]);
  const k6Summary = JSON.parse(readFileSync(path.join(outDir, "k6-summary.json"), "utf8"));
  const accepted = k6Summary.metrics.answers_accepted?.values?.count ?? 0;
  writeFileSync(path.join(outDir, "db-verify.json"), JSON.stringify({
    accepted, persisted: responses.rows[0].c, players: players.rows[0].c, byQuestion: byQuestion.rows,
  }, null, 2));
  const stmts = await admin.query(`
    select left(query, 120) as query, calls, round(total_exec_time)::int as total_ms,
           round(mean_exec_time, 2) as mean_ms, rows
    from pg_stat_statements order by total_exec_time desc limit 20`).catch(() => ({ rows: [] }));
  writeFileSync(path.join(outDir, "db-stats.json"), JSON.stringify(stmts.rows, null, 2));
  await admin.end();

  // 5. Analyze -> SLO verdict.
  const analyze = spawn(process.execPath, [path.join(here, "analyze", "analyze.mjs"), outDir], {
    env: { ...process.env, N: String(n), SCENARIO: scenario, SOAK: soak ? "1" : "0" },
    stdio: "inherit",
  });
  await new Promise((r) => analyze.on("exit", r));
  return JSON.parse(readFileSync(path.join(outDir, "run-summary.json"), "utf8"));
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const summary = await runOnce({
    n: Number(arg("n", "50")),
    scenario: arg("scenario", "quiz"),
    runId: arg("run-id", undefined),
    soak: process.argv.includes("--soak"),
  });
  process.exit(summary.slo.pass ? 0 : 1);
}
