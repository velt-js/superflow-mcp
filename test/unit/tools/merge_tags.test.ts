import { describe, expect, it } from "vitest";
import { CONFIRM_MERGE_TAGS_MESSAGE } from "../../../src/lib/confirm.ts";
import { list, tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_merge_tags";
const copyText = { id: "tag_copytext", name: "Copy text", color: "#b3261e", usage_count: 3 };
const all = [...tags, copyText];
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

describe(TOOL, () => {
  it("without confirm, reads the workspace's tags and returns both as a preview", async () => {
    on("get", "/tags", ok(list(all, { scan })));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "Copy text", into: "copy" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { from: copyText, into: tags[0], comments_to_update: 3, scan },
      message: CONFIRM_MERGE_TAGS_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Tag Copy text would be merged into copy, in every project: 3 comments would get copy instead, and Copy text would be gone. Nothing was merged. Ask the user to confirm.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["listTags"]);
    expect(writes()).toEqual([]);
  });

  it("previews a merge into a new name, which keeps the merged tag's color", async () => {
    on("get", "/tags", ok(list(all, { scan })));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "Copy text", into: "copywriting" });
    expect((data(result).preview as { into: unknown }).into).toEqual({ id: null, name: "copywriting", color: "#b3261e", usage_count: 0, new: true });
    expect(summaryOf(result)).toContain("would be merged into a new tag copywriting, in every project");
    expect(writes()).toEqual([]);
  });

  it("refuses a tag_ id for into that no comment carries", async () => {
    on("get", "/tags", ok(list(all, { scan })));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "Copy text", into: "tag_nope" })).code).toBe("not_found");
  });

  it("says the count may be low, and the tag may be on comments not read, when the tag scan stopped early", async () => {
    on("get", "/tags", ok(list(all, { scan: { scanned: 10000, complete: false } })));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copy" }))).toContain(
      "The tag scan stopped after 10,000 comments, so the count may be low and the tag may also be on comments it did not read.",
    );
    const missing = errorOf(await h.call(TOOL, { tag: "Copy txt", into: "copy" }));
    expect(missing.code).toBe("not_found");
    expect(missing.hint).toContain("so the tag may be on comments it did not read");
  });

  it("refuses merging a tag into itself without a request, by name or after the lookup", async () => {
    on("get", "/tags", ok(list(all, { scan })));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "copy", into: "COPY", confirm: true })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
    expect(errorOf(await h.call(TOOL, { tag: "copy", into: "tag_copy" })).code).toBe("invalid");
    expect(writes()).toEqual([]);
  });

  it("merges with confirm: true in one request, sending confirm in the body", async () => {
    on("post", "/tags/:tag/merge", ok(merged));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true });
    expect(summaryOf(result)).toBe("Merged tag Copy text into copy: 3 comments updated.");
    expect(recorded.map((r) => r.operationId)).toEqual(["mergeTags"]);
    expect(recorded[0]?.path).toBe("/tags/Copy%20text/merge");
    expect(recorded[0]?.body).toEqual({ into: "copy", confirm: true });
  });

  it("goes on with the cursor while next_cursor is set, sending it in the body", async () => {
    on("post", "/tags/:tag/merge", ok({ ...merged, comments_updated: 500, failed: 2, complete: false, next_cursor: "c1" }), ok(merged));
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true }));
    expect(first).toBe(
      'Merged tag Copy text into copy: 500 comments updated. 2 comments could not be rewritten in this call; once next_cursor is null, one more call without a cursor retries them. More comments may carry the tag (one call rewrites at most 500): call superflow_merge_tags again with {"tag":"Copy text","into":"copy","confirm":true,"cursor":"c1"}. Stop when next_cursor is null.',
    );
    await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true, cursor: "c1" });
    expect(recorded[1]?.body).toEqual({ into: "copy", confirm: true, cursor: "c1" });
  });

  it("when next_cursor is null but some comments failed, offers one retry without a cursor, then stops", async () => {
    on(
      "post",
      "/tags/:tag/merge",
      ok({ ...merged, comments_updated: 1, failed: 2, complete: false, next_cursor: null }),
      ok({ ...merged, comments_updated: 0, failed: 2, complete: false, next_cursor: null }),
    );
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true, cursor: "c1" }));
    expect(first).toContain('One more call without a cursor retries them: superflow_merge_tags with {"tag":"Copy text","into":"copy","confirm":true}.');
    const second = summaryOf(await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true }));
    expect(second).toContain("This call changed nothing, so calling again will not help: tell the user and stop.");
    expect(second).not.toContain("call superflow_merge_tags again");
    expect(recorded[1]?.body).toEqual({ into: "copy", confirm: true });
  });

  it("when the API's tag scan stopped before finding the tag, says how to look further", async () => {
    on(
      "post",
      "/tags/:tag/merge",
      fail(404, { code: "not_found", message: 'No tag matches "Copy text".', hint: "List the tags.", scan: { scanned: 10000, complete: false }, next_cursor: "c9" }),
    );
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true }));
    expect(error.hint).toContain('call superflow_merge_tags again with {"tag":"Copy text","into":"copy","confirm":true,"cursor":"c9"} to look further.');
  });

  it("surfaces an error from the merge itself", async () => {
    on("post", "/tags/:tag/merge", fail(404, { code: "not_found", message: 'No tag matches "Copy text".', hint: "List the tags." }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true })).code).toBe("not_found");
  });

  // The preview's first request is the workspace tag list.
  standardErrorCases({
    tool: TOOL,
    args: { tag: "Copy text", into: "copy" },
    method: "get",
    path: "/tags",
    success: ok(list(all, { scan })),
  });
});
