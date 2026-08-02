// Samples Postgres connection states and server TCP connections every 2s.
// Usage: node load-tests/monitor/poll.mjs <outdir>
import { appendFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { loadEnv, assertLocal } from "../setup/env.mjs";

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
