import { describe, expect, it } from "vitest";
import { CONFIRM_REMOVE_PAGE_MESSAGE } from "../../../src/lib/confirm.ts";
import { page } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_remove_page";
const removed = { removed: true, id: "pg_9z", comments_deleted: 9 };

describe(TOOL, () => {
  it("without confirm, only reads the page and returns a preview", async () => {
    on("get", "/projects/:project/pages/:page", ok(page));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", page: "https://acme.com/pricing" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { page, comment_count: 9 },
      message: CONFIRM_REMOVE_PAGE_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Page https://acme.com/pricing in Acme Dental would be removed and its 9 comments deleted for good: they cannot be restored. Nothing was removed. Ask the user to confirm.",
    );
    expect(CONFIRM_REMOVE_PAGE_MESSAGE).toContain("cannot be restored");
    expect(recorded.map((r) => r.operationId)).toEqual(["getPage"]);
    expect(writes()).toEqual([]);
  });

  it("refuses up front when the page has more than 200 comments", async () => {
    on("get", "/projects/:project/pages/:page", ok({ ...page, total_comment_count: 250 }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", page: "/pricing" });
    const error = errorOf(result);
    expect(error.code).toBe("invalid");
    expect(error.message).toContain("has 250 comments");
    expect(writes()).toEqual([]);
  });

  it("removes with confirm: true and says the comments are gone for good", async () => {
    on("delete", "/projects/:project/pages/:page", ok(removed));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", page: "/pricing", confirm: true });
    expect(data(result)).toEqual(removed);
    expect(summaryOf(result)).toBe(
      "Removed page pg_9z from Acme Dental and deleted 9 comments for good.",
    );
    expect(recorded.map((r) => [r.method, r.query])).toEqual([["DELETE", { confirm: "true" }]]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", page: "/pricing", confirm: true },
    method: "delete",
    path: "/projects/:project/pages/:page",
    success: ok(removed),
  });
});
