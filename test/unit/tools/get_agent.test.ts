import { describe, expect, it } from "vitest";
import { builtInAgent, customAgentDetail } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_agent";

describe(TOOL, () => {
  it("returns a custom agent with its instructions", async () => {
    on("get", "/agents/:agent", ok(customAgentDetail));
    const h = await connect();
    const result = await h.call(TOOL, { agent: "Legal footer" });
    expect(data(result)).toEqual(customAgentDetail);
    expect(summaryOf(result)).toBe("Agent Legal footer (agt_legal1, custom, on, in pack Pre-Launch).");
    expect(recorded[0]?.path).toBe("/agents/Legal%20footer");
  });

  it("says when a built-in agent is in the default run set", async () => {
    on("get", "/agents/:agent", ok({ ...builtInAgent, instructions: null }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { agent: "agt_proof" }))).toBe(
      "Agent Proofreader (agt_proof, built-in, on, in pack Copy QA, in the default run set).",
    );
  });

  standardErrorCases({ tool: TOOL, args: { agent: "Proofreader" }, method: "get", path: "/agents/:agent", success: ok(builtInAgent) });
});
