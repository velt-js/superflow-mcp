import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_COMMENT_MESSAGE } from "../../../src/lib/confirm.ts";
import { compactComment, fullComment } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_comment";

describe(TOOL, () => {
  it("without confirm, only reads the comment and returns a compact preview that says it is permanent", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", project: "Acme Dental" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: compactComment,
      message: CONFIRM_DELETE_COMMENT_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Comment cmt_8f3k2 in Acme Dental would be deleted for good, with its replies: it cannot be restored. Nothing was deleted. Ask the user to confirm. Link: https://acme.com/pricing?scommentId=8f3k2",
    );
    expect(CONFIRM_DELETE_COMMENT_MESSAGE).toContain("cannot be restored");
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental", include_replies: "false" });
    expect(writes()).toEqual([]);
  });

  it("confirm: false is the same as no confirm", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect();
    await h.call(TOOL, { comment: "cmt_8f3k2", confirm: false });
    expect(writes()).toEqual([]);
  });

  it("deletes with confirm: true and says it is gone for good", async () => {
    const body = { deleted: true, id: "cmt_8f3k2" };
    on("delete", "/comments/:comment", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", confirm: true });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe("Deleted comment cmt_8f3k2 and its replies for good. It cannot be restored.");
    expect(recorded[0]?.method).toBe("DELETE");
    expect(recorded[0]?.query).toEqual({});
  });

  it("passes the project through on the delete", async () => {
    on("delete", "/comments/:comment", ok({ deleted: true, id: "cmt_8f3k2" }));
    const h = await connect();
    await h.call(TOOL, { comment: "cmt_8f3k2", project: "Acme Dental", confirm: true });
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental" });
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "cmt_nope", project: "Acme", confirm: true },
    method: "delete",
    path: "/comments/:comment",
    success: ok({ deleted: true, id: "cmt_8f3k2" }),
  });
});
