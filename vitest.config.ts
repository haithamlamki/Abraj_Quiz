import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Use fileURLToPath rather than URL(...).pathname: on Windows the latter yields
// "/C:/path/with%20spaces" (leading slash + percent-encoding), which fails to
// resolve when the repo path contains a space.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    // Generous timeouts: these tests hit a real (often remote) Postgres, where
    // each query can take seconds. A single flow chains many round-trips.
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: "forks",
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
});
