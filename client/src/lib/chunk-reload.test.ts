import test from "node:test";
import assert from "node:assert/strict";

// Minimal window stub: chunk-reload touches window.location.reload and (via
// safe-storage) window.sessionStorage. Leaving sessionStorage undefined makes
// safe-storage fall back to its in-memory map, which is exactly the blocked-
// storage path we also want covered.
let reloads = 0;
(globalThis as any).window = {
  location: {
    reload() {
      reloads++;
    },
  },
};

const { isChunkLoadError, reloadOnceForStaleChunk } = await import("./chunk-reload");

test("isChunkLoadError matches every observed stale-chunk signature", () => {
  // Chrome, via React.lazy (Sentry ABRAJ-QUIZ-CLIENT-C/E)
  assert.equal(
    isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'default')")),
    true,
  );
  // WebKit/Samsung Internet, via React.lazy (ABRAJ-QUIZ-CLIENT-A/D/8)
  assert.equal(
    isChunkLoadError(new TypeError("undefined is not an object (evaluating 'e._result.default')")),
    true,
  );
  // WebKit import failure (ABRAJ-QUIZ-CLIENT-9)
  assert.equal(isChunkLoadError(new TypeError("Importing a module script failed.")), true);
  // Vite preload failures
  assert.equal(
    isChunkLoadError(new Error("Failed to fetch dynamically imported module: https://x/assets/a.js")),
    true,
  );
  assert.equal(
    isChunkLoadError(new Error("error loading dynamically imported module")),
    true,
  );
  assert.equal(
    isChunkLoadError(new Error("'text/html' is not a valid JavaScript MIME type")),
    true,
  );
});

test("isChunkLoadError rejects unrelated errors", () => {
  assert.equal(
    isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")),
    false,
  );
  assert.equal(isChunkLoadError(new Error("Failed to fetch")), false);
  assert.equal(isChunkLoadError(new Error("Network request failed")), false);
  assert.equal(isChunkLoadError(undefined), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError({}), false);
});

test("reloadOnceForStaleChunk reloads once, then refuses within the window", () => {
  const before = reloads;
  assert.equal(reloadOnceForStaleChunk(), true);
  assert.equal(reloads, before + 1);
  // Second attempt inside the 60s window: guard refuses (no reload loop).
  assert.equal(reloadOnceForStaleChunk(), false);
  assert.equal(reloads, before + 1);
});
