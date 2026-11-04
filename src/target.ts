// The build target: which npm package this build is and which Superflow it talks to.
//
// tsup replaces the identifiers below at build time from SUPERFLOW_MCP_TARGET (prod or
// staging, default prod), with the values in scripts/lib/targets.mjs. Source runs (tests,
// scripts) have no build step, so every value falls back to the prod one. The fallbacks are
// literals on purpose: a build holds only its own target's origin, and scripts/publish.mjs
// checks that (test/unit/target.test.ts keeps them equal to the prod row of the table).
//
// Prod is `@usesuperflow/mcp` (public on npm), staging is `@usesuperflow/mcp-staging` (private
// to the usesuperflow npm org). Both keep the bin name `superflow-mcp` and the User-Agent
// prefix `superflow-mcp/` (the backend classifies MCP traffic by it).

declare const __SUPERFLOW_MCP_TARGET__: string | undefined;
declare const __SUPERFLOW_MCP_NPM_PACKAGE__: string | undefined;
declare const __SUPERFLOW_MCP_ORIGIN__: string | undefined;
declare const __SUPERFLOW_MCP_CREDENTIAL_STORE__: string | undefined;

export type BuildTarget = "prod" | "staging";

/** prod or staging. */
export const BUILD_TARGET: BuildTarget =
  typeof __SUPERFLOW_MCP_TARGET__ === "string" && __SUPERFLOW_MCP_TARGET__ === "staging" ? "staging" : "prod";

/** The npm package of this build: `@usesuperflow/mcp` or `@usesuperflow/mcp-staging`. */
export const NPM_PACKAGE: string =
  typeof __SUPERFLOW_MCP_NPM_PACKAGE__ === "string" ? __SUPERFLOW_MCP_NPM_PACKAGE__ : "@usesuperflow/mcp";

/** The Superflow MCP origin this build talks to by default (MCP, OAuth and the REST API). */
export const DEFAULT_ORIGIN: string =
  typeof __SUPERFLOW_MCP_ORIGIN__ === "string" ? __SUPERFLOW_MCP_ORIGIN__ : "https://mcp.usesuperflow.ai";

/**
 * The Keychain and Secret Service service name and the config folder of the saved sign-in.
 * Staging has its own, so a staging sign-in never overwrites a prod one.
 */
export const CREDENTIAL_STORE_NAME: string =
  typeof __SUPERFLOW_MCP_CREDENTIAL_STORE__ === "string" ? __SUPERFLOW_MCP_CREDENTIAL_STORE__ : "superflow-mcp";

/** What a user types to run this build: `npx -y @usesuperflow/mcp`. Every command hint uses it. */
export const NPX_COMMAND = `npx -y ${NPM_PACKAGE}`;
