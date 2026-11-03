import { describe, expect, it } from "vitest";
import { agentPack } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_agent_pack";

describe(TOOL, () => {
  it("adds agents and makes the pack the default for runs", async () => {
    on("patch", "/agent-packs/:pack", ok(agentPack));
    const h = await connect();
    const result = await h.call(TOOL, { pack: "Pre-Launch", add_agents: ["Legal footer"], is_default_for_runs: true });
    expect(data(result)).toEqual(agentPack);
    expect(summaryOf(result)).toBe("Updated agent pack Pre-Launch (2 agents, default for runs), id pck_pre.");
    expect(recorded[0]?.path).toBe("/agent-packs/Pre-Launch");
    expect(recorded[0]?.body).toEqual({ add_agents: ["Legal footer"], is_default_for_runs: true });
  });

  it("refuses an empty change before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { pack: "Pre-Launch" })).message).toContain("Nothing to change");
    expect(recorded).toHaveLength(0);
  });

  it("passes a system pack rename refusal through", async () => {
    on("patch", "/agent-packs/:pack", fail(400, { code: "invalid", message: "System packs keep their name." }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { pack: "Copy QA", name: "Copy" })).message).toBe("System packs keep their name.");
  });

  standardErrorCases({
    tool: TOOL,
    args: { pack: "Pre-Launch", remove_agents: ["Legal footer"] },
    method: "patch",
    path: "/agent-packs/:pack",
    success: ok(agentPack),
  });
});
