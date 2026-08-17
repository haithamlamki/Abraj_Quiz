import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { tenants, type Tenant } from "@shared/schema";

// Loads all active tenants inside a system-context transaction so this keeps
// working after RLS is forced on the tenants table (migration 0003).
async function defaultLoader(): Promise<Tenant[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.role', 'system', true)`);
    return tx.select().from(tenants).where(eq(tenants.status, "active"));
  });
}

// Network-level failures that resolve on their own (DNS blips to the Supabase
// pooler, dropped TCP connections, pool checkout timeouts). Anything else —
// auth failures, missing tables, RLS misconfiguration — is treated as
// permanent and logged loudly instead of being retried into silence.
const TRANSIENT_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "XX000", // Postgres internal_error — Supabase pooler surfaces overload this way
  "57P01", // admin_shutdown (pooler recycling server connections)
]);

export function isTransientDbError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === "string" && TRANSIENT_ERROR_CODES.has(code)) return true;
  const message = err instanceof Error ? err.message : "";
  return /connection terminated|timeout exceeded when trying to connect|connection ended unexpectedly/i.test(
    message,
  );
}

export interface TenantCacheOptions {
  loader?: () => Promise<Tenant[]>;
  // Base delay for the transient-failure retry backoff. Overridable so tests
  // can exercise the retry path without waiting seconds.
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export class TenantDomainCache {
  private byHostname = new Map<string, Tenant>();
  private bySlug = new Map<string, Tenant>();
  private timer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private consecutiveFailures = 0;
  private readonly loader: () => Promise<Tenant[]>;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor(options: TenantCacheOptions | (() => Promise<Tenant[]>) = {}) {
    // Back-compat: the original signature took the loader function directly.
    const opts = typeof options === "function" ? { loader: options } : options;
    this.loader = opts.loader ?? defaultLoader;
    this.retryBaseMs = opts.retryBaseMs ?? 5_000;
    this.retryMaxMs = opts.retryMaxMs ?? 40_000;
  }

  get failureCount(): number {
    return this.consecutiveFailures;
  }

  async refresh(): Promise<void> {
    const rows = await this.loader();
    const byHostname = new Map<string, Tenant>();
    const bySlug = new Map<string, Tenant>();
    for (const tenant of rows) {
      if (tenant.status !== "active") continue;
      bySlug.set(tenant.slug, tenant);
      for (const domain of tenant.domains ?? []) {
        byHostname.set(String(domain).toLowerCase(), tenant);
      }
    }
    this.byHostname = byHostname;
    this.bySlug = bySlug;
  }

  // refresh() that never rejects: on failure the previous cache keeps serving
  // (the lookup maps are only replaced on success). Transient network errors
  // schedule an exponential-backoff retry so recovery doesn't wait for the
  // next 60s interval; permanent errors (bad credentials, missing table) are
  // logged as configuration problems and left to the regular interval.
  async safeRefresh(): Promise<boolean> {
    try {
      await this.refresh();
      this.consecutiveFailures = 0;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
      }
      return true;
    } catch (err) {
      this.consecutiveFailures++;
      if (isTransientDbError(err)) {
        console.warn(
          `Tenant cache refresh failed (transient, attempt ${this.consecutiveFailures}) — serving stale cache, retrying with backoff:`,
          err instanceof Error ? err.message : err,
        );
        this.scheduleRetry();
      } else {
        console.error(
          "Tenant cache refresh failed (non-transient — check DATABASE_URL / DB credentials / RLS configuration):",
          err,
        );
      }
      return false;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const exponent = Math.min(this.consecutiveFailures - 1, 4);
    const delay = Math.min(this.retryBaseMs * 2 ** exponent, this.retryMaxMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.safeRefresh();
    }, delay);
    this.retryTimer.unref?.();
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.safeRefresh();
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  getByHostname(hostname: string): Tenant | undefined {
    return this.byHostname.get(hostname.toLowerCase());
  }

  getBySlug(slug: string): Tenant | undefined {
    return this.bySlug.get(slug);
  }

  getAllOrigins(): string[] {
    const origins = new Set<string>();
    for (const hostname of Array.from(this.byHostname.keys())) {
      origins.add(`https://${hostname}`);
    }
    return Array.from(origins);
  }
}

export const tenantCache = new TenantDomainCache();
