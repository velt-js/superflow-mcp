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

// The bin and MCP client name, the same in every build (the npm package name is in
// src/target.ts). The backend classifies MCP traffic by the User-Agent prefix
// `superflow-mcp/` (PUBLIC_API_MCP_CLIENT_PREFIX), so keep both.
export const PACKAGE_NAME = "superflow-mcp";
export const VERSION: string = readVersion();
export const USER_AGENT = `${PACKAGE_NAME}/${VERSION}`;
