import { describe, expect, it } from "vitest";
import { agentPack } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_agent_pack";

describe(TOOL, () => {
  it("adds agents to the pack", async () => {
    on("patch", "/agent-packs/:pack", ok(agentPack));
    const h = await connect();
    const result = await h.call(TOOL, { pack: "Pre-Launch", add_agents: ["Legal footer"] });
    expect(data(result)).toEqual(agentPack);
    expect(summaryOf(result)).toBe("Updated agent pack Pre-Launch (2 agents), id pck_pre.");
    expect(recorded[0]?.path).toBe("/agent-packs/Pre-Launch");
    expect(recorded[0]?.body).toEqual({ add_agents: ["Legal footer"] });
  });

  it("has no default-for-runs setting: a pack is never the default", async () => {
    on("patch", "/agent-packs/:pack", ok(agentPack));
    const h = await connect();
    const { tools } = await h.client.listTools();
    const tool = tools.find((t) => t.name === TOOL);
    expect(Object.keys(tool?.inputSchema.properties ?? {})).not.toContain("is_default_for_runs");
    // An old caller's is_default_for_runs is dropped, never sent.
    await h.call(TOOL, { pack: "Pre-Launch", remove_agents: ["Legal footer"], is_default_for_runs: true });
    expect(recorded[0]?.body).toEqual({ remove_agents: ["Legal footer"] });
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
