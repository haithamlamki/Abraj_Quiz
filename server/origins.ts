import { tenantCache } from "./tenant-cache";

export const envOrigins = (process.env.CLIENT_ORIGIN || process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Env origins are the bootstrap allowlist (Vercel preview URLs, local dev).
// Tenant custom domains come from the DB and update without a redeploy.
export function getAllowedOrigins(): string[] {
  return Array.from(new Set([...envOrigins, ...tenantCache.getAllOrigins()]));
}
