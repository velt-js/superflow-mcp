import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_BASE_URL,
  DEFAULT_MCP_URL,
  configWarnings,
  directModeConflict,
  isDirectMode,
  loadBridgeConfig,
  loadConfig,
  resolveApiBaseUrl,
  resolveMcpUrl,
} from "../../src/config.ts";

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({ SUPERFLOW_API_KEY: "sf_pat_x" })).toEqual({
      apiKey: "sf_pat_x",
      baseUrl: DEFAULT_BASE_URL,
      readOnly: false,
      logLevel: "info",
    });
  });

  it("reads every variable", () => {
    expect(
      loadConfig({
        SUPERFLOW_API_KEY: " sf_pat_x ",
        SUPERFLOW_API_BASE_URL: "https://api.staging.example.com/v1/",
        SUPERFLOW_READ_ONLY: "TRUE",
        SUPERFLOW_LOG_LEVEL: "debug",
      }),
    ).toEqual({
      apiKey: "sf_pat_x",
      baseUrl: "https://api.staging.example.com/v1",
      readOnly: true,
      logLevel: "debug",
    });
  });

  it("offers login and names SUPERFLOW_API_KEY when there is no key", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ SUPERFLOW_API_KEY: "  " })).toThrow(/Run npx superflow-mcp login.*SUPERFLOW_API_KEY/);
  });

  it("rejects plain http except for localhost", () => {
    expect(() => loadConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_API_BASE_URL: "http://api.example.com/v1" })).toThrow(/https/);
    expect(loadConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_API_BASE_URL: "http://localhost:5001/v1" }).baseUrl).toBe(
      "http://localhost:5001/v1",
    );
  });

  it("rejects bad values with one-line messages", () => {
    expect(() => loadConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_API_BASE_URL: "not a url" })).toThrow(/not a valid URL/);
    expect(() => loadConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_READ_ONLY: "maybe" })).toThrow(/SUPERFLOW_READ_ONLY/);
    expect(() => loadConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_LOG_LEVEL: "loud" })).toThrow(/SUPERFLOW_LOG_LEVEL/);
    expect(() => loadConfig({ SUPERFLOW_API_KEY: "sf_pat_a b" })).toThrow(/whitespace/);
  });
});

describe("configWarnings", () => {
  it("warns once that SUPERFLOW_DEFAULT_PROJECT is no longer used, and loading still works", () => {
    const env = { SUPERFLOW_API_KEY: "sf_pat_x", SUPERFLOW_DEFAULT_PROJECT: "Acme Dental" };
    expect(configWarnings(env)).toEqual([
      "SUPERFLOW_DEFAULT_PROJECT is no longer used and can be removed: comments have no numbers, so give a comment by its id (cmt_...) or its link.",
    ]);
    expect(loadConfig(env).apiKey).toBe("sf_pat_x");
  });

  it("says nothing when it is unset or empty", () => {
    expect(configWarnings({ SUPERFLOW_API_KEY: "sf_pat_x" })).toEqual([]);
    expect(configWarnings({ SUPERFLOW_DEFAULT_PROJECT: "  " })).toEqual([]);
  });
});

describe("loadBridgeConfig", () => {
  it("forwards to the hosted server by default", () => {
    expect(loadBridgeConfig({ SUPERFLOW_API_KEY: "sf_pat_x" })).toEqual({
      apiKey: "sf_pat_x",
      mcpUrl: DEFAULT_MCP_URL,
      readOnly: false,
      logLevel: "info",
    });
    expect(DEFAULT_MCP_URL).toBe("https://mcp.usesuperflow.ai/mcp");
  });

  it("takes SUPERFLOW_MCP_URL (staging's run.app origin), else the server a sign-in came from", () => {
    const staging = "https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app/mcp";
    expect(loadBridgeConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_MCP_URL: `${staging}/` }).mcpUrl).toBe(staging);
    expect(loadBridgeConfig({ SUPERFLOW_API_KEY: "k" }, staging).mcpUrl).toBe(staging);
    expect(loadBridgeConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_MCP_URL: DEFAULT_MCP_URL }, staging).mcpUrl).toBe(DEFAULT_MCP_URL);
  });

  it("allows plain http only for localhost, and no query string or fragment", () => {
    expect(() => loadBridgeConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_MCP_URL: "http://mcp.example.com/mcp" })).toThrow(/SUPERFLOW_MCP_URL must use https/);
    expect(loadBridgeConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_MCP_URL: "http://127.0.0.1:8080/mcp" }).mcpUrl).toBe("http://127.0.0.1:8080/mcp");
    expect(loadBridgeConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_MCP_URL: "http://localhost:8080/mcp" }).mcpUrl).toBe("http://localhost:8080/mcp");
    expect(() => loadBridgeConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_MCP_URL: "https://mcp.example.com/mcp?x=1" })).toThrow(/query string/);
    expect(() => loadBridgeConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_MCP_URL: "not a url" })).toThrow(/SUPERFLOW_MCP_URL is not a valid URL/);
  });

  it("checks the key, read-only flag and log level before anything goes over the network", () => {
    expect(() => loadBridgeConfig({})).toThrow(/Run npx superflow-mcp login.*SUPERFLOW_API_KEY/);
    expect(() => loadBridgeConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_READ_ONLY: "maybe" })).toThrow(/SUPERFLOW_READ_ONLY/);
    expect(() => loadBridgeConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_LOG_LEVEL: "loud" })).toThrow(/SUPERFLOW_LOG_LEVEL/);
    expect(loadBridgeConfig({ SUPERFLOW_API_KEY: "k", SUPERFLOW_READ_ONLY: "true" }).readOnly).toBe(true);
  });
});

describe("isDirectMode", () => {
  it("is on only when SUPERFLOW_API_BASE_URL is set (development)", () => {
    expect(isDirectMode({ SUPERFLOW_API_KEY: "k" })).toBe(false);
    expect(isDirectMode({ SUPERFLOW_API_BASE_URL: "  " })).toBe(false);
    expect(isDirectMode({ SUPERFLOW_API_BASE_URL: "http://localhost:5001/v1" })).toBe(true);
  });
});

describe("resolveMcpUrl and resolveApiBaseUrl (what login checks before it sends a fresh token)", () => {
  it("accept https and localhost http, and refuse the rest", () => {
    expect(resolveMcpUrl({})).toBe(DEFAULT_MCP_URL);
    expect(resolveMcpUrl({}, "https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app/mcp")).toBe("https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app/mcp");
    expect(() => resolveMcpUrl({ SUPERFLOW_MCP_URL: "http://evil.example.com/mcp" })).toThrow(ConfigError);
    expect(() => resolveMcpUrl({ SUPERFLOW_MCP_URL: "https://mcp.usesuperflow.ai/mcp#x" })).toThrow(/fragment/);
    expect(resolveApiBaseUrl("http://localhost:5001/v1")).toBe("http://localhost:5001/v1");
    expect(() => resolveApiBaseUrl("http://api.example.com/v1")).toThrow(/SUPERFLOW_API_BASE_URL must use https/);
    expect(DEFAULT_BASE_URL).toBe("https://mcp.usesuperflow.ai/v1");
  });
});

describe("directModeConflict", () => {
  it("allows an API on the MCP server's origin", () => {
    expect(directModeConflict(DEFAULT_BASE_URL, DEFAULT_MCP_URL, "the default")).toBeUndefined();
    const staging = "https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app";
    expect(directModeConflict(`${staging}/v1`, `${staging}/mcp`, "from SUPERFLOW_MCP_URL")).toBeUndefined();
  });

  it("refuses an API on another origin, saying where the MCP URL came from and how to fix it", () => {
    const message = directModeConflict("https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app/v1", DEFAULT_MCP_URL, "from your saved sign-in");
    expect(message).toBe(
      "SUPERFLOW_API_BASE_URL (https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app) and the MCP server the key or sign-in is for (https://mcp.usesuperflow.ai, from your saved sign-in) are different servers, so the key could go to the wrong one. Unset SUPERFLOW_API_BASE_URL to use the hosted server, or set SUPERFLOW_MCP_URL=https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app/mcp to run the tools here against https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app.",
    );
    expect(directModeConflict("http://localhost:5001/v1", "http://localhost:5002/mcp", "the default")).toContain("different servers");
  });
});
