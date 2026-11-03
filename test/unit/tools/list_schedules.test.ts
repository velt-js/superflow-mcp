import { describe, expect, it } from "vitest";
import { agentSchedule, list, schedule } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_schedules";

describe(TOOL, () => {
  it("lists schedules with when they run, what they run and how the last run went", async () => {
    on("get", "/schedules", ok(list([schedule, agentSchedule])));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(data(result)).toEqual(list([schedule, agentSchedule]));
    expect(summaryOf(result)).toBe(
      "Found 2 schedules on Acme Dental. sch_4d5e6f on Acme Dental: 0 9 * * 1 (Europe/Berlin), pack Pre-Launch, site scope, on, next run 2026-10-12T07:00:00Z, last run started. sch_7g8h9i on Acme Dental: 0 9 * * 1 (Europe/Berlin), 1 agent, site scope, on, next run 2026-10-12T07:00:00Z, last run started. Agents: Legal footer.",
    );
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental" });
  });

  it("says a schedule left with no agents is turned off, not on the default agents", async () => {
    on("get", "/schedules", ok(list([{ ...agentSchedule, agents: [], enabled: false }])));
    const h = await connect();
    const summary = summaryOf(await h.call(TOOL));
    expect(summary).toContain("sch_7g8h9i on Acme Dental: 0 9 * * 1 (Europe/Berlin), no agents (turned off), site scope, paused");
    expect(summary).not.toContain("default agents");
  });

  it("says when the schedule scan stopped early, so some schedules may be missing", async () => {
    on("get", "/schedules", ok(list([schedule], { scan: { scanned: 10000, complete: false } })));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL))).toContain(
      "Found 1 schedule. The schedule scan stopped after 10,000 definitions, so some schedules may not be listed.",
    );
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/schedules", success: ok(list([schedule])) });
});
