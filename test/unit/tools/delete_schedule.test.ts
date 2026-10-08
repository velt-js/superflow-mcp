import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_SCHEDULE_MESSAGE } from "../../../src/lib/confirm.ts";
import { list, schedule } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_schedule";

describe(TOOL, () => {
  it("without confirm, reads the schedules and returns the schedule as a preview", async () => {
    on("get", "/schedules", ok(list([schedule])));
    on("delete", "/schedules/:schedule", ok({ deleted: true, id: "sch_4d5e6f" }));
    const h = await connect();
    const result = await h.call(TOOL, { schedule: "4d5e6f" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({ needs_confirmation: true, preview: schedule, message: CONFIRM_DELETE_SCHEDULE_MESSAGE });
    expect(summaryOf(result)).toBe(
      "Schedule sch_4d5e6f on Acme Dental: 0 9 * * 1 (Europe/Berlin), pack Pre-Launch, site scope, on, next run 2026-10-12T07:00:00Z, last run done. It would be deleted. Nothing was deleted. Ask the user to confirm.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["listSchedules"]);
    expect(writes()).toEqual([]);
  });

  it("returns not_found for an unknown schedule and sends no write", async () => {
    on("get", "/schedules", ok(list([schedule])));
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { schedule: "sch_nope" }));
    expect(error.code).toBe("not_found");
    expect(error.hint).toContain("superflow_list_schedules");
    expect(writes()).toEqual([]);
  });

  it("deletes with confirm: true", async () => {
    on("delete", "/schedules/:schedule", ok({ deleted: true, id: "sch_4d5e6f" }));
    const h = await connect();
    const result = await h.call(TOOL, { schedule: "sch_4d5e6f", confirm: true });
    expect(summaryOf(result)).toBe("Deleted schedule sch_4d5e6f. No more runs start from it.");
    expect(recorded.map((r) => [r.method, r.path])).toEqual([["DELETE", "/schedules/sch_4d5e6f"]]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { schedule: "sch_4d5e6f", confirm: true },
    method: "delete",
    path: "/schedules/:schedule",
    success: ok({ deleted: true, id: "sch_4d5e6f" }),
  });
});
