import { defineConfig } from "vitest/config";

// The stdio end-to-end suite: runs the BUILT package (run `pnpm build` first) against a local
// fake API. Separate from the unit run so `pnpm test` never needs a build.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
