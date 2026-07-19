import "dotenv/config";
import pg from "pg";
import { captureError } from "./instrument";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;
const useSsl =
  process.env.DATABASE_SSL === "true" ||
  (process.env.DATABASE_SSL !== "false" &&
    (process.env.NODE_ENV === "production" ||
      /supabase\.(co|com)|pooler\.supabase\.com/.test(connectionString)));

export const pool = new pg.Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: parseInt(process.env.DATABASE_POOL_MAX || "10", 10),
  idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS || "30000", 10),
  connectionTimeoutMillis: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT_MS || "10000", 10),
  application_name: process.env.DATABASE_APPLICATION_NAME || "abraj-quiz-backend",
  // Guardrails for join-storm contention (scale-400 Fix #3): a stuck query or
  // lock wait must fail fast and return its connection to the pool instead of
  // starving it. Values sit well above worst-case legitimate latency measured
  // from Render (~23ms DB RTT; contended joins complete in single-digit
  // seconds), so they only fire on pathological queries.
  statement_timeout: parseInt(process.env.DATABASE_STATEMENT_TIMEOUT_MS || "30000", 10),
  lock_timeout: parseInt(process.env.DATABASE_LOCK_TIMEOUT_MS || "10000", 10),
});

// pg.Pool emits 'error' when an idle client's connection drops (e.g. the
// Supabase pooler reaping a connection). Without a listener that event is an
// uncaught exception and kills the process — seen in prod 2026-07-19 as a
// fatal "Connection terminated unexpectedly". The pool discards the dead
// client on its own; we just log and report.
pool.on("error", (err) => {
  console.error("Postgres pool: idle client error:", err.message);
  captureError(err, { scope: "db.pool.idle-client" });
});

export const db = drizzle({ client: pool, schema });
