import { defineConfig } from "vitest/config";

// The live suite: the BUILT package (run `pnpm build` first) and the in-process comment
// lifecycle, both against a real Superflow API. Needs SUPERFLOW_TEST_API_KEY and
// SUPERFLOW_TEST_PROJECT; see test/live/staging.live.ts.
export default defineConfig({
  test: {
    include: ["test/live/**/*.live.ts", "test/integration/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
