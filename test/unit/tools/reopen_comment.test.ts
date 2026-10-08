import { describe, expect, it } from "vitest";
import { fullComment } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_reopen_comment";

describe(TOOL, () => {
  it("reopens a resolved comment", async () => {
    const body = { comment: fullComment, changed: true, note_reply_id: null };
    on("post", "/comments/:comment/reopen", ok(body));
    const h = await connect({ defaultProject: "Acme Dental" });
    const result = await h.call(TOOL, { comment: "#4821" });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe("Reopened comment #4821. Link: https://acme.com/pricing?scommentId=8f3k2");
    expect(recorded[0]?.path).toBe("/comments/4821/reopen");
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental" });
  });

  it("reports a no-op when already open", async () => {
    on("post", "/comments/:comment/reopen", ok({ comment: fullComment, changed: false, note_reply_id: null }));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2" });
    expect(summaryOf(result)).toContain("was already open. Nothing changed.");
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "4821", project: "Acme" },
    method: "post",
    path: "/comments/:comment/reopen",
    success: ok({ comment: fullComment, changed: true, note_reply_id: null }),
  });
});
