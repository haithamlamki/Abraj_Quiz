# Load tests

Finds the maximum stable number of concurrent participants in one live quiz
session against a dedicated local production-build deployment, and produces the
client-facing capacity report in `results/report.md`.

See `PROTOCOL.md` for the discovered wire protocol the harness replays
(REST join → raw WS session → REST answers; host drives the game via REST+WS).

> **NEVER run against production or with real participant data.** Every script
> that takes a database URL refuses hostnames other than `localhost` /
> `127.0.0.1` (`assertLocal` in `setup/setup-db.mjs`). `BASE_URL` must point at
> the dedicated local deployment only.

## Prerequisites

- Node ≥ 22 (`npm ci` at the repo root).
- k6: `winget install k6.k6` — or a portable binary, with its path in
  `K6_BIN` in `.env.loadtest`.
- PostgreSQL 16, either:
  - Docker: `docker compose up -d` in this directory (preferred), or
  - no Docker: `setup\pg-up.ps1` downloads portable EnterpriseDB binaries into
    `load-tests/.pg/` and starts them on `127.0.0.1:55432`
    (`setup\pg-down.ps1` stops them).

## Run sequence (PowerShell, from the repo root)

```powershell
# 1. Database up + schema + RLS + loadtest tenant
cd load-tests; docker compose up -d; cd ..        # or: .\load-tests\setup\pg-up.ps1
Copy-Item load-tests\.env.loadtest.example load-tests\.env.loadtest
node load-tests\setup\setup-db.mjs

# 2. Production build + server (own terminal; keeps running)
npm run build
.\load-tests\start-server.ps1                     # port 5100, monitor agent preloaded

# 3. Seed host + quiz (writes results/run-config.json)
node load-tests\setup\seed.mjs

# 4. Single run at level N (conductor + poller + k6 + DB verify + SLO verdict)
node load-tests\run.mjs --n 50                    # scenarios: quiz (default) | join | reconnect

# 5. S6 breaking-point campaign (hours): ramp, bisect, worst-of-3 verification
node load-tests\ramp.mjs                          # env: LEVELS, RESOLUTION, VERIFY_RUNS

# 6. S4 reconnect storm at the verified max
node load-tests\run.mjs --n <verified> --scenario reconnect --run-id s4-final

# 7. S5 soak: 60 min at 60% of the verified max
$env:SOAK_N="330"; $env:SOAK_MINUTES="60"
node load-tests\soak.mjs

# 8. Analyze any run directory on its own
node load-tests\analyze\analyze.mjs load-tests\results\<run-dir>
```

Unit tests for the analysis library: `node --test load-tests/analyze/lib.test.mjs`.

## Generator limits and measurement caveats

- **Ephemeral ports**: Windows default dynamic range is 16,384 ports
  (49152–65535, `Get-NetTCPSetting -SettingName Internet`). Each player holds
  1 WS + transient HTTP connections, so a single generator machine is good for
  a few thousand concurrent players at most before port/TIME_WAIT pressure —
  far above the ceiling found here.
- **Single generator machine is required for broadcast timing**: per-event
  delivery latency = each client's receive time minus the earliest receive time
  for the same event, which is skew-free only when all measuring clients share
  one clock. Do not split k6 across machines and expect broadcast percentiles
  to stay meaningful.
- **Same-machine CPU contention**: running k6 next to the server biases the
  measured ceiling downward (conservative). For a stricter measurement, run k6
  from a second machine over LAN: set `BASE_URL`/`CLIENT_ORIGIN` in that
  machine's `.env.loadtest` to the server's LAN address — and accept that
  broadcast timing then includes one LAN hop.
- k6 VU event loops block during the answer POST; receive timestamps for
  broadcasts arriving in that window are delayed slightly (bias noted in the
  plan; cross-checkable against `host-events.ndjson`).
- The CPU SLO is the **main server process's** busy-% of one core over a 30 s
  rolling window — the meaningful saturation metric for a single-threaded Node
  server (12 physical cores were never the limit; the one event loop is).

## Deviations from production defaults

| Setting | Prod | Here | Why |
|---|---|---|---|
| `RATE_LIMIT_JOIN_MAX` | 600/min/IP | 0 | one generator IP |
| `MAX_PLAYERS_PER_GAME` | 500 | 5000 | find the real ceiling |
| `DATABASE_SSL` | on | false | local PG has no SSL |
| Network | WAN | localhost | no WAN jitter in measurements |
| Sentry | on | off | no reporting overhead |

## Artifacts

`results/` is gitignored except `report.md` and `evidence/` (force-added).
Each run directory contains `run-summary.json` (metrics + SLO verdict),
`k6-summary.json`, `host-events.ndjson`, `db-verify.json`, `pg-samples.csv`,
and the raw k6 stream (`raw.json.gz`). The server-side sampler appends to
`results/agent.ndjson` (event-loop delay, GC, memory, CPU — 1 Hz).
