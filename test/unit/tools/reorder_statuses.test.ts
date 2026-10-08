import { describe, expect, it } from "vitest";
import { list, projectStatuses } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, seen, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_reorder_statuses";
const ids = ["sts_OPEN", "sts_IN_REVIEW", "sts_RESOLVED"];
const ordered = { ...list(projectStatuses, { applied_filters: {} }), custom_statuses_enabled: true, hint: null };

describe(TOOL, () => {
  it("sends the full order with PUT and reports the new order", async () => {
    on("put", "/statuses/order", ok(ordered));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", status_ids: ids });
    expect(data(result)).toEqual(ordered);
    expect(summaryOf(result)).toBe("New status order in project Acme Dental: Open, In review, Resolved.");
    expect(recorded[0]?.method).toBe("PUT");
    expect(recorded[0]?.operationId).toBe("reorderStatuses");
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental" });
    expect(recorded[0]?.body).toEqual({ status_ids: ids });
  });

  it("adds the custom statuses note when the switch is off", async () => {
    on("put", "/statuses/order", ok({ ...ordered, custom_statuses_enabled: false, hint: "Turn them on in Superflow under Settings > Advanced features." }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { status_ids: ids }))).toBe(
      "New status order in the workspace: Open, In review, Resolved. Custom statuses are turned off for this workspace, so the toolbar does not show them yet. Turn them on in Superflow under Settings > Advanced features.",
    );
  });

  it("refuses a status listed twice", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { status_ids: ["sts_OPEN", "Open", "sts_open"] })).code).toBe("invalid");
    expect(seen).toEqual([]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { status_ids: ids },
    method: "put",
    path: "/statuses/order",
    success: ok(ordered),
  });
});
