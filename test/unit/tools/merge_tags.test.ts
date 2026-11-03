import { describe, expect, it } from "vitest";
import { CONFIRM_MERGE_TAGS_MESSAGE } from "../../../src/lib/confirm.ts";
import { tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_merge_tags";
const copyText = { id: "tag_copytext", name: "Copy text", color: "#b3261e", usage_count: 3 };
const scan = { scanned: 40, complete: true };
const merged = {
  merged: true,
  from: "tag_copytext",
  into: "tag_copy",
  comments_updated: 3,
  failed: 0,
  complete: true,
  next_cursor: null,
  scan,
};

/** The API's answer to a merge without confirm: 409 with both tags and the count in what it read. */
const needsConfirmation = (into: Record<string, unknown> = tags[0] as unknown as Record<string, unknown>, readScan = scan, nextCursor: string | null = null) =>
  fail(409, {
    code: "needs_confirmation",
    message: "Merging tag Copy text into copy moves it on 3 comments and deletes Copy text. Send confirm: true to merge.",
    preview: { from: copyText, into, comment_count: 3, scan: readScan },
    ...(nextCursor ? { scan: readScan, next_cursor: nextCursor } : {}),
  });

describe(TOOL, () => {
  it("without confirm, asks the API for its preview (no confirm in the body) and returns it", async () => {
    on("post", "/tags/:tag/merge", needsConfirmation());
    const h = await connect();
    const result = await h.call(TOOL, { tag: "Copy text", into: "copy" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { from: copyText, into: tags[0], comment_count: 3, this_page: 3, scan, next_cursor: null },
      message: CONFIRM_MERGE_TAGS_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Tag Copy text would be merged into copy, in every project: 3 comments would get copy instead, and Copy text would be gone. Nothing was merged. Ask the user to confirm.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["mergeTags"]);
    expect(recorded[0]?.body).toEqual({ into: "copy" });
  });

  it("previews a merge into a new name", async () => {
    on("post", "/tags/:tag/merge", needsConfirmation({ id: "tag_copywriting", name: "copywriting", color: "#b3261e", usage_count: 0 }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copywriting" }))).toContain("would be merged into a new tag copywriting, in every project");
  });

  it("pages the count with the 409's cursor, and does not call an unseen tag new on a partial read", async () => {
    const copywriting = { id: "tag_copywriting", name: "copywriting", color: null, usage_count: 0 };
    on("post", "/tags/:tag/merge", needsConfirmation(copywriting, { scanned: 10000, complete: false }, "p2"), needsConfirmation(copywriting));
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copywriting" }));
    expect(first).toBe(
      'Tag Copy text is on 3 comments so far; merged into copywriting, they would get copywriting instead, in every project, and Copy text would be gone. The API stopped before the last comment, so more may carry it. For the full count, call superflow_merge_tags again with {"tag":"Copy text","into":"copywriting","cursor":"p2","counted":3} (still without confirm), or ask the user now and say the count is so far. When the user agrees, confirm without a cursor: the job then merges from the first comment (a cursor with confirm merges only from that point on). Nothing was merged. Ask the user to confirm.',
    );
    expect(first).not.toContain("a new tag");
    const last = summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copywriting", cursor: "p2", counted: 3 }));
    expect(last).toContain("would be merged into copywriting, in every project: 6 comments would get copywriting instead");
    expect(recorded.map((r) => r.body)).toEqual([{ into: "copywriting" }, { into: "copywriting", cursor: "p2" }]);
  });

  it("pages the preview with the cursor when the tag is past the API's read", async () => {
    on(
      "post",
      "/tags/:tag/merge",
      fail(404, { code: "not_found", message: 'No tag "Copy text" in the comments read.', hint: "", scan: { scanned: 10000, complete: false }, next_cursor: "c9" }),
      needsConfirmation(),
    );
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "Copy text", into: "copy" })).hint).toContain(
      'call superflow_merge_tags again with {"tag":"Copy text","into":"copy","cursor":"c9"} (still without confirm) to look further.',
    );
    expect(summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copy", cursor: "c9" }))).toContain(
      "When the user agrees, confirm without a cursor: the job then merges from the first comment",
    );
    expect(recorded.map((r) => r.body)).toEqual([{ into: "copy" }, { into: "copy", cursor: "c9" }]);
  });

  it("refuses merging a tag into itself by name without a request", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "copy", into: "COPY", confirm: true })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("merges with confirm: true in one request, sending confirm in the body", async () => {
    on("post", "/tags/:tag/merge", ok(merged));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true });
    expect(summaryOf(result)).toContain("Merged tag Copy text into copy: 3 comments updated. Done: this pass reached the last comment.");
    expect(recorded.map((r) => r.operationId)).toEqual(["mergeTags"]);
    expect(recorded[0]?.path).toBe("/tags/Copy%20text/merge");
    expect(recorded[0]?.body).toEqual({ into: "copy", confirm: true });
  });

  it("goes on with the cursor while next_cursor is set, and says a retry pass can follow", async () => {
    on("post", "/tags/:tag/merge", ok({ ...merged, comments_updated: 500, failed: 2, complete: false, next_cursor: "c1" }), ok(merged));
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true }));
    expect(first).toContain("2 comments could not be rewritten in this call");
    expect(first).toContain("When this pass ends, one retry pass can try them again.");
    expect(first).toContain('call superflow_merge_tags again with {"tag":"Copy text","into":"copy","confirm":true,"cursor":"c1"}. Stop when next_cursor is null.');
    const second = summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true, cursor: "c1" }));
    expect(second).toContain('make it now, once: superflow_merge_tags with {"tag":"Copy text","into":"copy","confirm":true,"retry":true}.');
    expect(recorded[1]?.body).toEqual({ into: "copy", confirm: true, cursor: "c1" });
  });

  it("a retry pass never offers another", async () => {
    on("post", "/tags/:tag/merge", ok({ ...merged, comments_updated: 1, failed: 2, complete: false, next_cursor: null }));
    const h = await connect();
    const summary = summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true, retry: true }));
    expect(summary).toContain("Done: the retry pass is over. Tell the user how many comments could not be changed, and stop: do not call again.");
    expect(summary).not.toContain("retry pass now");
    expect(recorded[0]?.body).toEqual({ into: "copy", confirm: true });
  });

  it("surfaces an error from the merge itself", async () => {
    on("post", "/tags/:tag/merge", fail(404, { code: "not_found", message: 'No tag matches "Copy text".', hint: "List the tags." }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true })).code).toBe("not_found");
  });

  // The preview's request is the unconfirmed merge.
  standardErrorCases({
    tool: TOOL,
    args: { tag: "Copy text", into: "copy" },
    method: "post",
    path: "/tags/:tag/merge",
    success: needsConfirmation(),
  });
});
