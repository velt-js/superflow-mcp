import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

const define = { __SUPERFLOW_MCP_VERSION__: JSON.stringify(pkg.version) };

export default defineConfig([
  // The CLI: `npx superflow-mcp` (stdio).
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    clean: false,
    dts: false,
    splitting: false,
    sourcemap: false,
    banner: { js: "#!/usr/bin/env node" },
    define,
  },
  // The library (`superflow-mcp/server`), ESM and CommonJS, for hosts that serve the tools
  // themselves (the hosted server is CommonJS). Dependencies (the MCP SDK, zod) stay external,
  // so the host's own copies are used.
  {
    entry: { server: "src/lib.ts" },
    format: ["esm", "cjs"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    clean: false,
    dts: false,
    splitting: false,
    sourcemap: false,
    shims: true,
    define,
  },
]);
