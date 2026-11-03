import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_BASE_URL, DEFAULT_MCP_URL, configWarnings, isDirectMode, loadBridgeConfig, loadConfig } from "../../src/config.ts";

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
