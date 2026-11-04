// The two npm packages built from this repo. tsup.config.ts builds with one row (from
// SUPERFLOW_MCP_TARGET) and scripts/publish.mjs publishes it. src/target.ts holds the prod
// row as its source fallback; test/unit/target.test.ts keeps the two equal.

export const TARGETS = Object.freeze({
  prod: Object.freeze({
    npmPackage: "@usesuperflow/mcp",
    origin: "https://mcp.usesuperflow.ai",
    credentialStore: "superflow-mcp",
    access: "public",
    // npm refuses provenance for a private package, so only prod has it.
    provenance: true,
    descriptionSuffix: "",
  }),
  staging: Object.freeze({
    npmPackage: "@usesuperflow/mcp-staging",
    // The run.app origin: the cloudfunctions.net one fails the OAuth resource check.
    origin: "https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app",
    credentialStore: "superflow-mcp-staging",
    access: "restricted",
    provenance: false,
    descriptionSuffix: " Staging build: talks to Superflow staging. For the Superflow team.",
  }),
});

/** The target named by `value` (SUPERFLOW_MCP_TARGET or a CLI argument). Empty means prod. */
export function resolveTarget(value) {
  const name = (value ?? "").trim() || "prod";
  if (name !== "prod" && name !== "staging") {
    throw new Error(`Unknown target "${name}". Use prod or staging.`);
  }
  return name;
}
