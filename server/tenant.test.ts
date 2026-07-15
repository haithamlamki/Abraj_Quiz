import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { extractHostname } = await import("./tenant");
const { TenantDomainCache } = await import("./tenant-cache");

const fakeTenants = [
  {
    id: 1, slug: "abraj", name: "Abraj Quiz",
    domains: ["abrajquiz.com", "www.abrajquiz.com", "localhost"],
    branding: {}, features: {}, status: "active", createdAt: new Date(),
  },
  {
    id: 2, slug: "pdo", name: "PDO Quiz",
    domains: ["pdoquiz.com"],
    branding: {}, features: {}, status: "active", createdAt: new Date(),
  },
] as any[];

test("extractHostname: prefers Origin header and strips scheme/port", () => {
  assert.equal(extractHostname("https://PDOquiz.com:443", "api.example.com"), "pdoquiz.com");
  assert.equal(extractHostname("http://localhost:5173", "localhost:5000"), "localhost");
});

test("extractHostname: falls back to Host header, stripping port", () => {
  assert.equal(extractHostname(undefined, "abrajquiz.com:443"), "abrajquiz.com");
  assert.equal(extractHostname(undefined, "Localhost:5000"), "localhost");
});

test("extractHostname: garbage origin yields undefined origin path, uses host", () => {
  assert.equal(extractHostname("not a url", "pdoquiz.com"), "pdoquiz.com");
  assert.equal(extractHostname(undefined, undefined), undefined);
});

test("TenantDomainCache: resolves hostname to tenant after refresh", async () => {
  const cache = new TenantDomainCache(async () => fakeTenants);
  await cache.refresh();
  assert.equal(cache.getByHostname("pdoquiz.com")?.slug, "pdo");
  assert.equal(cache.getByHostname("www.abrajquiz.com")?.slug, "abraj");
  assert.equal(cache.getByHostname("unknown.com"), undefined);
});

test("TenantDomainCache: getBySlug and getAllOrigins", async () => {
  const cache = new TenantDomainCache(async () => fakeTenants);
  await cache.refresh();
  assert.equal(cache.getBySlug("abraj")?.id, 1);
  const origins = cache.getAllOrigins();
  assert.ok(origins.includes("https://pdoquiz.com"));
  assert.ok(origins.includes("https://abrajquiz.com"));
});

test("TenantDomainCache: suspended tenants are excluded", async () => {
  const cache = new TenantDomainCache(async () => [
    { ...fakeTenants[1], status: "suspended" },
  ] as any[]);
  await cache.refresh();
  assert.equal(cache.getByHostname("pdoquiz.com"), undefined);
});
