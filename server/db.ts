import pg from "pg";
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
});

export const db = drizzle({ client: pool, schema });
