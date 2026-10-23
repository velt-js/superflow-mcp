import { describe, expect, it } from "vitest";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

describe("superflow_get_team_analytics", () => {
  const TOOL = "superflow_get_team_analytics";

  it("passes the window and summarizes a fresh rollup", async () => {
    const answer = { lookback_days: 30, is_stale: false, last_computed_date: "2026-10-22", team: { commentStats: { commentsAdded: 42, commentsResolved: 30 } } };
    on("get", "/analytics/team", ok(answer));
    const h = await connect();
    const result = await h.call(TOOL, { lookback_days: 30 });
    expect(recorded[0]?.query).toEqual({ lookback_days: "30" });
    expect(summaryOf(result)).toBe("Team analytics, last 30 days. Fresh, computed 2026-10-22. 42 comments added, 30 resolved.");
    expect(data(result)).toEqual(answer);
  });

  it("says a stale rollup is unavailable, never zero activity", async () => {
    on("get", "/analytics/team", ok({ lookback_days: 7, is_stale: true, team: { commentStats: { commentsAdded: 0 } } }));
    const h = await connect();
    const summary = summaryOf(await h.call(TOOL, {}));
    expect(summary).toContain("STALE: the numbers are not available right now");
    expect(summary).not.toContain("0 comments added");
  });

  it("refuses a window the rollup does not compute", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { lookback_days: 3 });
    expect(result.isError).toBe(true);
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/analytics/team", success: ok({ is_stale: false, team: {} }) });
});

describe("superflow_get_people_analytics", () => {
  it("reads people analytics for the window", async () => {
    on("get", "/analytics/people", ok({ lookback_days: 14, is_stale: false, people: { topResolvers: [] } }));
    const h = await connect();
    const result = await h.call("superflow_get_people_analytics", { lookback_days: 14 });
    expect(recorded[0]?.query).toEqual({ lookback_days: "14" });
    expect(summaryOf(result)).toContain("People analytics, last 14 days.");
  });
});

describe("superflow_get_all_time_analytics", () => {
  it("says when no rollup was ever computed", async () => {
    on("get", "/analytics/history", ok({ is_stale: true, history: null }));
    const h = await connect();
    expect(summaryOf(await h.call("superflow_get_all_time_analytics", {}))).toBe("No all-time analytics have been computed for this workspace yet.");
  });

  it("is available in read-only mode, like every analytics tool", async () => {
    const h = await connect({ readOnly: true });
    const { tools } = await h.client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of ["superflow_get_team_analytics", "superflow_get_people_analytics", "superflow_get_all_time_analytics"]) expect(names).toContain(name);
  });
});
