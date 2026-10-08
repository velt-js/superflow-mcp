import { describe, expect, it } from "vitest";
import { schedule } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_set_schedule";

describe(TOOL, () => {
  it("creates a schedule when no schedule id is given", async () => {
    on("post", "/schedules", ok(schedule, 201));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", cron: "0 9 * * 1", timezone: "Europe/Berlin", pack: "Pre-Launch" });
    expect(data(result)).toEqual(schedule);
    expect(summaryOf(result)).toBe(
      "Created schedule sch_4d5e6f on Acme Dental: 0 9 * * 1 (Europe/Berlin), pack Pre-Launch, site scope, on, next run 2026-10-12T07:00:00Z, last run done. Each run spends AI credits.",
    );
    expect(recorded[0]?.operationId).toBe("createSchedule");
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental", cron: "0 9 * * 1", timezone: "Europe/Berlin", pack: "Pre-Launch" });
  });

  it("changes only the given fields when a schedule id is given", async () => {
    on("patch", "/schedules/:schedule", ok({ ...schedule, enabled: false }));
    const h = await connect();
    const result = await h.call(TOOL, { schedule: "sch_4d5e6f", enabled: false });
    expect(summaryOf(result)).toBe(
      "Updated schedule sch_4d5e6f on Acme Dental: 0 9 * * 1 (Europe/Berlin), pack Pre-Launch, site scope, paused, last run done.",
    );
    expect(recorded[0]?.path).toBe("/schedules/sch_4d5e6f");
    expect(recorded[0]?.body).toEqual({ enabled: false });
  });

  it("checks the input before any request", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { project: "Acme Dental" })).message).toBe("A new schedule needs project and cron.");
    expect(errorOf(await h.call(TOOL, { project: "Acme", cron: "every monday" })).message).toContain("not a five-field cron");
    expect(errorOf(await h.call(TOOL, { project: "Acme", cron: "0 9 * * 1", agents: ["Proofreader"], pack: "Pre-Launch" })).message).toBe(
      "Give agents or pack, not both.",
    );
    expect(errorOf(await h.call(TOOL, { schedule: "sch_4d5e6f" })).message).toContain("Nothing to change");
    expect(recorded).toHaveLength(0);
  });

  it("passes the one hour minimum refusal through", async () => {
    on("post", "/schedules", fail(400, { code: "invalid", message: "Schedules run at most once an hour." }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { project: "Acme", cron: "*/5 * * * *" })).message).toBe("Schedules run at most once an hour.");
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", cron: "0 9 * * 1" },
    method: "post",
    path: "/schedules",
    success: ok(schedule, 201),
  });
});
