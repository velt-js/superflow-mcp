import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_STATUS_MESSAGE } from "../../../src/lib/confirm.ts";
import { customStatus, list, projectStatuses, statuses } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_status";
const args = { status: "In review", move_comments_to: "Open", project: "Acme Dental" };
const stats = { rows: [{ key: "sts_IN_REVIEW", label: "In review", count: 12 }], total: 12, scan: { scanned: 300, complete: true } };

describe(TOOL, () => {
  it("without confirm, reads the statuses and the count and returns a preview", async () => {
    on("get", "/projects/:project/statuses", ok(list(projectStatuses)));
    on("get", "/comments/stats", ok(stats));
    const h = await connect();
    const result = await h.call(TOOL, args);
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { status: customStatus, move_comments_to: statuses[0], comment_count: 12 },
      message: CONFIRM_DELETE_STATUS_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Status In review would be deleted from project Acme Dental and its 12 comments moved to Open. Nothing was deleted. Ask the user to confirm.",
    );
    expect(recorded.find((r) => r.operationId === "getCommentStats")?.query).toEqual({
      project: "Acme Dental",
      status: "sts_IN_REVIEW",
      group_by: "status",
    });
    expect(writes()).toEqual([]);
  });

  it("still previews when the count fails, and marks an incomplete count", async () => {
    on("get", "/statuses", ok(list(projectStatuses)));
    on("get", "/comments/stats", fail(400, { code: "invalid", message: "Too broad." }));
    const h = await connect();
    const failed = await h.call(TOOL, { status: "sts_IN_REVIEW", move_comments_to: "sts_OPEN" });
    expect(summaryOf(failed)).toContain("and its comments (the count is not available) moved to Open.");
    expect((data(failed).preview as { comment_count: unknown }).comment_count).toBeNull();

    on("get", "/comments/stats", ok({ ...stats, scan: { scanned: 5000, complete: false } }));
    const partial = await h.call(TOOL, { status: "sts_IN_REVIEW", move_comments_to: "sts_OPEN" });
    expect(summaryOf(partial)).toContain("its at least 12 comments moved to Open");
    expect((data(partial).preview as { comment_count_is_minimum?: boolean }).comment_count_is_minimum).toBe(true);
    expect(writes()).toEqual([]);
  });

  it("refuses the default or resolved status, and the same target, without writing", async () => {
    on("get", "/projects/:project/statuses", ok(list(projectStatuses)));
    const h = await connect();
    const fixed = errorOf(await h.call(TOOL, { ...args, status: "Resolved" }));
    expect(fixed.code).toBe("invalid");
    expect(fixed.message).toContain("cannot be deleted");
    expect(errorOf(await h.call(TOOL, { ...args, move_comments_to: "sts_IN_REVIEW" })).code).toBe("invalid");
    expect(writes()).toEqual([]);
  });

  it("returns not_found with the status names when a status is unknown", async () => {
    on("get", "/projects/:project/statuses", ok(list(projectStatuses)));
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { ...args, move_comments_to: "Done" }));
    expect(error.code).toBe("not_found");
    expect(error.hint).toBe("The statuses are: Open, In review, Resolved.");
    expect(writes()).toEqual([]);
  });

  it("deletes with confirm: true, sending the target status", async () => {
    on("delete", "/statuses/:status", ok({ deleted: true, id: "sts_IN_REVIEW", comments_moved: 12 }));
    const h = await connect();
    const result = await h.call(TOOL, { ...args, confirm: true });
    expect(summaryOf(result)).toBe(
      "Deleted status In review (sts_IN_REVIEW) from project Acme Dental. Moved 12 comments to Open.",
    );
    expect(recorded.map((r) => [r.method, r.query])).toEqual([["DELETE", { project: "Acme Dental", move_comments_to: "Open" }]]);
  });

  it("needs move_comments_to", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { status: "In review", confirm: true })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { ...args, confirm: true },
    method: "delete",
    path: "/statuses/:status",
    success: ok({ deleted: true, id: "sts_IN_REVIEW", comments_moved: 0 }),
  });
});
