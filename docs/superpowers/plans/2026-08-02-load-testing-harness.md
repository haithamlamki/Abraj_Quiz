# Load-Testing Harness + Capacity Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a load-testing harness that finds the maximum stable number of concurrent participants in a single live quiz session against a dedicated local production-build deployment, and produce a defensible client-facing capacity report.

**Architecture:** k6 generates the player swarm (REST join + raw-WS session + REST answers — the real protocol, discovered below). A Node "conductor" script plays the host (login → create game → start → advance questions) because host control needs precise orchestration and k6 cannot do SQL. A Node preload agent (`NODE_OPTIONS --import`, zero app-code changes) samples event-loop lag, GC pauses, and memory inside the production server process; a poller samples Postgres and TCP state. A pure-function analysis library (unit-tested) computes SLO pass/fail per run; orchestrator scripts run single levels, the S6 breaking-point ramp with bisection, and the S5 soak loop.

**Tech Stack:** k6 (raw WebSocket + HTTP), Node 22 ESM scripts (`ws`, `pg` — already project deps), Docker Postgres 16 with `pg_stat_statements`, `node:test` for the analysis library, PowerShell launcher for the server.

## Global Constraints

- All code and comments in English.
- NEVER run against production or with real participant data. Every script that takes a `DATABASE_URL` must refuse hostnames other than `localhost`/`127.0.0.1`. `BASE_URL` targets the dedicated deployment only.
- Server under test = **production build** (`npm run build` then `NODE_ENV=production node dist/index.js`), NOT `npm run dev`.
- Load generator runs in a **separate process** from the server (separate machine optional; README documents both and the caveat).
- SLOs (a level is "stable" only if ALL hold): join success ≥ 99%; join latency p95 < 2 s; answer-ack p95 < 500 ms; broadcast delivery p95 < 1 s; WS error/disconnect rate < 1% (excluding S4's induced drops); server CPU < 80% sustained (30 s rolling window); no monotonic memory growth in S5; zero data loss (answers accepted == rows in `game_responses`).
- Max-level run repeated 3×; report the WORST of the three; round DOWN to a conservative marketing number.
- No changes to app code (`server/`, `client/`, `shared/`) — the harness lives entirely in `load-tests/` (+ this plan and the final report). Monitoring attaches via `NODE_OPTIONS`, not code edits.
- Environment deviations from production defaults (`RATE_LIMIT_JOIN_MAX=0`, raised `MAX_PLAYERS_PER_GAME`, localhost network, no Sentry DSN) must be listed in the report.
- Reference FR numbers from `PRODUCTION_MIGRATION_PRD.md` where relevant (single-instance backend rule = PRD §12).
- Git: one branch `feat/load-testing-harness` in its own worktree (`superpowers:using-git-worktrees`); run `git branch --show-current` before every commit.

---

## Phase 0 findings — the real protocol (already discovered; Task 1 records this in `load-tests/PROTOCOL.md`)

**Implementation:** raw `ws` (npm `ws` v8), NOT socket.io → per the spec's tool rule, **k6** is the generator. WS server at path **`/game-ws`** on the same HTTP server as Express (port `PORT`, default 5000). Zod protocol in `shared/ws-protocol.ts`. Inbound frames capped at **2048 bytes**, **30 messages/min per socket** rate limit. Server pings every 30 s; sockets idle > 90 s are terminated (`server/websocket.ts:352-362` — the `ws`/gorilla auto-pong keeps real clients alive). `maxClientsPerGame = 250` at `server/websocket.ts:55` is a **dead field** (declared, never enforced).

**Participant lifecycle (player):**
1. `POST /api/games/:pin/join` body `{"playerName": "..."}` — headers must include `Origin` (tenant resolution keys off Origin hostname, `server/tenant.ts:32`) and `Content-Type: application/json`. 200 `{success, game, playerCount}`; 400 duplicate/not-waiting; 409 `GAME_FULL` (cap = `MAX_PLAYERS_PER_GAME`, default 500, `server/storage.ts:22`); 503 `GAME_BUSY` (retryable); 429 from `joinLimiter` (600/min/IP, `RATE_LIMIT_JOIN_MAX`, 0 disables). Side effect: broadcasts `game_updated` (with FULL player array — O(N²) across a join storm) to all connected room sockets.
2. Open WS to `ws://host:port/game-ws` with matching `Origin` header (enforced in production against `CLIENT_ORIGIN`).
3. Send `{"type":"join","gamePin":"123456","playerName":"..."}` (player must already exist in roster or the socket is closed 1008 `PLAYER_NOT_REGISTERED`). Receive `{"type":"joined","gamePin","isHost":false}` plus current question state if mid-game (reconnect support).
4. Server pushes per question: `question_started {questionIndex, durationSeconds, startedAt, closesAt, timeRemaining}` → `time_remaining` every 1 s (per-room broadcast to ALL sockets — a second fan-out hot spot) → `question_closed {questionIndex, correctAnswer, correctAnswers, distribution, players}` (players = full sorted leaderboard) → `next_question {game}` → … → `game_completed {game}`.
5. Answer submission is **REST, not WS**: `POST /api/games/:pin/answer` body `{"playerName","questionIndex","selectedAnswer","responseTime"}` (`selectedAnswer` 0–63: index for single-select, bitmask for multi; `responseTime` int ≥ 0, server recomputes its own). 200 `{success:true, streak}`; 409 `QUESTION_CLOSED` / `DUPLICATE_ANSWER`; 403 `PLAYER_NOT_REGISTERED`.
6. Reconnect: client reopens WS and resends `join` (same name re-binds the socket; old socket is closed by the server with "Replaced by a newer player connection"). Client backoff in `client/src/lib/ws-reconnect.ts`.

**Host lifecycle (conductor):** `POST /api/register` (201, returns cookie) → `POST /api/login` (200, returns **`token`** — `requireAuth` prefers `Authorization: Bearer <token>`, `server/routes.ts:113`) → `POST /api/games {quizId}` → 201 `{gamePin, id}` → WS connect with `?token=<token>` and send `{"type":"join","gamePin","isHost":true}` → `POST /api/games/:pin/start` (opens Q0; timer auto-closes each timed question at `timeLimit`) → on each `question_closed`, `POST /api/games/:pin/next-question` → repeats → last call returns `{gameComplete:true}` and `game_completed` is broadcast.

**Persistence (zero-data-loss checkpoints):** answers accumulate in-memory; ONE bulk insert into `game_responses` at `closeQuestion()` (`server/game-room-manager.ts:517`); final scores bulk-written to `game_players` at completion. So DB truth = `game_responses` row count per game.

**Latency measurement design:** join and answer-ack latencies come from k6 HTTP timings (no clock issues). Broadcast delivery cannot use a server timestamp for `question_closed` (the message carries none), so per-event delivery = each client's local receive time minus the **minimum receive time across all clients for that same event** — skew-free because all measuring clients share the generator's clock. Requires a single generator machine (README documents this constraint). `question_started.startedAt` gives a server-clock cross-check.

---

## File structure

```
load-tests/
  PROTOCOL.md               # Phase 0 findings (content above)
  README.md                 # env spec, install, exact run commands, generator limits, deviations
  .gitignore                # results/
  docker-compose.yml        # postgres:16 + pg_stat_statements, port 55432
  .env.loadtest.example     # template; real .env.loadtest is gitignored
  start-server.ps1          # loads .env.loadtest, starts production build w/ monitor agent
  setup/
    rls.sql                 # tenant RLS + quiz_app role + session table (prod parity)
    setup-db.mjs            # drizzle push + rls.sql + loadtest tenant seed
    seed.mjs                # host user + 10-question quiz via API → results/run-config.json
  monitor/
    agent.mjs               # NODE_OPTIONS --import preload: event-loop lag, GC, mem, CPU → ndjson
    poll.mjs                # pg_stat_activity + TCP conn count → csv
  conductor/
    host.mjs                # host lifecycle for one game → host-events.ndjson, pin file
  k6/
    players.js              # S1/S2/S3/S4 player behavior, scenario via env
  analyze/
    lib.mjs                 # pure functions: percentile, broadcast deltas, CPU window, mem trend, SLO eval, bisect
    lib.test.mjs            # node:test unit tests (TDD)
    analyze.mjs             # merges k6 + host + agent + poll + DB verify → run-summary.json
  run.mjs                   # one run at level N (spawns conductor, poll, k6; verifies; analyzes)
  ramp.mjs                  # S6 step ramp + bisect + 3x verification at the edge
  soak.mjs                  # S5: repeat quiz cycles for 60 min, memory-trend check
  results/                  # gitignored raw outputs; report.md is checked in explicitly
    report.md               # final deliverable (added in Task 12 with -f)
```

Root repo changes: none outside `load-tests/` and `docs/superpowers/plans/`.

---

### Task 1: Scaffolding + protocol documentation

**Files:**
- Create: `load-tests/PROTOCOL.md`
- Create: `load-tests/.gitignore`
- Create: `load-tests/README.md` (stub — finalized in Task 12)

**Interfaces:**
- Produces: `load-tests/` directory layout all later tasks write into; PROTOCOL.md is the contract the k6 script and conductor implement.

- [ ] **Step 1: Create worktree + branch** (skip if already in one)

```powershell
git worktree add "../Abraj_Quiz-loadtest" -b feat/load-testing-harness
cd "../Abraj_Quiz-loadtest"
npm ci
```

- [ ] **Step 2: Write `load-tests/.gitignore`**

```gitignore
results/
.env.loadtest
```

- [ ] **Step 3: Write `load-tests/PROTOCOL.md`** — copy the entire "Phase 0 findings" section of this plan verbatim (from "**Implementation:** raw `ws`…" through the latency-measurement paragraph), preceded by:

```markdown
# Live Quiz Platform — wire protocol for load testing

Discovered from source 2026-08-02 (server/websocket.ts, server/game-room-manager.ts,
server/routes.ts, shared/ws-protocol.ts, client/src/hooks/use-game-websocket.ts).
Tool decision: raw `ws` → k6 (Artillery's socket.io engine does not apply).
```

- [ ] **Step 4: Write `load-tests/README.md` stub**

```markdown
# Load tests

Finds the maximum stable concurrent participants in one live quiz session.
See PROTOCOL.md for the wire protocol. Finalized run instructions land with the report.

Status: harness under construction — do not quote numbers from partial runs.
```

- [ ] **Step 5: Commit**

```powershell
git branch --show-current   # MUST print feat/load-testing-harness
git add load-tests
git commit -m "loadtest: scaffolding + discovered wire protocol doc"
```

---

### Task 2: Dedicated test environment (DB + production server launcher)

**Files:**
- Create: `load-tests/docker-compose.yml`
- Create: `load-tests/setup/rls.sql`
- Create: `load-tests/setup/setup-db.mjs`
- Create: `load-tests/.env.loadtest.example`
- Create: `load-tests/start-server.ps1`

**Interfaces:**
- Produces: a running Postgres on `localhost:55432` (db `quiz_loadtest`, superuser `postgres`/`loadtest`, app role `quiz_app`/`loadtest_app_pw`); a production server on `http://localhost:5100` resolving tenant slug `loadtest` from Origin `http://localhost:5100`; env-file contract `.env.loadtest` consumed by every later script via the same 6-line parser used in `setup-db.mjs`.
- Consumes: repo `drizzle.config.ts` (reads `DATABASE_URL`), `migrations/0003_rls.sql` + `0005_quiz_app_role.sql` as the pattern source for `rls.sql`.

- [ ] **Step 1: Write `load-tests/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    container_name: quiz-loadtest-pg
    command: postgres -c shared_preload_libraries=pg_stat_statements -c max_connections=200
    environment:
      POSTGRES_PASSWORD: loadtest
      POSTGRES_DB: quiz_loadtest
    ports:
      - "55432:5432"
```

- [ ] **Step 2: Write `load-tests/setup/rls.sql`** (prod-parity RLS without Supabase-only roles; loadtest-only password is deliberate)

```sql
-- Tenant-isolation RLS for the LOAD-TEST database only. Mirrors
-- migrations/0003_rls.sql (forced tenant_isolation policy pair on every
-- tenant_id table) and 0005_quiz_app_role.sql (NOBYPASSRLS app role), minus
-- Supabase-specific anon/authenticated revokes. The embedded password is
-- acceptable here because this database must never be anything but local.
begin;

create or replace function public.current_tenant_id() returns integer
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::integer
$$;

create or replace function public.is_system_context() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.role', true), '') = 'system'
$$;

-- connect-pg-simple session table (drizzle push does not create it).
create table if not exists "session" (
  "sid" varchar not null collate "default",
  "sess" json not null,
  "expire" timestamp(6) not null,
  constraint "session_pkey" primary key ("sid")
);
create index if not exists "IDX_session_expire" on "session" ("expire");

-- Forced tenant_isolation pair on every public table that has tenant_id.
do $$
declare t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
  loop
    execute format('alter table public.%I enable row level security', t.table_name);
    execute format('alter table public.%I force row level security', t.table_name);
    execute format('drop policy if exists tenant_isolation on public.%I', t.table_name);
    execute format(
      'create policy tenant_isolation on public.%I using (public.is_system_context() or tenant_id = public.current_tenant_id()) with check (public.is_system_context() or tenant_id = public.current_tenant_id())',
      t.table_name);
  end loop;
end $$;

-- tenants registry: system context only.
alter table public.tenants enable row level security;
alter table public.tenants force row level security;
drop policy if exists tenants_system_only on public.tenants;
create policy tenants_system_only on public.tenants
  using (public.is_system_context()) with check (public.is_system_context());

-- session: open policy (unguessable sids), matches 0003.
alter table public.session enable row level security;
alter table public.session force row level security;
drop policy if exists session_open on public.session;
create policy session_open on public.session using (true) with check (true);

-- App role: NOSUPERUSER NOBYPASSRLS, DML only (mirrors 0005).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'quiz_app') then
    create role quiz_app with login;
  end if;
end $$;
alter role quiz_app with nosuperuser nobypassrls password 'loadtest_app_pw';
grant usage on schema public to quiz_app;
grant select, insert, update, delete on all tables in schema public to quiz_app;
grant usage, select on all sequences in schema public to quiz_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to quiz_app;
alter default privileges in schema public
  grant usage, select on sequences to quiz_app;

commit;
```

- [ ] **Step 3: Write `load-tests/.env.loadtest.example`**

```ini
# Copy to load-tests/.env.loadtest (gitignored). LOCAL ONLY — scripts refuse
# any non-localhost database host.
DATABASE_URL=postgresql://quiz_app:loadtest_app_pw@localhost:55432/quiz_loadtest
ADMIN_DATABASE_URL=postgresql://postgres:loadtest@localhost:55432/quiz_loadtest
BASE_URL=http://localhost:5100
PORT=5100
CLIENT_ORIGIN=http://localhost:5100
SESSION_SECRET=loadtest-only-secret
# Raised so the harness (not the product cap) finds the ceiling. Deviation
# from prod default 500 — documented in the report.
MAX_PLAYERS_PER_GAME=5000
# One generator IP would trip the 600/min join limiter — disabled (0).
# Deviation documented in the report.
RATE_LIMIT_JOIN_MAX=0
```

- [ ] **Step 4: Write `load-tests/setup/setup-db.mjs`**

```js
// Creates the load-test database schema: drizzle push + RLS + tenant seed.
// Run AFTER `docker compose up -d` and BEFORE starting the server.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");

export function loadEnv() {
  const envFile = path.join(here, "..", ".env.loadtest");
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

export function assertLocal(url, label) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(`${label} host "${host}" is not local. Load tests must never touch a remote/production database.`);
  }
}

loadEnv();
const admin = process.env.ADMIN_DATABASE_URL;
assertLocal(admin, "ADMIN_DATABASE_URL");
assertLocal(process.env.DATABASE_URL, "DATABASE_URL");

console.log("[setup-db] pushing schema via drizzle-kit...");
execSync("npx drizzle-kit push --force", {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: admin },
});

const pool = new pg.Pool({ connectionString: admin, max: 2 });
console.log("[setup-db] applying RLS + quiz_app role...");
await pool.query(readFileSync(path.join(here, "rls.sql"), "utf8"));
await pool.query("create extension if not exists pg_stat_statements");

console.log("[setup-db] seeding loadtest tenant...");
await pool.query("select set_config('app.role', 'system', false)");
await pool.query(`
  insert into tenants (slug, name, domains, branding, features, status)
  values ('loadtest', 'Load Test', '["localhost","127.0.0.1"]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'active')
  on conflict (slug) do update set domains = excluded.domains, status = 'active'
`);
const { rows } = await pool.query(
  "select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'quiz_app'",
);
console.log("[setup-db] quiz_app:", rows[0]); // must be rolsuper=f, rolbypassrls=f
await pool.end();
console.log("[setup-db] done");
```

- [ ] **Step 5: Write `load-tests/start-server.ps1`**

```powershell
# Starts the PRODUCTION build with the monitor agent preloaded.
# Usage (from repo root):  npm run build  ;  .\load-tests\start-server.ps1
$root = Split-Path -Parent $PSScriptRoot
Get-Content (Join-Path $PSScriptRoot ".env.loadtest") | ForEach-Object {
  if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$') {
    Set-Item -Path ("Env:" + $Matches[1]) -Value $Matches[2]
  }
}
$env:NODE_ENV = "production"
$agent = (Join-Path $PSScriptRoot "monitor\agent.mjs") -replace '\\', '/'
$env:NODE_OPTIONS = "--import file:///$agent"
$env:LOADTEST_AGENT_OUT = Join-Path $PSScriptRoot "results\agent.ndjson"
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot "results") | Out-Null
Write-Host "Starting production server on port $env:PORT (agent -> $env:LOADTEST_AGENT_OUT)"
node (Join-Path $root "dist\index.js")
```

- [ ] **Step 6: Verify the stack boots** (agent.mjs doesn't exist yet — temporarily blank NODE_OPTIONS)

```powershell
cd load-tests; docker compose up -d; cd ..
Copy-Item load-tests\.env.loadtest.example load-tests\.env.loadtest
node load-tests\setup\setup-db.mjs
npm run build
# temporary boot check without the agent:
#   run start-server.ps1 after commenting the two NODE_OPTIONS lines, then:
Invoke-RestMethod http://localhost:5100/api/healthz   # expect status ok
Invoke-RestMethod http://localhost:5100/api/readyz    # expect db ok
# smoke a register through tenant resolution:
Invoke-RestMethod -Method Post -Uri http://localhost:5100/api/register `
  -Headers @{Origin="http://localhost:5100"} -ContentType "application/json" `
  -Body '{"username":"lt_boot_check","password":"TestPass123!"}'   # expect 201-shaped JSON
```
Expected: all three succeed; server log shows "serving on port 5100". Restore the NODE_OPTIONS lines afterward.

- [ ] **Step 7: Commit**

```powershell
git branch --show-current
git add load-tests
git commit -m "loadtest: dockerized DB, RLS-parity setup, production server launcher"
```

---

### Task 3: Server-side monitoring (preload agent + Postgres/TCP poller)

**Files:**
- Create: `load-tests/monitor/agent.mjs`
- Create: `load-tests/monitor/poll.mjs`

**Interfaces:**
- Produces: `results/agent.ndjson` — one JSON line per second: `{t, elDelayP50Ms, elDelayP99Ms, elDelayMaxMs, rss, heapUsed, cpuUserMs, cpuSysMs, gcPauseMs, gcCount, gcMaxMs}` (consumed by `analyze.mjs` and `soak.mjs`). `poll.mjs` appends to `<outdir>/pg-samples.csv`: `t,total,active,idle,idle_in_tx,waiting,tcp_established` every 2 s (args: `node poll.mjs <outdir>`).
- Consumes: `LOADTEST_AGENT_OUT` env set by `start-server.ps1`; `ADMIN_DATABASE_URL` + `PORT` from `.env.loadtest`.

- [ ] **Step 1: Write `load-tests/monitor/agent.mjs`**

```js
// Preloaded into the server via NODE_OPTIONS="--import file:///...agent.mjs".
// Samples event-loop delay, GC pauses, memory, CPU once per second to ndjson.
// Zero app-code changes; inert unless LOADTEST_AGENT_OUT is set.
import { monitorEventLoopDelay, PerformanceObserver } from "node:perf_hooks";
import { appendFileSync } from "node:fs";

const out = process.env.LOADTEST_AGENT_OUT;
if (out) {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  let gcPauseMs = 0, gcCount = 0, gcMaxMs = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      gcPauseMs += e.duration;
      gcCount += 1;
      if (e.duration > gcMaxMs) gcMaxMs = e.duration;
    }
  }).observe({ entryTypes: ["gc"] });

  let lastCpu = process.cpuUsage();
  setInterval(() => {
    const cpu = process.cpuUsage(lastCpu);
    lastCpu = process.cpuUsage();
    const mem = process.memoryUsage();
    const line = {
      t: Date.now(),
      elDelayP50Ms: h.percentile(50) / 1e6,
      elDelayP99Ms: h.percentile(99) / 1e6,
      elDelayMaxMs: h.max / 1e6,
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      cpuUserMs: cpu.user / 1000,
      cpuSysMs: cpu.system / 1000,
      gcPauseMs, gcCount, gcMaxMs,
    };
    gcPauseMs = 0; gcCount = 0; gcMaxMs = 0;
    h.reset();
    try { appendFileSync(out, JSON.stringify(line) + "\n"); } catch { /* disk hiccup: drop sample */ }
  }, 1000).unref();
}
```

- [ ] **Step 2: Write `load-tests/monitor/poll.mjs`**

```js
// Samples Postgres connection states and server TCP connections every 2s.
// Usage: node load-tests/monitor/poll.mjs <outdir>
import { appendFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { loadEnv, assertLocal } from "../setup/setup-db.mjs";

loadEnv();
const admin = process.env.ADMIN_DATABASE_URL;
assertLocal(admin, "ADMIN_DATABASE_URL");
const port = process.env.PORT || "5100";
const outdir = process.argv[2] || path.join(import.meta.dirname, "..", "results");
mkdirSync(outdir, { recursive: true });
const csv = path.join(outdir, "pg-samples.csv");
appendFileSync(csv, "t,total,active,idle,idle_in_tx,waiting,tcp_established\n");

const pool = new pg.Pool({ connectionString: admin, max: 1 });

function tcpEstablished() {
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
    return out.split("\n").filter((l) => l.includes(`:${port}`) && l.includes("ESTABLISHED")).length;
  } catch { return -1; }
}

setInterval(async () => {
  try {
    const { rows } = await pool.query(`
      select count(*)::int as total,
             count(*) filter (where state = 'active')::int as active,
             count(*) filter (where state = 'idle')::int as idle,
             count(*) filter (where state = 'idle in transaction')::int as idle_in_tx,
             count(*) filter (where wait_event is not null and state = 'active')::int as waiting
      from pg_stat_activity where datname = current_database()`);
    const r = rows[0];
    appendFileSync(csv, `${Date.now()},${r.total},${r.active},${r.idle},${r.idle_in_tx},${r.waiting},${tcpEstablished()}\n`);
  } catch (err) { console.error("[poll]", err.message); }
}, 2000);
console.log(`[poll] sampling to ${csv} (ctrl-c or kill to stop)`);
```

- [ ] **Step 3: Verify** — restart the server via `start-server.ps1` (agent enabled), run `node load-tests/monitor/poll.mjs load-tests/results` for ~10 s, then:

```powershell
Get-Content load-tests\results\agent.ndjson -Tail 3     # 3 JSON lines, sane values
Get-Content load-tests\results\pg-samples.csv -Tail 3   # csv rows with numbers
```
Expected: both files grow ~1 line/s and /2 s respectively; `elDelayP99Ms` idle baseline < 20 ms.

- [ ] **Step 4: Commit**

```powershell
git branch --show-current
git add load-tests/monitor
git commit -m "loadtest: monitor preload agent (event loop, GC, mem, cpu) + pg/tcp poller"
```

---

### Task 4: Seed script (host + 10-question quiz)

**Files:**
- Create: `load-tests/setup/seed.mjs`

**Interfaces:**
- Produces: `load-tests/results/run-config.json` = `{baseUrl, origin, wsUrl, hostToken, hostUsername, quizId}` — consumed by `conductor/host.mjs` and `run.mjs`. Quiz = 10 single-select questions, 4 answers, `timeLimit: 15` (answers land in the 2–10 s window with margin before the 15 s auto-close).
- Consumes: running server + `.env.loadtest` (Task 2), API contract from PROTOCOL.md.

- [ ] **Step 1: Write `load-tests/setup/seed.mjs`**

```js
// Registers a load-test host account and a 10-question quiz via the public API.
// Idempotent per run id; writes results/run-config.json for the conductor.
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadEnv } from "./setup-db.mjs";

loadEnv();
const BASE = process.env.BASE_URL;
const ORIGIN = process.env.CLIENT_ORIGIN;
const suffix = randomUUID().slice(0, 8);
const username = `lt_host_${suffix}`;
const password = "LoadTest123!";

async function api(pathname, init = {}, token) {
  const headers = {
    "content-type": "application/json",
    origin: ORIGIN,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${await res.text()}`);
  return res.json();
}

await api("/api/register", { method: "POST", body: JSON.stringify({ username, password }) });
const login = await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });

const questions = Array.from({ length: 10 }, (_, i) => ({
  question: `Load question ${i + 1}?`,
  answers: ["A", "B", "C", "D"],
  correctAnswer: i % 4,
  timeLimit: 15,
}));
const quiz = await api("/api/quizzes", {
  method: "POST",
  body: JSON.stringify({
    title: `lt_quiz_${suffix}`,
    description: "load test quiz - synthetic data only",
    isPublic: true,
    background: "classroom",
    createdBy: 0,
    questions,
  }),
}, login.token);

const outDir = path.join(import.meta.dirname, "..", "results");
mkdirSync(outDir, { recursive: true });
const config = {
  baseUrl: BASE,
  origin: ORIGIN,
  wsUrl: BASE.replace(/^http/, "ws") + "/game-ws",
  hostToken: login.token,
  hostUsername: username,
  quizId: quiz.id,
};
writeFileSync(path.join(outDir, "run-config.json"), JSON.stringify(config, null, 2));
console.log("[seed] run-config.json written:", { hostUsername: username, quizId: quiz.id });
```

- [ ] **Step 2: Verify**

```powershell
node load-tests\setup\seed.mjs
Get-Content load-tests\results\run-config.json
```
Expected: JSON with a non-empty `hostToken` and integer `quizId`.

- [ ] **Step 3: Commit**

```powershell
git branch --show-current
git add load-tests/setup/seed.mjs
git commit -m "loadtest: API-driven seed (host account + 10x15s-question quiz)"
```

---

### Task 5: Host conductor

**Files:**
- Create: `load-tests/conductor/host.mjs`

**Interfaces:**
- Consumes: `results/run-config.json` (Task 4 shape). Env: `OUT_DIR` (required), `TARGET_PLAYERS` (int; 0 = start immediately), `REVEAL_MS` (default 3000), `GO_TIMEOUT_MS` (default 180000).
- Produces: `<OUT_DIR>/pin.json` = `{gamePin, gameId}` written BEFORE waiting for players (run.mjs reads it to launch k6); `<OUT_DIR>/host-events.ndjson` lines `{t, evt, q?}` where evt ∈ `game_created|ws_joined|go|started|question_started|question_closed|next_sent|game_completed|watchdog_fired`; exit 0 on `game_completed`, exit 2 on overall timeout (15 min).

- [ ] **Step 1: Write `load-tests/conductor/host.mjs`**

```js
// Plays the host for ONE game: create -> WS join -> wait for players -> start
// -> advance after each question_closed (+REVEAL_MS) -> game_completed.
import { WebSocket } from "ws";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT_DIR = process.env.OUT_DIR;
if (!OUT_DIR) throw new Error("OUT_DIR is required");
mkdirSync(OUT_DIR, { recursive: true });
const cfg = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "results", "run-config.json"), "utf8"));
const TARGET = Number(process.env.TARGET_PLAYERS ?? 0);
const REVEAL_MS = Number(process.env.REVEAL_MS ?? 3000);
const GO_TIMEOUT_MS = Number(process.env.GO_TIMEOUT_MS ?? 180_000);
const eventsFile = path.join(OUT_DIR, "host-events.ndjson");
const log = (o) => appendFileSync(eventsFile, JSON.stringify({ t: Date.now(), ...o }) + "\n");

async function api(pathname, init = {}) {
  const res = await fetch(`${cfg.baseUrl}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      origin: cfg.origin,
      authorization: `Bearer ${cfg.hostToken}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const overall = setTimeout(() => { console.error("[host] overall timeout"); process.exit(2); }, 15 * 60_000);
overall.unref?.();

const game = await api("/api/games", { method: "POST", body: JSON.stringify({ quizId: cfg.quizId }) });
writeFileSync(path.join(OUT_DIR, "pin.json"), JSON.stringify({ gamePin: game.gamePin, gameId: game.id }));
log({ evt: "game_created", pin: game.gamePin, gameId: game.id });
console.log(`[host] game ${game.gamePin} (id ${game.id})`);

const ws = new WebSocket(`${cfg.wsUrl}?token=${encodeURIComponent(cfg.hostToken)}`, {
  headers: { origin: cfg.origin },
});
let advancing = false;
let watchdog;

function armWatchdog(qIndex) {
  clearTimeout(watchdog);
  // timeLimit 15s + reveal + generous slack; if nothing closed, force-advance.
  watchdog = setTimeout(async () => {
    log({ evt: "watchdog_fired", q: qIndex });
    await advance().catch((e) => console.error("[host] watchdog advance failed:", e.message));
  }, 45_000);
}

async function advance() {
  if (advancing) return;
  advancing = true;
  try {
    log({ evt: "next_sent" });
    const r = await api(`/api/games/${game.gamePin}/next-question`, { method: "POST" });
    if (r.gameComplete) clearTimeout(watchdog);
  } finally { advancing = false; }
}

ws.on("open", () => ws.send(JSON.stringify({ type: "join", gamePin: game.gamePin, isHost: true })));
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "joined") { log({ evt: "ws_joined" }); void waitForPlayersThenStart(); }
  else if (m.type === "question_started") { log({ evt: "question_started", q: m.questionIndex }); armWatchdog(m.questionIndex); }
  else if (m.type === "question_closed") {
    log({ evt: "question_closed", q: m.questionIndex, responses: m.distribution?.totalResponses });
    clearTimeout(watchdog);
    setTimeout(() => advance().catch((e) => console.error("[host] advance failed:", e.message)), REVEAL_MS);
  } else if (m.type === "game_completed") {
    log({ evt: "game_completed" });
    console.log("[host] game completed");
    ws.close();
    process.exit(0);
  } else if (m.type === "error") {
    log({ evt: "ws_error", code: m.code });
    console.error("[host] ws error:", m.code, m.message);
  }
});
ws.on("close", (code) => log({ evt: "ws_closed", code }));

let started = false;
async function waitForPlayersThenStart() {
  if (started) return;
  const deadline = Date.now() + GO_TIMEOUT_MS;
  let lastCount = -1, stableSince = Date.now();
  for (;;) {
    const snap = await api(`/api/games/${game.gamePin}`);
    const count = Array.isArray(snap.players) ? snap.players.length : 0;
    if (count !== lastCount) { lastCount = count; stableSince = Date.now(); }
    const stable = Date.now() - stableSince > 10_000;
    if (count >= TARGET || (TARGET > 0 && count >= TARGET * 0.99 && stable) || Date.now() > deadline) {
      started = true;
      log({ evt: "go", players: count });
      console.log(`[host] starting with ${count} players`);
      await api(`/api/games/${game.gamePin}/start`, { method: "POST" });
      log({ evt: "started" });
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
```

- [ ] **Step 2: Verify with a zero-player game** (questions auto-close on their 15 s timers even with no answers)

```powershell
$env:OUT_DIR="load-tests\results\smoke-host"; $env:TARGET_PLAYERS="0"
node load-tests\conductor\host.mjs
```
Expected: prints game pin, runs ~10 × (15 s + 3 s) ≈ 3 min, prints "game completed", exit 0. `host-events.ndjson` shows `question_started`/`question_closed` pairs for q 0–9 and one `game_completed`.

- [ ] **Step 3: Commit**

```powershell
git branch --show-current
git add load-tests/conductor
git commit -m "loadtest: host conductor (create/start/advance one game, ndjson timeline)"
```

---

### Task 6: k6 player script (S1 join storm + S2 active quiz + S3 fan-out capture)

**Files:**
- Create: `load-tests/k6/players.js`

**Interfaces:**
- Consumes env: `BASE_URL`, `ORIGIN`, `WS_URL`, `PIN`, `RUN_ID`, `N`, `RAMP` (default `60s`), `HOLD` (default `6m`), `SCENARIO` (`quiz`|`join`), `RECONNECT_PCT` (Task 9, default 0), `DROP_AT` (default 4).
- Produces metrics consumed by `analyze.mjs`: Trends `join_latency`, `answer_ack_latency`, `broadcast_recv_epoch` (value = local `Date.now()` at receive, tags `evt`, `q`), `reconnect_time`; Rates `join_fail`, `ws_disconnect`; Counters `ws_joined`, `answers_accepted`, `answers_rejected`, `induced_drops`, `ws_errors`. Player names are `${RUN_ID}_p${__VU}` (matches DB rows for verification). `handleSummary` writes `<OUT_DIR>/k6-summary.json`.

- [ ] **Step 1: Install k6 and verify**

```powershell
winget install k6.k6
k6 version
```

- [ ] **Step 2: Write `load-tests/k6/players.js`**

```js
// One VU = one quiz participant replaying the real protocol:
// REST join -> WS join -> answer each question via REST within a random
// 2-10s window -> hold until game_completed.
// All coordination state is per-VU (module scope re-inits per VU).
import http from "k6/http";
import ws from "k6/ws";
import { sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const joinLatency = new Trend("join_latency", true);
const answerAck = new Trend("answer_ack_latency", true);
const broadcastRecv = new Trend("broadcast_recv_epoch", false);
const reconnectTime = new Trend("reconnect_time", true);
const joinFail = new Rate("join_fail");
const wsDisconnect = new Rate("ws_disconnect");
const wsJoined = new Counter("ws_joined");
const answersAccepted = new Counter("answers_accepted");
const answersRejected = new Counter("answers_rejected");
const inducedDrops = new Counter("induced_drops");
const wsErrors = new Counter("ws_errors");

const BASE = __ENV.BASE_URL;
const ORIGIN = __ENV.ORIGIN;
const WS_URL = __ENV.WS_URL;
const PIN = __ENV.PIN;
const RUN_ID = __ENV.RUN_ID || "lt";
const N = Number(__ENV.N || 50);
const SCENARIO = __ENV.SCENARIO || "quiz";
const RECONNECT_PCT = Number(__ENV.RECONNECT_PCT || 0);
const DROP_AT = Number(__ENV.DROP_AT || 4);

const httpParams = { headers: { "Content-Type": "application/json", Origin: ORIGIN } };

export const options = {
  scenarios: {
    players: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || "60s", target: N },
        { duration: __ENV.HOLD || "6m", target: N },
      ],
      gracefulRampDown: "10s",
      gracefulStop: "30s",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  // Advisory only — the authoritative SLO gate is analyze.mjs (it also covers
  // broadcast delivery, which needs cross-client post-processing).
  thresholds: {
    join_latency: ["p(95)<2000"],
    join_fail: ["rate<0.01"],
    answer_ack_latency: ["p(95)<500"],
  },
};

let finished = false; // per-VU: set once this participant's game is over

function connectOnce(name, isReconnect) {
  let sawCompleted = false;
  let induced = false;
  const dialStart = Date.now();

  const res = ws.connect(WS_URL, { headers: { Origin: ORIGIN } }, (socket) => {
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "join", gamePin: PIN, playerName: name }));
    });

    socket.on("message", (raw) => {
      const now = Date.now();
      // Fast-path discard: lobby join storms broadcast O(N) `game_updated`
      // payloads to every client; parsing them all would melt the generator.
      if (raw.startsWith('{"type":"game_updated"') || raw.startsWith('{"type":"time_remaining"')) return;
      const msg = JSON.parse(raw);

      if (msg.type === "joined") {
        wsJoined.add(1);
        if (isReconnect) reconnectTime.add(now - dialStart);
        if (SCENARIO === "join") {
          // S1: lobby only — hold briefly, then leave cleanly.
          socket.setTimeout(() => { sawCompleted = true; socket.close(); }, 60_000);
        }
      } else if (msg.type === "question_started") {
        broadcastRecv.add(now, { evt: "question_started", q: String(msg.questionIndex) });
        const delay = 2000 + Math.random() * 8000; // spec: answer within 2-10s
        socket.setTimeout(() => {
          const r = http.post(
            `${BASE}/api/games/${PIN}/answer`,
            JSON.stringify({
              playerName: name,
              questionIndex: msg.questionIndex,
              selectedAnswer: Math.floor(Math.random() * 4),
              responseTime: Math.max(0, Date.now() - msg.startedAt),
            }),
            Object.assign({ tags: { api: "answer" } }, httpParams),
          );
          answerAck.add(r.timings.duration);
          if (r.status === 200) answersAccepted.add(1);
          else answersRejected.add(1, { status: String(r.status) });
        }, delay);
      } else if (msg.type === "question_closed") {
        broadcastRecv.add(now, { evt: "question_closed", q: String(msg.questionIndex) });
        if (RECONNECT_PCT > 0 && !isReconnect && !induced &&
            msg.questionIndex === DROP_AT && (__VU % Math.round(100 / RECONNECT_PCT)) === 0) {
          induced = true;
          inducedDrops.add(1);
          socket.close(); // S4: induced mid-quiz drop
        }
      } else if (msg.type === "game_completed") {
        sawCompleted = true;
        socket.close();
      } else if (msg.type === "error") {
        wsErrors.add(1, { code: msg.code });
      }
    });

    socket.on("error", () => wsErrors.add(1, { code: "socket_error" }));
    // Safety net so a hung room can't wedge the VU past the stage.
    socket.setTimeout(() => socket.close(), Number(__ENV.MAX_SESSION_MS || 12 * 60_000));
  });

  if (res.status !== 101) wsErrors.add(1, { code: "upgrade_failed" });
  return { sawCompleted, induced };
}

export default function () {
  if (finished) { sleep(5); return; }
  const name = `${RUN_ID}_p${__VU}`;

  const joinRes = http.post(
    `${BASE}/api/games/${PIN}/join`,
    JSON.stringify({ playerName: name }),
    Object.assign({ tags: { api: "join" } }, httpParams),
  );
  joinLatency.add(joinRes.timings.duration);
  if (joinRes.status !== 200) {
    joinFail.add(1);
    finished = true;
    return;
  }
  joinFail.add(0);

  let session = connectOnce(name, false);
  if (session.induced) {
    sleep(Math.random() * 30); // S4: reconnect within 30s
    session = connectOnce(name, true);
  }
  wsDisconnect.add(session.sawCompleted ? 0 : 1);
  finished = true;
}

export function handleSummary(data) {
  const out = `${__ENV.OUT_DIR || "load-tests/results"}/k6-summary.json`;
  return { [out]: JSON.stringify(data, null, 2), stdout: "\n[k6] summary written\n" };
}
```

- [ ] **Step 3: Smoke run at N=25** (three terminals — server already running from Task 2/3)

```powershell
# terminal A: conductor
$env:OUT_DIR="load-tests\results\smoke-k6"; $env:TARGET_PLAYERS="25"
node load-tests\conductor\host.mjs
# terminal B (once pin.json exists):
$pin = (Get-Content load-tests\results\smoke-k6\pin.json | ConvertFrom-Json).gamePin
$cfg = Get-Content load-tests\results\run-config.json | ConvertFrom-Json
k6 run --out json=load-tests/results/smoke-k6/raw.json.gz `
  -e BASE_URL=$($cfg.baseUrl) -e ORIGIN=$($cfg.origin) -e WS_URL=$($cfg.wsUrl) `
  -e PIN=$pin -e RUN_ID=smoke1 -e N=25 -e RAMP=20s -e HOLD=5m `
  -e OUT_DIR=load-tests/results/smoke-k6 load-tests/k6/players.js
```
Expected: conductor starts once 25 join, completes all 10 questions; k6 summary shows `ws_joined` = 25, `answers_accepted` ≈ 250 (a few 409s from the 2–10 s window racing the 15 s close are acceptable), `ws_disconnect` rate 0, thresholds green. Verify no sockets were dropped at 90 s (auto-pong works): `ws_errors` has no `socket_error` burst ~90 s in.

- [ ] **Step 4: Commit**

```powershell
git branch --show-current
git add load-tests/k6
git commit -m "loadtest: k6 player swarm (real REST+WS protocol, S1-S3 metrics)"
```

---

### Task 7: Analysis library (TDD) + run analyzer

**Files:**
- Create: `load-tests/analyze/lib.mjs`
- Create: `load-tests/analyze/lib.test.mjs`
- Create: `load-tests/analyze/analyze.mjs`

**Interfaces:**
- Produces (lib.mjs, all pure):
  - `percentile(sortedNumbers, p)` → nearest-rank value.
  - `broadcastDeltas(points)` — `points: [{evt, q, epochMs}]` → sorted deltas (ms) of each point vs the min of its `(evt,q)` group.
  - `maxRollingCpuPct(samples, windowSec=30)` — `samples: [{t, cpuUserMs, cpuSysMs}]` (1 s cadence) → max rolling-window mean busy-% of one core.
  - `memGrowthPct(samples, windowMinutes=10)` — `samples: [{t, rss}]` → `(medianLastWindow - medianSecondWindow) / medianSecondWindow * 100` (first window excluded as warm-up); returns `null` if < 3 windows of data.
  - `nextBisectLevel(lastPass, firstFail, resolution=50)` → midpoint rounded down to `resolution`, or `null` when `firstFail - lastPass <= resolution`.
  - `evalSlos(m)` — `m: {joinFailRate, joinP95, ackP95, broadcastP95, disconnectRate, cpuMaxRollingPct, accepted, persisted, memGrowthPct|null}` → `{pass, checks: [{name, value, limit, pass}]}` implementing the Global Constraints SLO table exactly (memGrowth check only when non-null; zero-data-loss = `accepted === persisted`).
- Produces (analyze.mjs): `node analyze.mjs <runDir>` reads `k6-summary.json`, `raw.json.gz`, `host-events.ndjson`, `db-verify.json`, `../agent.ndjson` (window-clipped to the run's start/end from host-events) → writes `<runDir>/run-summary.json` `{n, scenario, metrics, slo: {pass, checks}, timestamps}` and prints a table; exit 0 iff pass.
- Consumes: artifact formats from Tasks 3, 5, 6 and `db-verify.json` from Task 8 (`{accepted, persisted, players}` — analyze treats a missing file as `persisted: null` → data-loss check fails).

- [ ] **Step 1: Write failing tests `load-tests/analyze/lib.test.mjs`**

```js
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
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
node --test load-tests/analyze/lib.test.mjs
```
Expected: FAIL — `Cannot find module ... lib.mjs`.

- [ ] **Step 3: Implement `load-tests/analyze/lib.mjs`**

```js
// Pure computation for load-test analysis. No I/O — unit-tested.

export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function broadcastDeltas(points) {
  const groups = new Map();
  for (const pt of points) {
    const key = `${pt.evt} ${pt.q}`;
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
  const checks = [
    { name: "join_success", value: 1 - m.joinFailRate, limit: ">=0.99", pass: m.joinFailRate <= 0.01 },
    { name: "join_p95_ms", value: m.joinP95, limit: "<2000", pass: m.joinP95 < 2000 },
    { name: "answer_ack_p95_ms", value: m.ackP95, limit: "<500", pass: m.ackP95 < 500 },
    { name: "broadcast_p95_ms", value: m.broadcastP95, limit: "<1000", pass: m.broadcastP95 < 1000 },
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
```

- [ ] **Step 4: Run tests, verify they pass**

```powershell
node --test load-tests/analyze/lib.test.mjs
```
Expected: all 6 tests PASS.

- [ ] **Step 5: Write `load-tests/analyze/analyze.mjs`**

```js
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
```

- [ ] **Step 6: Verify against the Task 6 smoke artifacts** (no db-verify.json yet — expect only `zero_data_loss` to FAIL, everything else PASS)

```powershell
node load-tests\analyze\analyze.mjs load-tests\results\smoke-k6
```

- [ ] **Step 7: Commit**

```powershell
git branch --show-current
git add load-tests/analyze
git commit -m "loadtest: unit-tested analysis lib + per-run SLO analyzer"
```

---

### Task 8: Single-run orchestrator with DB verification

**Files:**
- Create: `load-tests/run.mjs`

**Interfaces:**
- CLI: `node load-tests/run.mjs --n 200 [--scenario quiz|join|reconnect] [--run-id <id>] [--soak]` → creates `results/<runId>/`, spawns conductor + poll + k6, verifies DB, runs analyze; exit code = SLO pass. Exports `runOnce({n, scenario, runId, soak})` returning the parsed `run-summary.json` (consumed by `ramp.mjs` / `soak.mjs`).
- Produces per run dir: `pin.json`, `host-events.ndjson`, `raw.json.gz`, `k6-summary.json`, `pg-samples.csv`, `db-verify.json` `{accepted, persisted, players, byQuestion}`, `db-stats.json` (pg_stat_statements top 20), `run-summary.json`.
- Consumes: everything from Tasks 2–7.

- [ ] **Step 1: Write `load-tests/run.mjs`**

```js
// Orchestrates ONE load-test run at level N against the local test deployment.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnv, assertLocal } from "./setup/setup-db.mjs";

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
  console.log(`[run] ${id} (N=${n}, scenario=${scenario})`);

  const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL, max: 2 });
  await admin.query("select pg_stat_statements_reset()").catch(() => {});

  // 1. Conductor creates the game and waits for players (skip start in join-only mode).
  const conductor = spawn(process.execPath, [path.join(here, "conductor", "host.mjs")], {
    env: {
      ...process.env,
      OUT_DIR: outDir,
      TARGET_PLAYERS: scenario === "join" ? String(2 ** 31) : String(n), // join mode: never start
      GO_TIMEOUT_MS: scenario === "join" ? "120000" : "180000",
    },
    stdio: "inherit",
  });
  const pinFile = path.join(outDir, "pin.json");
  while (!existsSync(pinFile)) await new Promise((r) => setTimeout(r, 250));
  const { gamePin, gameId } = JSON.parse(readFileSync(pinFile, "utf8"));

  // 2. Poller.
  const poll = spawn(process.execPath, [path.join(here, "monitor", "poll.mjs"), outDir], { stdio: "ignore" });

  // 3. k6 player swarm.
  const holdMin = scenario === "join" ? "2m" : "6m";
  const k6 = spawn("k6", [
    "run", "--quiet", `--out`, `json=${outDir}/raw.json.gz`, path.join(here, "k6", "players.js"),
  ], {
    env: {
      ...process.env,
      BASE_URL: cfg.baseUrl, ORIGIN: cfg.origin, WS_URL: cfg.wsUrl,
      PIN: gamePin, RUN_ID: id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20), N: String(n),
      RAMP: "60s", HOLD: holdMin, OUT_DIR: outDir.replace(/\\/g, "/"),
      SCENARIO: scenario === "reconnect" ? "quiz" : scenario,
      RECONNECT_PCT: scenario === "reconnect" ? "20" : "0",
    },
    stdio: "inherit", shell: true,
  });

  const k6Exit = await new Promise((r) => k6.on("exit", r));
  const condExit = await new Promise((r) => {
    if (conductor.exitCode !== null) return r(conductor.exitCode);
    conductor.on("exit", r);
    if (scenario === "join") conductor.kill(); // never starts; end it
  });
  poll.kill();
  console.log(`[run] k6 exit=${k6Exit} conductor exit=${condExit}`);

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
```

- [ ] **Step 2: Verify end-to-end at N=50**

```powershell
node load-tests\run.mjs --n 50
```
Expected: one command runs conductor + poll + k6, finishes in ~7 min, prints the SLO table with ALL PASS including `zero_data_loss` (e.g. `498/498` — accepted == persisted; the 2–10 s window vs 15 s close means most of 500 land). Inspect `results/<id>/db-verify.json`: `byQuestion` has 10 rows.

- [ ] **Step 3: Also verify join-only mode**

```powershell
node load-tests\run.mjs --n 50 --scenario join
```
Expected: no game start (conductor killed after k6 ends), join metrics present, `zero_data_loss` shows `0/0` PASS.

- [ ] **Step 4: Commit**

```powershell
git branch --show-current
git add load-tests/run.mjs
git commit -m "loadtest: single-run orchestrator with DB zero-loss verification"
```

---

### Task 9: S4 reconnect storm

**Files:**
- Modify: `load-tests/analyze/analyze.mjs` (reconnect accounting note only if needed — the k6 script from Task 6 already implements `RECONNECT_PCT`/`DROP_AT` and `run.mjs` already wires `--scenario reconnect`)

**Interfaces:**
- Consumes: `--scenario reconnect` path through `run.mjs` (20% of VUs drop after question index 4 closes, reconnect within 0–30 s).
- Produces: `run-summary.json.metrics.inducedDrops` ≈ 0.2 N and `reconnectP95`; `ws_disconnect` already excludes induced drops because a reconnected VU that sees `game_completed` reports a clean session (`sawCompleted` from the second `connectOnce`).

- [ ] **Step 1: Run the reconnect scenario at N=50**

```powershell
node load-tests\run.mjs --n 50 --scenario reconnect
```
Expected: `inducedDrops` ≈ 10; `reconnect_time` p95 present in k6-summary; `ws_disconnect` rate < 0.01 (induced drops that successfully reconnected and finished do NOT count); all SLOs PASS. `zero_data_loss` note: droppers may miss at most 1–2 questions' answers while offline — accepted counts only 200-acked answers, so the invariant still holds exactly.

- [ ] **Step 2: If `ws_disconnect` wrongly counts reconnected VUs, fix in `k6/players.js`** (the Task 6 code already returns `sawCompleted` from the SECOND session for droppers — verify with the run; if a discrepancy shows, the failure is in the `session = connectOnce(name, true)` reassignment; correct code is exactly as written in Task 6 Step 2).

- [ ] **Step 3: Commit** (only if changes were needed)

```powershell
git branch --show-current
git add load-tests
git commit -m "loadtest: verify S4 reconnect storm accounting"
```

---

### Task 10: S6 breaking-point ramp with bisect + S5 soak driver

**Files:**
- Create: `load-tests/ramp.mjs`
- Create: `load-tests/soak.mjs`

**Interfaces:**
- `ramp.mjs`: env `LEVELS` (default `100,200,400,600,800,1000,1500,2000`), `RESOLUTION` (default 50), `VERIFY_RUNS` (default 3) → steps through levels via `runOnce`, stops at first fail, bisects with `nextBisectLevel`, then runs `VERIFY_RUNS` repeats at the discovered edge; if any repeat fails, drops the edge by `RESOLUTION` and re-verifies. Writes `results/ramp-summary.json` `{levels: [{n, pass, runDir}], edge, verified, verifyRuns: [...]}` — `verified` is the figure the report quotes (worst-of-3 rule: it only becomes `verified` when all 3 repeats pass).
- `soak.mjs`: env `SOAK_N` (required — set to 60% of verified max), `SOAK_MINUTES` (default 60) → loops full quiz cycles via `runOnce({soak:true})` until the wall clock expires, then computes `memGrowthPct` over the WHOLE window from `results/agent.ndjson` and writes `results/soak-summary.json` `{cycles: [...], memGrowthPct, pass}`.
- Consumes: `runOnce` from Task 8, `nextBisectLevel`/`memGrowthPct` from Task 7.

- [ ] **Step 1: Write `load-tests/ramp.mjs`**

```js
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
```

- [ ] **Step 2: Write `load-tests/soak.mjs`**

```js
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
```

- [ ] **Step 3: Smoke the ramp machinery with toy levels**

```powershell
$env:LEVELS="25,50"; $env:VERIFY_RUNS="1"
node load-tests\ramp.mjs
Remove-Item Env:LEVELS; Remove-Item Env:VERIFY_RUNS
```
Expected: both levels pass, no bisect, one verification run at 50, `ramp-summary.json` shows `verified: 50`.

- [ ] **Step 4: Commit**

```powershell
git branch --show-current
git add load-tests/ramp.mjs load-tests/soak.mjs
git commit -m "loadtest: S6 breaking-point ramp with bisect + S5 soak driver"
```

---

### Task 11: EXECUTION — find the ceiling and gather all evidence

No new files (results land in gitignored `results/`; report is Task 12). Run everything from the generator side; server keeps running from `start-server.ps1` (restart it fresh before this task so `agent.ndjson` starts clean — delete the old one first).

- [ ] **Step 1: Fresh environment + record the machine spec** (goes in the report)

```powershell
Remove-Item load-tests\results\agent.ndjson -ErrorAction SilentlyContinue
# restart server via load-tests\start-server.ps1 in its own terminal
Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors
Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory
node --version; k6 version; docker exec quiz-loadtest-pg postgres --version
Get-NetTCPSetting -SettingName Internet | Select-Object DynamicPortRangeStartPort, DynamicPortRangeNumberOfPorts
```
Save the output to `load-tests/results/environment.txt` (redirect with `*>> load-tests\results\environment.txt`).

- [ ] **Step 2: S6 full ramp + bisect + 3× verification**

```powershell
node load-tests\ramp.mjs
```
Expected: hours-long run; ends with `VERIFIED STABLE CONCURRENCY: <N>`. If the very first level (100) fails, debug via `run-summary.json` + `db-stats.json` + `agent.ndjson` before proceeding (likely suspects per PROTOCOL.md: O(N²) `game_updated` join fan-out, 1 Hz tick fan-out, `question_closed` leaderboard payload).
Generator caveat check: if generator CPU (Task Manager, k6 process) exceeds ~70% during a failing level, the measurement is generator-bound — rerun that level from a second machine (`BASE_URL` over LAN in `.env.loadtest` on that machine) before trusting the failure.

- [ ] **Step 3: S4 reconnect storm at the verified max**

```powershell
node load-tests\run.mjs --n <verified> --scenario reconnect --run-id s4-final
```
Expected: PASS at the verified level (record if not — that lowers the quoted figure or becomes a report finding).

- [ ] **Step 4: S5 soak — 60 min at 60% of verified max**

```powershell
$env:SOAK_N=[math]::Round(<verified> * 0.6); $env:SOAK_MINUTES="60"
node load-tests\soak.mjs
```
Expected: all cycles pass, `memGrowthPct < 10`.

- [ ] **Step 5: Archive the evidence set** — copy `ramp-summary.json`, `soak-summary.json`, the three `verify-n*` `run-summary.json` files, `s4-final/run-summary.json`, one representative `db-stats.json`, and `environment.txt` into `load-tests/results/evidence/` (this folder gets force-added with the report in Task 12).

- [ ] **Step 6: Commit checkpoint** (no tracked files change here if all artifacts are gitignored — skip commit if `git status` is clean)

---

### Task 12: Capacity report + README finalization

**Files:**
- Create: `load-tests/results/report.md` (force-added past the results/ gitignore)
- Create: checked-in copies under `load-tests/results/evidence/` (force-added)
- Modify: `load-tests/README.md` (replace stub)

**Interfaces:**
- Consumes: all Task 11 artifacts.
- Produces: the client-quotable deliverable.

- [ ] **Step 1: Write `load-tests/results/report.md`** using this exact skeleton, filling every `<...>` from the evidence files (numbers from `run-summary.json` files; never from memory):

```markdown
# Live Quiz Platform — Load Test Capacity Report (2026-08-__)

## Environment
- Server: production build (`node dist/index.js`, NODE_ENV=production), single process (PRD §12), port 5100
- Hardware: <CPU model, cores, RAM from environment.txt>; generator on <same machine, separate process | second machine over LAN>
- Database: Postgres 16 (Docker, local), pool max <from server/db.ts>, RLS enabled (prod parity)
- Deviations from production defaults: RATE_LIMIT_JOIN_MAX=0 (one generator IP), MAX_PLAYERS_PER_GAME=5000, localhost network (no WAN latency), Sentry disabled

## Verified result
- Maximum stable concurrency (all SLOs, worst of 3 runs at the level): **<N> participants**
- First bottleneck: <name it — e.g. broadcast fan-out CPU saturating the single Node event loop / O(N^2) game_updated join storm / answer-burst DB pool> with evidence:
  <2-4 bullet points citing metrics: cpuMaxRollingPct at first failing level, elDelayP99MaxMs, broadcast p95 growth curve across levels, pg active/waiting counts>

## Latency percentiles per scenario
| Scenario | N | join p95 (ms) | answer ack p95 (ms) | broadcast p95 (ms) | disconnect rate | result |
|---|---|---|---|---|---|---|
| S1 join storm | <N> | ... | n/a | n/a | ... | PASS/FAIL |
| S2/S3 active quiz (verify runs 1-3) | <N> | ... | ... | ... | ... | ... |
| S4 reconnect storm | <N> | ... | ... | ... | ... (excl. induced) | ... |
| S5 soak 60 min | <0.6N> | ... | ... | ... | mem growth ...% | ... |
| S6 first failing level | <M> | ... | ... | ... | ... | FAIL (<which SLO>) |

## Data integrity
Answers accepted vs persisted (game_responses): <a>/<a> across all verification runs — zero loss.

## Capacity statement (client-facing)
In repeated controlled load tests against a dedicated single-instance deployment
(<CPU>/<RAM>, local PostgreSQL), the platform sustained **<rounded-down figure>
concurrent participants** in a single live quiz session with p95 join latency
under 2 seconds, p95 answer acknowledgement under 500 ms, and zero recorded
answer loss. Real-world capacity depends on hosting resources and network
conditions; production deployments on equivalent or larger instances are sized
to support <marketing figure, e.g. "500+"> concurrent participants per session.

## Prioritized optimizations (if/as the ceiling requires)
1. Cheap game_updated join broadcasts (send {playerCount} deltas instead of the
   full O(N) player array; today the join storm is O(N^2) bytes) — expected: largest
   single win for S1 at high N.
2. Batch/coalesce time_remaining ticks (broadcast serializes once already; drop
   per-second ticks in favor of client-side countdown from closesAt, which the
   protocol already carries) — removes N msgs/sec steady-state fan-out.
3. Trim question_closed payload (top-10 leaderboard + own rank instead of full
   sorted players array) — shrinks the worst synchronized fan-out.
4. WS message batching / permessage-deflate evaluation for fan-out frames.
5. DB write batching is already in place (single multi-row INSERT per question
   close); next DB win is pool tuning + pg pool max vs answer-burst concurrency.
6. Horizontal scaling requires sticky routing + shared room state (Redis
   pub/sub) — architectural change, only if a single instance's verified figure
   is below the enterprise target (state is in-memory by design, PRD §12).
Each item: re-run ramp.mjs afterward to quantify actual impact.
```

- [ ] **Step 2: Finalize `load-tests/README.md`** — replace the stub with: prerequisites (Docker, Node ≥22, k6 via `winget install k6.k6`); the exact command sequence (compose up → setup-db → build → start-server.ps1 → seed → run/ramp/soak commands as used in Tasks 8–11); generator limits section (Windows dynamic port range from `Get-NetTCPSetting` output, ~16k default ephemeral ports caps sockets-per-generator; single-generator-machine requirement for skew-free broadcast timing; same-machine CPU-contention caveat and the second-machine option); the deviations table; and a "never against production" warning noting the built-in localhost guard.

- [ ] **Step 3: Force-add the report + evidence, commit**

```powershell
git branch --show-current
git add load-tests/README.md
git add -f load-tests/results/report.md load-tests/results/evidence
git commit -m "loadtest: capacity report, evidence set, final README"
```

- [ ] **Step 4: Verify repo hygiene** — `npm run check && npm test && npm run build` must still pass untouched (the harness adds no app code); `node --test load-tests/analyze/lib.test.mjs` green. Then follow `superpowers:finishing-a-development-branch`.

---

## Self-review notes (already applied)

- Spec coverage: Phase 0 → PROTOCOL.md (Task 1, content embedded); Phase 1 → Tasks 2–3 (dedicated deployment, seeded quiz, CPU/RAM/event-loop/GC/pg/WS monitoring via the lightweight alternative the spec explicitly allows); Phase 2 → S1/S2/S3 Task 6, S4 Task 9, S5 Task 10 (soak.mjs), S6 Task 10 (ramp.mjs); SLOs → `evalSlos` in Task 7 (verbatim limits); Phase 3 → Tasks 11–12 (report, latency tables, capacity statement, optimization list); Rules → Global Constraints + localhost guards + worst-of-3 in ramp.mjs.
- Known measurement caveats stated where they arise: broadcast delivery uses min-receive-across-clients (single generator clock, skew-free; slightly optimistic baseline), k6 VU event loop blocks during the answer POST (can delay that client's receive timestamps — bias noted, cross-checkable against host-events.ndjson), CPU SLO is main-process % of one core (the meaningful saturation metric for a single-threaded Node server).
- `maxClientsPerGame = 250` (websocket.ts:55) is dead code — confirmed unenforced; the real cap is `MAX_PLAYERS_PER_GAME` (storage.ts:22), raised via env.
