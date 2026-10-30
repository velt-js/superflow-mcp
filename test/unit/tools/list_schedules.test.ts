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
      "Found 2 schedules on Acme Dental. sch_4d5e6f on Acme Dental: 0 9 * * 1 (Europe/Berlin), pack Pre-Launch, site scope, on, next run 2026-10-12T07:00:00Z, last run done. sch_7g8h9i on Acme Dental: 0 9 * * 1 (Europe/Berlin), 1 agent, site scope, on, next run 2026-10-12T07:00:00Z, last run done. Agents: Legal footer.",
    );
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental" });
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/schedules", success: ok(list([schedule])) });
});
