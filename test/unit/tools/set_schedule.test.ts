import { describe, expect, it } from "vitest";
import { CONFIRM_SET_SCHEDULE_MESSAGE } from "../../../src/lib/confirm.ts";
import { agentSchedule, estimate, schedule } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_set_schedule";

describe(TOOL, () => {
  it("without confirm only prices one run and returns a preview: no schedule is created", async () => {
    on("post", "/runs/estimate", ok(estimate));
    on("post", "/schedules", ok(schedule, 201));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", cron: "0 9 * * 1", timezone: "Europe/Berlin", pack: "Pre-Launch" });
    expect(result.isError).toBeFalsy();
    expect(recorded.map((r) => r.operationId)).toEqual(["estimateRun"]);
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental", pack: "Pre-Launch" });
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { schedule: { project: "Acme Dental", cron: "0 9 * * 1", timezone: "Europe/Berlin", pack: "Pre-Launch" }, estimate },
      message: CONFIRM_SET_SCHEDULE_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      'A schedule on Acme Dental would run pack Pre-Launch at "0 9 * * 1" (Europe/Berlin), site scope, and every run spends AI credits. One run now: This run would cost 10 credits (scan pricing, medium band): 42 pages with 2 agents (Proofreader, Legal footer). Balance: 1,234 credits. Nothing was created. Ask the user to confirm.',
    );
  });

  it("reports an upstream failure of the estimate as an error, and creates nothing", async () => {
    on("post", "/runs/estimate", () => new Response("<html>down</html>", { status: 500 }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { project: "Acme Dental", cron: "0 9 * * 1" })).code).toBe("upstream");
    expect(recorded.map((r) => r.operationId)).not.toContain("createSchedule");
  });

  it("still previews, without a price, when the key may not read estimates", async () => {
    on("post", "/runs/estimate", fail(403, { code: "forbidden", message: "This key does not have the agents:read scope, which this request needs." }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", cron: "0 9 * * 1" });
    expect(data(result)).toMatchObject({ needs_confirmation: true, preview: { estimate: null } });
    expect(summaryOf(result)).toContain("One run could not be priced (This key does not have the agents:read scope");
    // The estimate is a POST that only reads; nothing else went out.
    expect(recorded.map((r) => r.operationId)).toEqual(["estimateRun"]);
  });

  it("creates a schedule with confirm when no schedule id is given", async () => {
    on("post", "/schedules", ok(schedule, 201));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", cron: "0 9 * * 1", timezone: "Europe/Berlin", pack: "Pre-Launch", confirm: true });
    expect(data(result)).toEqual(schedule);
    expect(summaryOf(result)).toBe(
      "Created schedule sch_4d5e6f on Acme Dental: 0 9 * * 1 (Europe/Berlin), pack Pre-Launch, site scope, on, next run 2026-10-12T07:00:00Z, last run started. Each run spends AI credits.",
    );
    expect(recorded[0]?.operationId).toBe("createSchedule");
    expect(recorded[0]?.body).toEqual({
      project: "Acme Dental",
      cron: "0 9 * * 1",
      timezone: "Europe/Berlin",
      pack: "Pre-Launch",
      idempotency_key: expect.any(String),
    });
  });

  it("drops a null clear on create, where there is nothing to clear", async () => {
    on("post", "/schedules", ok(schedule, 201));
    const h = await connect();
    await h.call(TOOL, { project: "Acme Dental", cron: "0 9 * * 1", pack: null, agents: ["Proofreader"], idempotency_key: "k-1", confirm: true });
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental", cron: "0 9 * * 1", agents: ["Proofreader"], idempotency_key: "k-1" });
  });

  it("clears the pack with null when switching a schedule to agents, without an idempotency key", async () => {
    on("patch", "/schedules/:schedule", ok({ ...schedule, pack: null, agents: [{ id: "agt_proof", name: "Proofreader" }] }));
    const h = await connect();
    const result = await h.call(TOOL, { schedule: "sch_4d5e6f", pack: null, agents: ["Proofreader"], confirm: true });
    expect(recorded[0]?.body).toEqual({ pack: null, agents: ["Proofreader"] });
    expect(summaryOf(result)).toContain("1 agent, site scope");
  });

  it("explains a run skipped for credits in the last run", async () => {
    on("patch", "/schedules/:schedule", ok({ ...schedule, last_run: { run_id: null, at: "2026-10-05T07:00:00Z", status: "skipped_insufficient_credits" } }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { schedule: "sch_4d5e6f", enabled: true, confirm: true }))).toContain(
      "last run skipped (not enough AI credits).",
    );
  });

  it("a change that can spend more previews the schedule as it would be, priced, and writes nothing", async () => {
    on("get", "/schedules", ok({ items: [schedule, agentSchedule], next_cursor: null }));
    on("post", "/runs/estimate", ok(estimate));
    const h = await connect();
    const result = await h.call(TOOL, { schedule: "sch_7g8h9i", cron: "0 9 * * *", scope: "list", pages: ["https://acme.com/"] });
    expect(recorded.map((r) => r.operationId)).toEqual(["listSchedules", "estimateRun"]);
    // The current agents stay; the given scope and pages win.
    expect(recorded[1]?.body).toEqual({ project: "prj_1a2b", scope: "list", pages: ["https://acme.com/"], agents: ["agt_legal1"] });
    expect(data(result)).toMatchObject({
      needs_confirmation: true,
      preview: { schedule: agentSchedule, changes: { cron: "0 9 * * *", scope: "list", pages: ["https://acme.com/"] }, estimate },
      message: CONFIRM_SET_SCHEDULE_MESSAGE,
    });
    expect(summaryOf(result)).toContain("The change (cron, scope, pages) changes what or when it runs, and every run spends AI credits.");
    // The change names no agents or pack, so saving takes them again.
    expect(summaryOf(result)).toContain("Saving takes the agents again: a pack's current members, or today's default agents when the schedule used the default set");
    expect(recorded.map((r) => r.operationId)).not.toContain("updateSchedule");
  });

  it("a pack swapped in for agents is priced with the pack alone", async () => {
    on("get", "/schedules", ok({ items: [agentSchedule], next_cursor: null }));
    on("post", "/runs/estimate", ok(estimate));
    const h = await connect();
    const result = await h.call(TOOL, { schedule: "sch_7g8h9i", pack: "Pre-Launch", agents: null });
    expect(recorded[1]?.body).toEqual({ project: "prj_1a2b", scope: "site", pack: "Pre-Launch" });
    expect(summaryOf(result)).not.toContain("Saving takes the agents again");
  });

  it("a pack schedule is priced with its pack, not with the pack's members it lists as agents", async () => {
    on("get", "/schedules", ok({ items: [schedule], next_cursor: null }));
    on("post", "/runs/estimate", ok(estimate));
    const h = await connect();
    await h.call(TOOL, { schedule: "sch_4d5e6f", cron: "0 8 * * 1" });
    expect(recorded[1]?.body).toEqual({ project: "prj_1a2b", scope: "site", pack: "pck_pre" });
    await h.call(TOOL, { schedule: "sch_4d5e6f", pack: null, cron: "0 8 * * 1" });
    // Clearing the pack falls back to the default agents, as the API plans it.
    expect(recorded[3]?.body).toEqual({ project: "prj_1a2b", scope: "site" });
  });

  it("names every way the newest run was skipped", async () => {
    for (const [status, words] of [
      ["skipped_no_changes", "last run skipped (nothing changed since the last scan)."],
      ["skipped_creator_removed", "last run skipped (its creator no longer has access)."],
      ["skipped_no_agents", "last run skipped (no agents)."],
      ["in_progress", "last run in progress."],
    ] as const) {
      on("patch", "/schedules/:schedule", ok({ ...schedule, last_run: { run_id: null, at: "2026-10-05T07:00:00Z", status } }));
      const h = await connect();
      expect(summaryOf(await h.call(TOOL, { schedule: "sch_4d5e6f", timezone: "UTC" }))).toContain(words);
    }
  });

  it("previewing a change to an unknown schedule is not_found", async () => {
    on("get", "/schedules", ok({ items: [schedule], next_cursor: null }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { schedule: "sch_missing", enabled: true })).code).toBe("not_found");
    expect(writes()).toEqual([]);
  });

  it("previewing a change to a schedule past the API's schedule scan says it may be past it", async () => {
    on("get", "/schedules", ok({ items: [schedule], next_cursor: null, scan: { scanned: 10000, complete: false } }));
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { schedule: "sch_missing", enabled: true }));
    expect(error.message).toContain("may be past what it read");
    expect(writes()).toEqual([]);
  });

  it("refuses pages without scope list, on a new schedule and on a change, before calling the API", async () => {
    const h = await connect();
    const created = errorOf(await h.call(TOOL, { project: "Acme Dental", cron: "0 9 * * 1", scope: "page", pages: ["https://acme.com/pricing"] }));
    expect(created.message).toBe("pages can only be sent with scope list. To review one page, send scope list and that one URL.");
    const changed = errorOf(await h.call(TOOL, { schedule: "sch_4d5e6f", scope: "site", pages: ["https://acme.com/pricing"] }));
    expect(changed.code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("moving the time zone needs no confirm", async () => {
    on("patch", "/schedules/:schedule", ok({ ...schedule, timezone: "UTC" }));
    const h = await connect();
    await h.call(TOOL, { schedule: "sch_4d5e6f", timezone: "UTC" });
    expect(recorded.map((r) => [r.operationId, r.body])).toEqual([["updateSchedule", { timezone: "UTC" }]]);
  });

  it("pausing needs no confirm and changes only the given fields", async () => {
    on("patch", "/schedules/:schedule", ok({ ...schedule, enabled: false }));
    const h = await connect();
    const result = await h.call(TOOL, { schedule: "sch_4d5e6f", enabled: false });
    expect(summaryOf(result)).toBe(
      "Updated schedule sch_4d5e6f on Acme Dental: 0 9 * * 1 (Europe/Berlin), pack Pre-Launch, site scope, paused, last run started.",
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
    expect(errorOf(await h.call(TOOL, { project: "Acme", cron: "*/5 * * * *", confirm: true })).message).toBe("Schedules run at most once an hour.");
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", cron: "0 9 * * 1", confirm: true },
    method: "post",
    path: "/schedules",
    success: ok(schedule, 201),
  });
});
