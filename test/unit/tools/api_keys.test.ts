import { describe, expect, it } from "vitest";
import { me } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const KEY = { id: "key_g1", kind: "api_key", label: "CI", client_name: null, scopes: ["comments:read"], created_at: "2026-10-20T00:00:00Z", last_used_at: null, expires_at: "2027-01-01T00:00:00Z", current: false };
const SELF = { ...KEY, id: "key_self", label: "Laptop", current: true, expires_at: null };
const DAY = 24 * 60 * 60 * 1000;
/** The calling key, as GET /me reports it: a personal key that may create keys and never expires. */
const ME = { ...me, scopes: ["workspace:read", "workspace:write", "comments:read", "projects:read"] };
/** The calling key expires in 29 and a half days: 29 whole days left. */
const expiringMe = () => ({ ...ME, key: { ...ME.key, expires_at: new Date(Date.now() + 29.5 * DAY).toISOString() } });

describe("superflow_list_api_keys", () => {
  it("lists the caller's keys and marks the current one", async () => {
    on("get", "/api-keys", ok({ items: [SELF, KEY], next_cursor: null, total: 2, applied_filters: {} }));
    const h = await connect();
    const result = await h.call("superflow_list_api_keys", {});
    expect(summaryOf(result)).toBe('2 keys: key_self "Laptop" (this key); key_g1 "CI", expires 2027-01-01.');
  });

  standardErrorCases({ tool: "superflow_list_api_keys", args: {}, method: "get", path: "/api-keys", success: ok({ items: [], next_cursor: null, applied_filters: {} }) });
});

describe("superflow_create_api_key", () => {
  const TOOL = "superflow_create_api_key";

  it("without confirm reads the calling key, previews, and writes nothing", async () => {
    on("get", "/me", ok(ME));
    const h = await connect();
    const result: any = await h.call(TOOL, { label: "CI", scopes: ["comments:read"], expires_in_days: 90 });
    expect(recorded.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /me"]);
    expect(writes()).toEqual([]);
    expect(result.isError).toBeFalsy();
    expect(summaryOf(result)).toMatch(/^A key "CI" with comments:read, expiring in 90 days \(\d{4}-\d{2}-\d{2}\) would be created\. Nothing was created\./);
    expect(data(result)).toMatchObject({ needs_confirmation: true, preview: { label: "CI", scopes: ["comments:read"], expires_in_days: 90 } });
  });

  it("previews a key with no expiry when the calling key never expires", async () => {
    on("get", "/me", ok(ME));
    const h = await connect();
    const result: any = await h.call(TOOL, { label: "CI", scopes: ["comments:read", "projects:read"] });
    expect(result.isError).toBeFalsy();
    expect(summaryOf(result)).toContain('A key "CI" with comments:read, projects:read, with no expiry would be created.');
  });

  it("previews when the calling key expires and the new key ends before it", async () => {
    on("get", "/me", ok(expiringMe()));
    const h = await connect();
    const result: any = await h.call(TOOL, { label: "CI", scopes: ["comments:read"], expires_in_days: 29 });
    expect(result.isError).toBeFalsy();
    expect(summaryOf(result)).toContain("expiring in 29 days");
  });

  it("refuses a sign-in before asking: sign-ins cannot create keys", async () => {
    on("get", "/me", ok({ ...ME, key: { ...ME.key, kind: "oauth", label: null } }));
    const h = await connect();
    const result = await h.call(TOOL, { label: "CI", scopes: ["comments:read"], expires_in_days: 90 });
    const error = errorOf(result);
    expect(error.code).toBe("forbidden");
    expect(error.message).toBe("This session uses a sign-in, not an API key, and a sign-in cannot create API keys: the key would outlive the sign-in.");
    expect(error.hint).toBe("Create the key in Superflow under Settings > Integrations > API keys, or use a personal API key (sf_pat_) that has workspace:write.");
    expect((result.structuredContent as { needs_confirmation?: boolean }).needs_confirmation).toBeUndefined();
    expect(writes()).toEqual([]);
  });

  it("refuses a key without workspace:write before asking", async () => {
    on("get", "/me", ok({ ...expiringMe(), scopes: ["comments:read", "projects:read"] }));
    const h = await connect();
    const result = await h.call(TOOL, { label: "CI", scopes: ["comments:read"] });
    const error = errorOf(result);
    expect(error.code).toBe("forbidden");
    expect(error.message).toBe("This key does not have the workspace:write scope, which creating an API key needs.");
    expect(error.hint).toContain("Settings > Integrations > API keys");
    expect(summaryOf(result)).not.toContain("would be created");
    expect(writes()).toEqual([]);
  });

  it("refuses scopes the calling key does not have, and lists the ones it has", async () => {
    on("get", "/me", ok(ME));
    const h = await connect();
    const result = await h.call(TOOL, { label: "CI", scopes: ["comments:read", "comments:write", "agents:run"], expires_in_days: 90 });
    const error = errorOf(result);
    expect(error.code).toBe("forbidden");
    expect(error.message).toBe("This key cannot create a key with comments:write, agents:run: it does not have those scopes itself.");
    expect(error.hint).toBe(
      "A new key can only have scopes this key has: workspace:read, workspace:write, comments:read, projects:read. Leave the others out, or create the key in Superflow under Settings > Integrations > API keys.",
    );
    expect(writes()).toEqual([]);
  });

  it("refuses no expiry when the calling key expires", async () => {
    on("get", "/me", ok(expiringMe()));
    const h = await connect();
    const result = await h.call(TOOL, { label: "CI", scopes: ["comments:read"] });
    const error = errorOf(result);
    expect(error.code).toBe("invalid");
    expect(error.message).toMatch(/^A new key cannot outlive the key that creates it\. This key expires on \d{4}-\d{2}-\d{2} \(29 days left\), so the new key needs an expiry too\.$/);
    expect(error.hint).toBe("Pass expires_in_days of at most 29. For a key that lasts longer, create it in Superflow under Settings > Integrations > API keys.");
    expect(writes()).toEqual([]);
  });

  it("refuses an expiry past the calling key's", async () => {
    on("get", "/me", ok(expiringMe()));
    const h = await connect();
    const result = await h.call(TOOL, { label: "CI", scopes: ["comments:read"], expires_in_days: 90 });
    const error = errorOf(result);
    expect(error.code).toBe("invalid");
    expect(error.message).toContain("(29 days left), so 90 days is too long.");
    expect(error.hint).toContain("at most 29");
    expect(writes()).toEqual([]);
  });

  it("refuses any key when the calling key has less than a day left", async () => {
    on("get", "/me", ok({ ...ME, key: { ...ME.key, expires_at: new Date(Date.now() + DAY / 2).toISOString() } }));
    const h = await connect();
    const result = await h.call(TOOL, { label: "CI", scopes: ["comments:read"], expires_in_days: 1 });
    const error = errorOf(result);
    expect(error.code).toBe("invalid");
    expect(error.message).toContain("in less than a day");
    expect(writes()).toEqual([]);
  });

  it("surfaces a failed read of the calling key and asks nothing", async () => {
    on("get", "/me", fail(500, { code: "upstream", message: "The Superflow API had a problem." }));
    const h = await connect();
    const result = await h.call(TOOL, { label: "CI", scopes: ["comments:read"], expires_in_days: 90 });
    expect(errorOf(result).code).toBe("upstream");
    expect(writes()).toEqual([]);
  });

  it("with confirm creates the key and shows the token once", async () => {
    on("post", "/api-keys", ok({ key: KEY, token: "sf_pat_secret", note: "shown once" }, 201));
    const h = await connect();
    const result = await h.call(TOOL, { label: "CI", scopes: ["comments:read"], expires_in_days: 90, confirm: true });
    expect(recorded[0]?.body).toEqual({ label: "CI", scopes: ["comments:read"], expires_in_days: 90 });
    expect(summaryOf(result)).toContain("sf_pat_secret");
    expect(summaryOf(result)).toContain("only time the token is shown");
    expect(data(result)).toMatchObject({ token: "sf_pat_secret" });
  });

  it("is not registered in read-only mode", async () => {
    const h = await connect({ readOnly: true });
    const { tools } = await h.client.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain(TOOL);
  });

  standardErrorCases({ tool: TOOL, args: { label: "CI", scopes: ["comments:read"], confirm: true }, method: "post", path: "/api-keys", success: ok({ key: KEY, token: "t", note: "" }, 201) });
});

describe("superflow_revoke_api_key", () => {
  const TOOL = "superflow_revoke_api_key";

  it("without confirm reads the list and previews the key", async () => {
    on("get", "/api-keys", ok({ items: [KEY], next_cursor: null, applied_filters: {} }));
    const h = await connect();
    const result = await h.call(TOOL, { key: "key_g1" });
    expect(recorded.map((r) => r.method)).toEqual(["GET"]);
    expect(summaryOf(result)).toContain("would be revoked");
  });

  it("says when the key to revoke is not there", async () => {
    on("get", "/api-keys", ok({ items: [], next_cursor: null, applied_filters: {} }));
    const h = await connect();
    const result: any = await h.call(TOOL, { key: "key_nope" });
    expect(result.isError).toBe(true);
  });

  it("with confirm revokes and warns when it was this session's key", async () => {
    on("delete", "/api-keys/key_self", ok({ revoked: true, id: "key_self", current: true }));
    const h = await connect();
    const result = await h.call(TOOL, { key: "key_self", confirm: true });
    expect(summaryOf(result)).toContain("the key this session uses");
  });
});
