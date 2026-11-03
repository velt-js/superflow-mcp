import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_TAG_MESSAGE } from "../../../src/lib/confirm.ts";
import { tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_tag";
const scan = { scanned: 40, complete: true };
const deleted = { deleted: true, id: "tag_mobile", removed_from: 5, failed: 0, complete: true, next_cursor: null, scan };
const WINDOW = "on a project with more than 1,000 comments, only the newest 1,000 can be changed";

/** The API's answer to a delete without confirm: 409 with the tag and its count in one window. */
const needsConfirmation = (readScan = scan, count = 5, nextCursor: string | null = null) =>
  fail(409, {
    code: "needs_confirmation",
    message: "Deleting tag mobile removes it from 5 comments. Send confirm=true to delete it.",
    preview: { tag: tags[1], comment_count: count, scan: readScan },
    ...(nextCursor ? { scan: readScan, next_cursor: nextCursor } : {}),
  });
const CONFIRM_FROM_START =
  "When the user agrees, confirm without a cursor: the job then deletes from the first comment (a cursor with confirm deletes only from that point on).";

describe(TOOL, () => {
  it("without confirm, asks the API for its preview (no confirm sent) and returns it", async () => {
    on("delete", "/tags/:tag", needsConfirmation());
    const h = await connect();
    const result = await h.call(TOOL, { tag: "MOBILE" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { tag: tags[1], comment_count: 5, this_page: 5, scan, next_cursor: null },
      message: CONFIRM_DELETE_TAG_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Tag mobile (tag_mobile) would be taken off 5 comments, in every project. Nothing was deleted. Ask the user to confirm.",
    );
    expect(recorded.map((r) => [r.method, r.operationId, r.query])).toEqual([["DELETE", "deleteTag", {}]]);
    expect(recorded[0]?.path).toBe("/tags/MOBILE");
  });

  it("pages the count with the 409's cursor and adds it up, then says to confirm from the first comment", async () => {
    on(
      "delete",
      "/tags/:tag",
      needsConfirmation({ scanned: 10000, complete: false }, 300, "p2"),
      fail(404, { code: "not_found", message: 'No tag "mobile" in the comments read.', hint: "", scan: { scanned: 10000, complete: false }, next_cursor: "p3" }),
      needsConfirmation({ scanned: 2000, complete: true }, 7),
    );
    const h = await connect();
    const first = await h.call(TOOL, { tag: "mobile" });
    expect(summaryOf(first)).toBe(
      `Tag mobile (tag_mobile) is on 300 comments so far, in every project. The API stopped before the last comment, so more may carry it. For the full count, call superflow_delete_tag again with {"tag":"mobile","cursor":"p2","counted":300} (still without confirm), or ask the user now and say the count is so far. ${CONFIRM_FROM_START} Nothing was deleted. Ask the user to confirm.`,
    );
    expect(summaryOf(first)).not.toContain("at least");
    expect((data(first).preview as { next_cursor: unknown }).next_cursor).toBe("p2");
    // A window without the tag, after earlier pages counted it: a page of 0, and paging goes on.
    const second = summaryOf(await h.call(TOOL, { tag: "mobile", cursor: "p2", counted: 300 }));
    expect(second).toContain("Tag mobile is on 300 comments so far (0 on this page), in every project.");
    expect(second).toContain('{"tag":"mobile","cursor":"p3","counted":300}');
    const last = await h.call(TOOL, { tag: "mobile", cursor: "p3", counted: 300 });
    expect(summaryOf(last)).toBe(
      `Tag mobile (tag_mobile) would be taken off 307 comments, in every project. ${CONFIRM_FROM_START} Nothing was deleted. Ask the user to confirm.`,
    );
    expect(data(last).preview).toMatchObject({ comment_count: 307, this_page: 7, next_cursor: null });
    // counted is the package's own: the API gets the cursor only.
    expect(recorded.map((r) => r.query)).toEqual([{}, { cursor: "p2" }, { cursor: "p3" }]);
  });

  it("pages the preview with the cursor when the tag is past the API's read", async () => {
    on(
      "delete",
      "/tags/:tag",
      fail(404, { code: "not_found", message: 'No tag "mobile" in the first 10000 comments read.', hint: "", scan: { scanned: 10000, complete: false }, next_cursor: "c9" }),
      needsConfirmation({ scanned: 4000, complete: true }, 7),
    );
    const h = await connect();
    const missing = errorOf(await h.call(TOOL, { tag: "mobile" }));
    expect(missing.code).toBe("not_found");
    expect(missing.hint).toContain('call superflow_delete_tag again with {"tag":"mobile","cursor":"c9"} (still without confirm) to look further.');
    const found = await h.call(TOOL, { tag: "mobile", cursor: "c9" });
    expect(summaryOf(found)).toBe(
      `Tag mobile (tag_mobile) would be taken off 7 comments, in every project. ${CONFIRM_FROM_START} Nothing was deleted. Ask the user to confirm.`,
    );
    expect(recorded.map((r) => r.query)).toEqual([{}, { cursor: "c9" }]);
  });

  it("returns a tag the API does not know as not_found with its hint", async () => {
    on("delete", "/tags/:tag", fail(404, { code: "not_found", message: 'No tag matches "mobile".', hint: "List the tags with superflow_list_tags." }));
    const h = await connect();
    const missing = errorOf(await h.call(TOOL, { tag: "mobile" }));
    expect(missing.code).toBe("not_found");
    expect(missing.hint).toContain("superflow_list_tags");
  });

  it("deletes with confirm: true in one request, and a finished pass says it is done", async () => {
    on("delete", "/tags/:tag", ok(deleted));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "mobile", confirm: true });
    expect(data(result)).toEqual(deleted);
    expect(summaryOf(result)).toBe(
      'Took tag mobile (tag_mobile) off 5 comments. Done: this pass reached the last comment. If an earlier call of this job said a retry pass can try comments again, make it now, once: superflow_delete_tag with {"tag":"mobile","confirm":true,"retry":true}. Otherwise the job is finished.',
    );
    expect(recorded.map((r) => [r.method, r.operationId, r.query])).toEqual([["DELETE", "deleteTag", { confirm: "true" }]]);
  });

  it("goes on with the cursor while next_cursor is set", async () => {
    on("delete", "/tags/:tag", ok({ ...deleted, removed_from: 500, complete: false, next_cursor: "c1" }), ok(deleted));
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "mobile", confirm: true }));
    expect(first).toBe(
      'Took tag mobile (tag_mobile) off 500 comments. More comments may carry the tag (one call rewrites at most 500): call superflow_delete_tag again with {"tag":"mobile","confirm":true,"cursor":"c1"}. Stop when next_cursor is null.',
    );
    await h.call(TOOL, { tag: "mobile", confirm: true, cursor: "c1" });
    expect(recorded[1]?.query).toEqual({ confirm: "true", cursor: "c1" });
  });

  it("offers one retry pass for comments it could not rewrite while it changed others; the retry pass ends the job", async () => {
    on(
      "delete",
      "/tags/:tag",
      ok({ ...deleted, removed_from: 3, failed: 2, complete: false, next_cursor: null }),
      ok({ ...deleted, removed_from: 0, failed: 2, complete: false, next_cursor: null }),
    );
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "mobile", confirm: true, cursor: "c1" }))).toBe(
      `Took tag mobile (tag_mobile) off 3 comments. 2 comments could not be rewritten in this call (a refused batch, or ${WINDOW}). This pass is done. Make the one retry pass now: superflow_delete_tag with {"tag":"mobile","confirm":true,"retry":true}. After it, stop.`,
    );
    expect(summaryOf(await h.call(TOOL, { tag: "mobile", confirm: true, retry: true }))).toBe(
      `Took tag mobile (tag_mobile) off 0 comments. 2 comments could not be rewritten and cannot change: ${WINDOW}. Done: the retry pass is over. Tell the user how many comments could not be changed, and stop: do not call again.`,
    );
    expect(recorded[1]?.query).toEqual({ confirm: "true" });
  });

  it("when the API's tag scan stopped before finding the tag on a confirmed call, says how to look further", async () => {
    on(
      "delete",
      "/tags/:tag",
      fail(404, { code: "not_found", message: 'No tag matches "mobile".', hint: "List the tags.", scan: { scanned: 10000, complete: false }, next_cursor: "c9" }),
    );
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { tag: "mobile", confirm: true }));
    expect(error.hint).toContain('call superflow_delete_tag again with {"tag":"mobile","confirm":true,"cursor":"c9"} to look further.');
    expect(error).toMatchObject({ scan: { scanned: 10000, complete: false }, next_cursor: "c9" });
  });

  // The preview's request is the unconfirmed delete.
  standardErrorCases({
    tool: TOOL,
    args: { tag: "copy" },
    method: "delete",
    path: "/tags/:tag",
    success: needsConfirmation(),
  });
});
