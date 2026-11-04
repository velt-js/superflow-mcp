import { describe, expect, it } from "vitest";
import { TARGETS, resolveTarget } from "../../scripts/lib/targets.mjs";
import { DEFAULT_AUTH_URL } from "../../src/auth/oauth.ts";
import { DEFAULT_BASE_URL, DEFAULT_MCP_URL } from "../../src/config.ts";
import { BUILD_TARGET, CREDENTIAL_STORE_NAME, DEFAULT_ORIGIN, NPM_PACKAGE, NPX_COMMAND } from "../../src/target.ts";
import { USER_AGENT, VERSION } from "../../src/version.ts";

describe("build target (src/target.ts)", () => {
  it("falls back to the prod values when run from source", () => {
    expect(BUILD_TARGET).toBe("prod");
    expect(NPM_PACKAGE).toBe("@usesuperflow/mcp");
    expect(DEFAULT_ORIGIN).toBe("https://mcp.usesuperflow.ai");
    expect(CREDENTIAL_STORE_NAME).toBe("superflow-mcp");
    expect(NPX_COMMAND).toBe("npx -y @usesuperflow/mcp");
  });

  it("keeps its fallbacks equal to the prod row of scripts/lib/targets.mjs", () => {
    expect(NPM_PACKAGE).toBe(TARGETS.prod.npmPackage);
    expect(DEFAULT_ORIGIN).toBe(TARGETS.prod.origin);
    expect(CREDENTIAL_STORE_NAME).toBe(TARGETS.prod.credentialStore);
  });

  it("derives the MCP, API and sign-in URLs from the origin", () => {
    expect(DEFAULT_MCP_URL).toBe(`${DEFAULT_ORIGIN}/mcp`);
    expect(DEFAULT_BASE_URL).toBe(`${DEFAULT_ORIGIN}/v1`);
    expect(DEFAULT_AUTH_URL).toBe(DEFAULT_ORIGIN);
  });

  it("keeps the superflow-mcp/ User-Agent the backend classifies MCP traffic by", () => {
    expect(USER_AGENT).toBe(`superflow-mcp/${VERSION}`);
  });
});

describe("targets (scripts/lib/targets.mjs)", () => {
  it("publishes prod in public with provenance and staging restricted without it", () => {
    expect(TARGETS.prod).toMatchObject({ npmPackage: "@usesuperflow/mcp", access: "public", provenance: true });
    expect(TARGETS.staging).toMatchObject({
      npmPackage: "@usesuperflow/mcp-staging",
      origin: "https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app",
      credentialStore: "superflow-mcp-staging",
      access: "restricted",
      provenance: false,
    });
  });

  it("gives every target its own origin and credential store", () => {
    expect(TARGETS.staging.origin).not.toBe(TARGETS.prod.origin);
    expect(TARGETS.staging.credentialStore).not.toBe(TARGETS.prod.credentialStore);
  });

  it("resolves an empty target to prod and refuses an unknown one", () => {
    expect(resolveTarget(undefined)).toBe("prod");
    expect(resolveTarget(" ")).toBe("prod");
    expect(resolveTarget("staging")).toBe("staging");
    expect(() => resolveTarget("production")).toThrow(/Unknown target "production"/);
  });
});
