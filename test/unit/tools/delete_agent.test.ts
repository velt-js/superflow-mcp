import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_AGENT_MESSAGE } from "../../../src/lib/confirm.ts";
import { agentSchedule, builtInAgent, customAgentDetail, list, schedule } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_agent";

describe(TOOL, () => {
  it("without confirm, reads the agent and the schedules and returns a preview", async () => {
    // A schedule that names the agent next to another agent keeps running without it.
    const shared = {
      ...agentSchedule,
      id: "sch_shared",
      agents: [
        { id: "agt_legal1", name: "Legal footer" },
        { id: "agt_proof", name: "Proofreader" },
      ],
    };
    on("get", "/agents/:agent", ok(customAgentDetail));
    on("get", "/schedules", ok(list([schedule, agentSchedule, shared])));
    on("delete", "/agents/:agent", ok({ deleted: true, id: "agt_legal1" }));
    const h = await connect();
    const result = await h.call(TOOL, { agent: "Legal footer" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { agent: customAgentDetail, packs: customAgentDetail.packs, schedules_using: [agentSchedule, shared] },
      message: CONFIRM_DELETE_AGENT_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Agent Legal footer (agt_legal1) would be deleted for good. It is in 1 pack: Pre-Launch. 2 schedules name it; 1 would have no agents left and would be turned off. Nothing was deleted. Ask the user to confirm.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["getAgent", "listSchedules"]);
    expect(writes()).toEqual([]);
  });

  it("refuses to preview deleting a built-in agent and sends no write", async () => {
    on("get", "/agents/:agent", ok(builtInAgent));
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { agent: "Proofreader" }));
    expect(error.code).toBe("invalid");
    expect(error.message).toBe("Proofreader is a built-in agent. Built-in agents cannot be deleted.");
    expect(error.hint).toContain("enabled: false");
    expect(writes()).toEqual([]);
  });

  it("deletes with confirm: true and reports the schedules it changed", async () => {
    on("delete", "/agents/:agent", ok({ deleted: true, id: "agt_legal1", schedules_updated: 2 }));
    const h = await connect();
    const result = await h.call(TOOL, { agent: "Legal footer", confirm: true });
    expect(summaryOf(result)).toBe(
      "Deleted agent Legal footer (agt_legal1). Took it out of 2 schedules; a schedule left with no agents is turned off.",
    );
    expect(recorded.map((r) => [r.method, r.query])).toEqual([["DELETE", { confirm: "true" }]]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { agent: "Legal footer", confirm: true },
    method: "delete",
    path: "/agents/:agent",
    success: ok({ deleted: true, id: "agt_legal1", schedules_updated: 0 }),
  });
});
