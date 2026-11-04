import { describe, expect, it } from "vitest";
import { fullComment, resolvedComment } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_resolve_comment";

describe(TOOL, () => {
  it("resolves with a note", async () => {
    const body = { comment: resolvedComment, changed: true, note_reply_id: "rpl_8f3k2.777" };
    on("post", "/comments/:comment/resolve", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", project: "Acme Dental", note: "Fixed, please check." });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe(
      "Resolved comment cmt_8f3k2 and posted the note as a reply. Link: https://acme.com/pricing?scommentId=8f3k2",
    );
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental", note: "Fixed, please check." });
  });

  it("reports a no-op when already resolved", async () => {
    on("post", "/comments/:comment/resolve", ok({ comment: resolvedComment, changed: false, note_reply_id: null }));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", note: "Again" });
    expect(summaryOf(result)).toBe(
      "Comment cmt_8f3k2 was already resolved. Nothing changed and the note was not posted. Link: https://acme.com/pricing?scommentId=8f3k2",
    );
    expect(recorded[0]?.body).toEqual({ note: "Again" });
  });

  it("promises the verify rescan of an agent finding, and says why there is none for an imported finding (B8)", async () => {
    const queued = { queued: true, already_pending: false, run_id: null, no_rescan_reason: null };
    on("post", "/comments/:comment/resolve", ok({ comment: resolvedComment, changed: true, note_reply_id: null, verify: queued }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { comment: "cmt_8f3k2" }))).toContain("Its page is rescanned within a minute to verify it");
    const none = { queued: false, already_pending: false, run_id: null, no_rescan_reason: "imported_finding" };
    on("post", "/comments/:comment/resolve", ok({ comment: resolvedComment, changed: true, note_reply_id: null, verify: none }));
    expect(summaryOf(await h.call(TOOL, { comment: "cmt_8f3k2" }))).toBe(
      "Resolved comment cmt_8f3k2. No rescan was queued and nothing was charged: it is an imported finding, and Superflow cannot rerun the outside agent that found it. Link: https://acme.com/pricing?scommentId=8f3k2",
    );
  });

  it("labels the comment by its id", async () => {
    on("post", "/comments/:comment/resolve", ok({ comment: resolvedComment, changed: true, note_reply_id: null }));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2" });
    expect(summaryOf(result)).toBe("Resolved comment cmt_8f3k2. Link: https://acme.com/pricing?scommentId=8f3k2");
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "cmt_8f3k2", project: "Acme" },
    method: "post",
    path: "/comments/:comment/resolve",
    success: ok({ comment: fullComment, changed: true, note_reply_id: null }),
  });
});
