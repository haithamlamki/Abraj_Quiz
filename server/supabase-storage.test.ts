import { test } from "node:test";
import assert from "node:assert/strict";
import { storeGeneratedBackground, isImageUploadConfigured } from "./supabase-storage";

test("storeGeneratedBackground falls back to a data URL when storage is not configured", async (t) => {
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  t.after(() => {
    if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
    if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  });

  assert.equal(isImageUploadConfigured(), false);
  const png = Buffer.from("fake-png-bytes");
  const url = await storeGeneratedBackground(png);
  assert.ok(url.startsWith("data:image/png;base64,"));
  assert.equal(Buffer.from(url.slice("data:image/png;base64,".length), "base64").toString(), "fake-png-bytes");
});
