import { createRequire } from "node:module";

// tsup replaces this identifier with the package version at build time.
declare const __SUPERFLOW_MCP_VERSION__: string | undefined;

function readVersion(): string {
  if (typeof __SUPERFLOW_MCP_VERSION__ === "string") return __SUPERFLOW_MCP_VERSION__;
  // Source runs (tests, scripts) read package.json once instead.
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json") as { version?: string };
  return pkg.version ?? "0.0.0";
}

export const PACKAGE_NAME = "superflow-mcp";
export const VERSION: string = readVersion();
export const USER_AGENT = `${PACKAGE_NAME}/${VERSION}`;
