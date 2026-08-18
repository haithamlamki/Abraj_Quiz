import test from "node:test";
import assert from "node:assert/strict";

// window stub so the default-parameter path (window.location.origin) works
// under the node test runner.
(globalThis as any).window = { location: { origin: "https://abraj-quiz.vercel.app" } };

const { getShareOrigin, joinUrl } = await import("./share-url");

const withCanonical = { branding: { canonicalDomain: "www.abrajquiz.com" } } as any;
const withoutCanonical = { branding: { canonicalDomain: "" } } as any;

test("uses the tenant canonical domain when set", () => {
  assert.equal(getShareOrigin(withCanonical), "https://www.abrajquiz.com");
  assert.equal(joinUrl(withCanonical, "477019"), "https://www.abrajquiz.com/join/477019");
});

test("falls back to the current origin when canonicalDomain is empty", () => {
  assert.equal(getShareOrigin(withoutCanonical), "https://abraj-quiz.vercel.app");
  assert.equal(
    joinUrl(withoutCanonical, "477019"),
    "https://abraj-quiz.vercel.app/join/477019",
  );
  // Explicit current origin (dev server) is honored too.
  assert.equal(
    joinUrl(withoutCanonical, "123456", "http://localhost:5000"),
    "http://localhost:5000/join/123456",
  );
});

test("tolerates whitespace, schemes, and trailing slashes in the stored value", () => {
  assert.equal(
    getShareOrigin({ branding: { canonicalDomain: "  www.abrajquiz.com  " } } as any),
    "https://www.abrajquiz.com",
  );
  assert.equal(
    getShareOrigin({ branding: { canonicalDomain: "https://www.abrajquiz.com/" } } as any),
    "https://www.abrajquiz.com",
  );
  assert.equal(
    getShareOrigin({ branding: { canonicalDomain: "http://legacy.example.com" } } as any),
    "http://legacy.example.com",
  );
});

test("dev guard: canonicalDomain is ignored on localhost origins", () => {
  assert.equal(
    getShareOrigin(withCanonical, "http://localhost:5000"),
    "http://localhost:5000",
  );
  assert.equal(
    getShareOrigin(withCanonical, "http://127.0.0.1:5000"),
    "http://127.0.0.1:5000",
  );
});

test("missing branding field behaves like empty (older cached configs)", () => {
  assert.equal(
    getShareOrigin({ branding: {} } as any),
    "https://abraj-quiz.vercel.app",
  );
});
