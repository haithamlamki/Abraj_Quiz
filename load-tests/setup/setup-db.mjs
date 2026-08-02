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
