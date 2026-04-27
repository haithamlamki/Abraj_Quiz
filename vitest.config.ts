import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallel: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  resolve: {
    alias: {
      "@shared": new URL("./shared", import.meta.url).pathname,
    },
  },
});
