import { describe, expect, it } from "vitest";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const KEY = { id: "key_g1", kind: "api_key", label: "CI", client_name: null, scopes: ["comments:read"], created_at: "2026-10-20T00:00:00Z", last_used_at: null, expires_at: "2027-01-01T00:00:00Z", current: false };
const SELF = { ...KEY, id: "key_self", label: "Laptop", current: true, expires_at: null };

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

  it("without confirm only previews, and sends nothing", async () => {
    const h = await connect();
    const result: any = await h.call(TOOL, { label: "CI", scopes: ["comments:read"], expires_in_days: 90 });
    expect(recorded).toHaveLength(0);
    expect(summaryOf(result)).toContain("Nothing was created");
    expect(result.isError).toBeFalsy();
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
