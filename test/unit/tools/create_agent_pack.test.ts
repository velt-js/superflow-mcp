import { describe, expect, it } from "vitest";
import { agentPack } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_create_agent_pack";

describe(TOOL, () => {
  it("creates a pack with its agents", async () => {
    on("post", "/agent-packs", ok(agentPack, 201));
    const h = await connect();
    const result = await h.call(TOOL, { name: "Pre-Launch", agents: ["Proofreader", "Legal footer"] });
    expect(data(result)).toEqual(agentPack);
    expect(summaryOf(result)).toBe("Created agent pack Pre-Launch (2 agents, default for runs), id pck_pre.");
    expect(recorded[0]?.body).toEqual({ name: "Pre-Launch", agents: ["Proofreader", "Legal footer"] });
  });

  it("needs at least one agent", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { name: "Empty", agents: [] })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { name: "Pre-Launch", agents: ["Proofreader"] },
    method: "post",
    path: "/agent-packs",
    success: ok(agentPack, 201),
  });
});
