import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_COMMENT_MESSAGE } from "../../../src/lib/confirm.ts";
import { compactComment, fullComment, unnumberedComment } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_comment";

describe(TOOL, () => {
  it("without confirm, only reads the comment and returns a compact preview", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "4821", project: "Acme Dental" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: compactComment,
      message: CONFIRM_DELETE_COMMENT_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Comment #4821 in Acme Dental would be deleted. Nothing was deleted. Ask the user to confirm. Link: https://acme.com/pricing?scommentId=8f3k2",
    );
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental", include_replies: "false" });
    expect(writes()).toEqual([]);
  });

  it("confirm: false is the same as no confirm", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect();
    await h.call(TOOL, { comment: "cmt_8f3k2", confirm: false });
    expect(writes()).toEqual([]);
  });

  it("deletes with confirm: true and says until when it can be restored", async () => {
    const body = { deleted: true, id: "cmt_8f3k2", number: 4821, restore_until: "2026-11-07T00:00:00Z" };
    on("delete", "/comments/:comment", ok(body));
    const h = await connect({ defaultProject: "Acme Dental" });
    const result = await h.call(TOOL, { comment: "#4821", confirm: true });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe(
      "Deleted comment #4821. It can be restored with superflow_restore_comment until 2026-11-07T00:00:00Z.",
    );
    expect(recorded[0]?.method).toBe("DELETE");
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental" });
  });

  it("labels a comment without a number by its id in the preview and after deleting", async () => {
    on("get", "/comments/:comment", ok(unnumberedComment));
    on("delete", "/comments/:comment", ok({ deleted: true, id: "cmt_8f3k2", number: null, restore_until: null }));
    const h = await connect();
    const preview = await h.call(TOOL, { comment: "cmt_8f3k2" });
    expect(summaryOf(preview)).toMatch(/^Comment cmt_8f3k2 in Acme Dental would be deleted/);
    expect((data(preview).preview as { number: unknown }).number).toBeNull();
    const done = await h.call(TOOL, { comment: "cmt_8f3k2", confirm: true });
    expect(summaryOf(done)).toBe("Deleted comment cmt_8f3k2. It can be restored with superflow_restore_comment.");
    expect(`${summaryOf(preview)} ${summaryOf(done)}`).not.toContain("#null");
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "4821", project: "Acme", confirm: true },
    method: "delete",
    path: "/comments/:comment",
    success: ok({ deleted: true, id: "cmt_8f3k2", number: 4821, restore_until: null }),
  });
});
