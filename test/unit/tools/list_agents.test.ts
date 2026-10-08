import { describe, expect, it } from "vitest";
import { builtInAgent, customAgent, list } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_agents";

describe(TOOL, () => {
  it("lists agents with their kinds, the turned-off count and the default run set", async () => {
    const off = { ...customAgent, id: "agt_off", name: "Old SEO", enabled: false, packs: [] };
    on("get", "/agents", ok(list([builtInAgent, customAgent, off])));
    const h = await connect();
    const result = await h.call(TOOL);
    expect(data(result)).toEqual(list([builtInAgent, customAgent, off]));
    expect(summaryOf(result)).toBe("Found 3 agents: 1 built-in, 2 custom, 1 turned off. In the default run set: Proofreader.");
    expect(recorded[0]?.url.search).toBe("");
  });

  it("filters by kind and name on this side, without query parameters", async () => {
    on("get", "/agents", ok(list([builtInAgent, customAgent])));
    const h = await connect();
    const result = await h.call(TOOL, { kind: "custom", query: "LEGAL" });
    expect(data(result)).toEqual({ ...list([customAgent]), filtered_from: 2 });
    expect(summaryOf(result)).toBe("Found 1 agent (of 2): 0 built-in, 1 custom.");
    expect(recorded[0]?.url.search).toBe("");
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/agents", success: ok(list([builtInAgent])) });
});
