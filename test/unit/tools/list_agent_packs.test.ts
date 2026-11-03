import { describe, expect, it } from "vitest";
import { agentPack, list, systemPack } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_agent_packs";

describe(TOOL, () => {
  it("lists packs with their agent counts, system packs and the default for runs", async () => {
    on("get", "/agent-packs", ok(list([agentPack, systemPack])));
    const h = await connect();
    const result = await h.call(TOOL);
    expect(data(result)).toEqual(list([agentPack, systemPack]));
    expect(summaryOf(result)).toBe("Found 2 agent packs: Pre-Launch (2 agents, default for runs), Copy QA (1 agent, system).");
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/agent-packs", success: ok(list([agentPack])) });
});
