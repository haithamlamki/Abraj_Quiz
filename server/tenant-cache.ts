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

export class TenantDomainCache {
  private byHostname = new Map<string, Tenant>();
  private bySlug = new Map<string, Tenant>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly loader: () => Promise<Tenant[]> = defaultLoader) {}

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

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.refresh().catch((err) => {
        console.error("Tenant cache refresh failed:", err);
      });
    }, intervalMs);
    this.timer.unref();
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
