import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, assertServerUp, endPool } from "./helpers";

describe("Ops endpoints", () => {
  beforeAll(async () => {
    await assertServerUp();
  });

  afterAll(async () => {
    await endPool();
  });

  it("GET /api/healthz returns 200 with no session cookie and no Origin header", async () => {
    const res = await fetch(`${BASE_URL}/api/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("GET /api/readyz returns 200 with db: ok against the dev DB", async () => {
    const res = await fetch(`${BASE_URL}/api/readyz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: string; latencyMs: number };
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(typeof body.latencyMs).toBe("number");
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
