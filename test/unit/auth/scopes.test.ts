import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loginHelp } from "../../../src/auth/login.ts";
import { ALL_SCOPES, DEFAULT_LOGIN_SCOPES, OPT_IN_SCOPES, normalizeScopes } from "../../../src/auth/scopes.ts";

const openapi = JSON.parse(readFileSync(new URL("../../../openapi/openapi.json", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, { operationId?: string; "x-required-scope"?: string | null }>>;
};
const required = new Set(
  Object.values(openapi.paths)
    .flatMap((methods) => Object.values(methods))
    .map((operation) => operation?.["x-required-scope"])
    .filter((scope): scope is string => typeof scope === "string"),
);

describe("login scopes", () => {
  it("knows the API's 16 scopes, and splits them into the default and the opt-in ones", () => {
    expect(ALL_SCOPES).toHaveLength(16);
    expect([...DEFAULT_LOGIN_SCOPES, ...OPT_IN_SCOPES].sort()).toEqual([...ALL_SCOPES].sort());
    expect(DEFAULT_LOGIN_SCOPES.filter((scope) => OPT_IN_SCOPES.includes(scope))).toEqual([]);
  });

  it("covers every scope an API operation requires, so a tool's scope is never an unknown name", () => {
    for (const scope of required) expect(ALL_SCOPES, scope).toContain(scope);
  });

  it("asks for comment writes and everything else the tools need, but not invites, removals or new keys", () => {
    for (const scope of ["comments:read", "comments:write", "projects:write", "agents:run", "integrations:write", "ingest"]) {
      expect(DEFAULT_LOGIN_SCOPES, scope).toContain(scope);
    }
    expect([...OPT_IN_SCOPES].sort()).toEqual(["users:invite", "users:read", "users:write", "workspace:write"]);
    // Every default scope backs at least one operation: none is asked for without a use.
    for (const scope of DEFAULT_LOGIN_SCOPES) expect(required.has(scope), scope).toBe(true);
  });

  it("normalizes --scope: spaces or commas, repeats dropped, unknown names reported", () => {
    expect(normalizeScopes(" comments:read,comments:write  comments:read ")).toEqual({ scope: "comments:read comments:write", unknown: [] });
    expect(normalizeScopes("comments:raed projects:read")).toEqual({ scope: "comments:raed projects:read", unknown: ["comments:raed"] });
    expect(normalizeScopes(" , ")).toEqual({ scope: "", unknown: [] });
  });

  it("login --help explains --scope and lists the default and the opt-in scopes", () => {
    const help = loginHelp();
    expect(help).toContain("--scope");
    expect(help).toContain(`Default: ${DEFAULT_LOGIN_SCOPES.join(" ")}`);
    for (const scope of OPT_IN_SCOPES) expect(help).toContain(scope);
    expect(help).toContain("cannot be changed later");
  });
});
