import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "threads",
    // Memory is tight on dev machines; two workers keep the run small.
    maxWorkers: 2,
    testTimeout: 15_000,
  },
});
