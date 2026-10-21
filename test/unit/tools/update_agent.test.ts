import { describe, expect, it } from "vitest";
import { builtInAgent, customAgentDetail } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_agent";

describe(TOOL, () => {
  it("turns an agent off", async () => {
    const off = { ...builtInAgent, enabled: false };
    on("patch", "/agents/:agent", ok(off));
    const h = await connect();
    const result = await h.call(TOOL, { agent: "Proofreader", enabled: false });
    expect(data(result)).toEqual(off);
    expect(summaryOf(result)).toBe("Updated agent Proofreader (agt_proof, built-in, turned off, in pack Copy QA, in the default run set).");
    expect(recorded[0]?.body).toEqual({ enabled: false });
  });

  it("rewrites a custom agent's instructions", async () => {
    on("patch", "/agents/:agent", ok(customAgentDetail));
    const h = await connect();
    await h.call(TOOL, { agent: "agt_legal1", name: "Legal footer", instructions: "Check the footer." });
    expect(recorded[0]?.body).toEqual({ name: "Legal footer", instructions: "Check the footer." });
    expect(recorded[0]?.path).toBe("/agents/agt_legal1");
  });

  it("refuses an empty change before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { agent: "Proofreader" })).message).toContain("Nothing to change");
    expect(recorded).toHaveLength(0);
  });

  it("passes the built-in refusal through", async () => {
    on("patch", "/agents/:agent", fail(400, { code: "invalid", message: "Built-in agents can only be turned on or off." }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { agent: "Proofreader", name: "Speller" }))).toMatchObject({
      code: "invalid",
      message: "Built-in agents can only be turned on or off.",
    });
  });

  standardErrorCases({
    tool: TOOL,
    args: { agent: "Proofreader", enabled: true },
    method: "patch",
    path: "/agents/:agent",
    success: ok(builtInAgent),
  });
});
