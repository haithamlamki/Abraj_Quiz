import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { TenantDomainCache, isTransientDbError } = await import("./tenant-cache");
import type { Tenant } from "@shared/schema";

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 1,
    slug: "abraj",
    name: "Abraj",
    domains: ["www.abrajquiz.com"],
    status: "active",
    branding: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as Tenant;
}

function transientError(code = "ENOTFOUND"): Error {
  const err = new Error(`getaddrinfo ${code} pooler.example.com`) as Error & { code: string };
  err.code = code;
  return err;
}

test("isTransientDbError classifies DNS/connection errors as transient", () => {
  assert.equal(isTransientDbError(transientError("ENOTFOUND")), true);
  assert.equal(isTransientDbError(transientError("ECONNREFUSED")), true);
  assert.equal(isTransientDbError(transientError("ETIMEDOUT")), true);
  assert.equal(isTransientDbError(new Error("Connection terminated unexpectedly")), true);
});

test("isTransientDbError treats auth/config errors as permanent", () => {
  const authError = new Error("password authentication failed") as Error & { code: string };
  authError.code = "28P01";
  assert.equal(isTransientDbError(authError), false);
  const missingTable = new Error('relation "tenants" does not exist') as Error & { code: string };
  missingTable.code = "42P01";
  assert.equal(isTransientDbError(missingTable), false);
  assert.equal(isTransientDbError(new Error("some application bug")), false);
});

test("safeRefresh resolves false on transient failure instead of throwing", async () => {
  const cache = new TenantDomainCache({
    loader: async () => {
      throw transientError();
    },
    retryBaseMs: 60_000, // keep the scheduled retry inert for this test
  });
  const ok = await cache.safeRefresh();
  assert.equal(ok, false);
  assert.equal(cache.failureCount, 1);
  cache.stop();
});

test("stale cache keeps serving lookups across a transient outage", async () => {
  let failing = false;
  const cache = new TenantDomainCache({
    loader: async () => {
      if (failing) throw transientError();
      return [makeTenant()];
    },
    retryBaseMs: 60_000,
  });

  await cache.safeRefresh();
  assert.equal(cache.getByHostname("www.abrajquiz.com")?.slug, "abraj");

  failing = true;
  const ok = await cache.safeRefresh();
  assert.equal(ok, false);
  // The outage must not wipe the previously loaded maps.
  assert.equal(cache.getByHostname("www.abrajquiz.com")?.slug, "abraj");
  assert.equal(cache.getBySlug("abraj")?.slug, "abraj");
  cache.stop();
});

test("transient failure schedules a backoff retry that recovers on its own", async () => {
  let calls = 0;
  let failing = true;
  const cache = new TenantDomainCache({
    loader: async () => {
      calls++;
      if (failing) throw transientError();
      return [makeTenant({ slug: "recovered", domains: ["recovered.example.com"] })];
    },
    retryBaseMs: 20,
    retryMaxMs: 40,
  });

  await cache.safeRefresh();
  assert.equal(calls, 1);
  assert.equal(cache.failureCount, 1);

  // Heal the "network" and wait for the scheduled retry to fire.
  failing = false;
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.ok(calls >= 2, `expected the backoff retry to re-invoke the loader (calls=${calls})`);
  assert.equal(cache.failureCount, 0);
  assert.equal(cache.getBySlug("recovered")?.slug, "recovered");
  cache.stop();
});

test("non-transient failure does not schedule a retry", async () => {
  let calls = 0;
  const cache = new TenantDomainCache({
    loader: async () => {
      calls++;
      const err = new Error("password authentication failed") as Error & { code: string };
      err.code = "28P01";
      throw err;
    },
    retryBaseMs: 10,
    retryMaxMs: 20,
  });

  await cache.safeRefresh();
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(calls, 1, "permanent config errors must not be retried by the backoff loop");
  cache.stop();
});

test("success after failures resets the failure counter", async () => {
  let failing = true;
  const cache = new TenantDomainCache({
    loader: async () => {
      if (failing) throw transientError();
      return [makeTenant()];
    },
    retryBaseMs: 60_000,
  });

  await cache.safeRefresh();
  await cache.safeRefresh();
  assert.equal(cache.failureCount, 2);

  failing = false;
  const ok = await cache.safeRefresh();
  assert.equal(ok, true);
  assert.equal(cache.failureCount, 0);
  cache.stop();
});

test("back-compat: constructor still accepts a bare loader function", async () => {
  const cache = new TenantDomainCache(async () => [makeTenant()]);
  await cache.refresh();
  assert.equal(cache.getBySlug("abraj")?.slug, "abraj");
});
