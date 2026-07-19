import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { MemStorage } = await import("./storage");
const { registerAdminRoutes } = await import("./admin-routes");

// tenantCache.refresh() bypasses IStorage and hits the real DB directly
// (server/tenant-cache.ts's defaultLoader runs db.transaction(...) against
// the real pg pool). Against MemStorage + this harness's placeholder
// DATABASE_URL that rejects fast (ECONNREFUSED), which would turn every
// tenant create/update into a 500 before the audit log write or response
// ever happens. A no-op fake keeps these tests hermetic; production keeps
// the real singleton via admin-routes.ts's default.
const fakeTenantCache = { refresh: async () => {} };

function makeApp(storage: InstanceType<typeof MemStorage>) {
  const app = express();
  app.use(express.json());
  // mirror routes.ts's identity resolver contract
  app.use((req: any, _res, next) => {
    const uid = req.headers["x-test-user"];
    if (uid) req.authUserId = parseInt(String(uid), 10);
    next();
  });
  registerAdminRoutes(app, { storage, tenantCache: fakeTenantCache });
  return app;
}

async function withServer(app: express.Express, fn: (base: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as { port: number };
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

async function seedSuperAdmin(storage: InstanceType<typeof MemStorage>): Promise<number> {
  const u = await storage.createUser({ tenantId: 1 }, { username: "root", password: "x" } as any);
  (u as any).isSuperAdmin = true; // MemStorage rows are live objects
  return u.id;
}

test("GET /api/admin/audit: 401 anon, 403 non-super-admin, 400 without tenantId", async () => {
  const storage = new MemStorage();
  const adminId = await seedSuperAdmin(storage);
  await withServer(makeApp(storage), async (base) => {
    assert.equal((await fetch(`${base}/api/admin/audit?tenantId=1`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/audit?tenantId=1`, { headers: { "x-test-user": "1" } })).status, 403);
    assert.equal((await fetch(`${base}/api/admin/audit`, { headers: { "x-test-user": String(adminId) } })).status, 400);
  });
});

test("GET /api/admin/audit: reads a tenant's trail with filters + pagination", async () => {
  const storage = new MemStorage();
  const adminId = await seedSuperAdmin(storage);
  for (let i = 0; i < 5; i++) {
    await storage.insertAuditEvent({ tenantId: 1 }, { action: i % 2 ? "quiz.save" : "auth.login", actorId: 2, actorName: "alice" } as any);
  }
  await storage.insertAuditEvent({ tenantId: 2 }, { action: "quiz.save", actorId: 3, actorName: "eve" } as any);
  await withServer(makeApp(storage), async (base) => {
    const H = { "x-test-user": String(adminId) };
    const all = await (await fetch(`${base}/api/admin/audit?tenantId=1`, { headers: H })).json();
    assert.equal(all.length, 5);                                     // tenant 2's row absent
    const logins = await (await fetch(`${base}/api/admin/audit?tenantId=1&action=auth.login`, { headers: H })).json();
    assert.ok(logins.length > 0 && logins.every((r: any) => r.action === "auth.login"));
    const page2 = await (await fetch(`${base}/api/admin/audit?tenantId=1&before=${all[1].id}&limit=2`, { headers: H })).json();
    assert.ok(page2.every((r: any) => r.id < all[1].id));
  });
});

test("tenant create/update write audit rows into the target tenant's trail", async () => {
  const storage = new MemStorage();
  const adminId = await seedSuperAdmin(storage);
  await withServer(makeApp(storage), async (base) => {
    const H = { "x-test-user": String(adminId), "content-type": "application/json" };
    const created = await (await fetch(`${base}/api/admin/tenants`, {
      method: "POST", headers: H, body: JSON.stringify({ slug: "newco", name: "NewCo" }),
    })).json();
    await fetch(`${base}/api/admin/tenants/${created.id}`, {
      method: "PATCH", headers: H, body: JSON.stringify({ name: "NewCo 2", status: "active" }),
    });
    await new Promise((r) => setTimeout(r, 20));
    const rows = await storage.listAuditEvents({ system: true } as any, { tenantId: created.id, limit: 10 });
    const actions = rows.map((r) => r.action).sort();
    assert.deepEqual(actions, ["tenant.create", "tenant.update"]);
    assert.equal(rows[0].actorName, "root");
    const upd = rows.find((r) => r.action === "tenant.update")!;
    assert.deepEqual((upd.details as any).fields.sort(), ["name", "status"]);
  });
});
