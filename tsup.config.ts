import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";
import { TARGETS, resolveTarget } from "./scripts/lib/targets.mjs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// SUPERFLOW_MCP_TARGET=prod (the default) builds @usesuperflow/mcp, staging builds
// @usesuperflow/mcp-staging. src/target.ts reads these; scripts/publish.mjs sets the variable.
const targetName = resolveTarget(process.env.SUPERFLOW_MCP_TARGET);
const target = TARGETS[targetName];

const define = {
  __SUPERFLOW_MCP_VERSION__: JSON.stringify(pkg.version),
  __SUPERFLOW_MCP_TARGET__: JSON.stringify(targetName),
  __SUPERFLOW_MCP_NPM_PACKAGE__: JSON.stringify(target.npmPackage),
  __SUPERFLOW_MCP_ORIGIN__: JSON.stringify(target.origin),
  __SUPERFLOW_MCP_CREDENTIAL_STORE__: JSON.stringify(target.credentialStore),
};

export default defineConfig([
  // The CLI: `npx -y @usesuperflow/mcp` (stdio). The bin is `superflow-mcp`.
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
    // Folds `typeof X === "string" ? X : fallback` in src/target.ts once X is defined, so a
    // staging build holds no prod origin (scripts/publish.mjs checks). Names and whitespace stay.
    esbuildOptions(options) {
      options.minifySyntax = true;
    },
  },
  // The library (`@usesuperflow/mcp/server`), ESM and CommonJS, for hosts that serve the tools
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
