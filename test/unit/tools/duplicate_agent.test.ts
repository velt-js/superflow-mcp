import { describe, expect, it } from "vitest";
import { customAgentDetail } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_duplicate_agent";
const copy = {
  ...customAgentDetail,
  id: "agt_legal2",
  name: "Legal footer (EU)",
  packs: [],
  note: "Secrets in the agent's API settings were not copied.",
};

describe(TOOL, () => {
  it("copies an agent under a new name and repeats the note", async () => {
    on("post", "/agents/:agent/duplicate", ok(copy, 201));
    const h = await connect();
    const result = await h.call(TOOL, { agent: "Legal footer", name: "Legal footer (EU)" });
    expect(data(result)).toEqual(copy);
    expect(summaryOf(result)).toBe(
      "Copied Legal footer as Legal footer (EU) (agt_legal2, custom, on, in no pack). Secrets in the agent's API settings were not copied.",
    );
    expect(recorded[0]?.path).toBe("/agents/Legal%20footer/duplicate");
    expect(recorded[0]?.body).toEqual({ name: "Legal footer (EU)", idempotency_key: expect.any(String) });
  });

  it("sends only the caller's idempotency key without a name", async () => {
    on("post", "/agents/:agent/duplicate", ok({ ...copy, name: "Legal footer copy", note: null }, 201));
    const h = await connect();
    await h.call(TOOL, { agent: "agt_legal1", idempotency_key: "k-1" });
    expect(recorded[0]?.body).toEqual({ idempotency_key: "k-1" });
  });

  it("passes the built-in refusal through", async () => {
    on("post", "/agents/:agent/duplicate", fail(400, { code: "invalid", message: "Built-in agents cannot be copied." }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { agent: "Proofreader" })).message).toBe("Built-in agents cannot be copied.");
  });

  standardErrorCases({
    tool: TOOL,
    args: { agent: "Legal footer" },
    method: "post",
    path: "/agents/:agent/duplicate",
    success: ok(copy, 201),
  });
});
