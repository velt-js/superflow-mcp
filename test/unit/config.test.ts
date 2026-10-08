import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_BASE_URL, loadConfig } from "../../src/config.ts";

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({ SUPERFLOW_API_KEY: "sf_pat_x" })).toEqual({
      apiKey: "sf_pat_x",
      baseUrl: DEFAULT_BASE_URL,
      defaultProject: undefined,
      readOnly: false,
      logLevel: "info",
    });
  });

  it("reads every variable", () => {
    expect(
      loadConfig({
        SUPERFLOW_API_KEY: " sf_pat_x ",
        SUPERFLOW_API_BASE_URL: "https://api.staging.example.com/v1/",
        SUPERFLOW_DEFAULT_PROJECT: "Acme Dental",
        SUPERFLOW_READ_ONLY: "TRUE",
        SUPERFLOW_LOG_LEVEL: "debug",
      }),
    ).toEqual({
      apiKey: "sf_pat_x",
      baseUrl: "https://api.staging.example.com/v1",
      defaultProject: "Acme Dental",
      readOnly: true,
      logLevel: "debug",
    });
  });

  it("names SUPERFLOW_API_KEY when it is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ SUPERFLOW_API_KEY: "  " })).toThrow(/SUPERFLOW_API_KEY is not set/);
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
