import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_TAG_MESSAGE } from "../../../src/lib/confirm.ts";
import { list, tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_tag";
const scan = { scanned: 40, complete: true };
const deleted = { deleted: true, id: "tag_mobile", removed_from: 5, failed: 0, complete: true };

describe(TOOL, () => {
  it("without confirm, reads the workspace's tags and returns the tag as a preview", async () => {
    on("get", "/tags", ok(list(tags, { scan })));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "MOBILE" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { tag: tags[1], comment_count: 5, scan },
      message: CONFIRM_DELETE_TAG_MESSAGE,
    });
    expect(summaryOf(result)).toBe("Tag mobile (tag_mobile) would be taken off 5 comments. Nothing was deleted. Ask the user to confirm.");
    expect(recorded.map((r) => r.operationId)).toEqual(["listTags"]);
    expect(writes()).toEqual([]);
  });

  it("says a tag no comment carries is not found, and points to list_tags", async () => {
    on("get", "/tags", ok(list([tags[0]], { scan })));
    const h = await connect();
    const missing = errorOf(await h.call(TOOL, { tag: "mobile" }));
    expect(missing.code).toBe("not_found");
    expect(missing.hint).toContain("superflow_list_tags");
    expect(writes()).toEqual([]);
  });

  it("says the count may be low when the tag scan stopped early", async () => {
    on("get", "/tags", ok(list(tags, { scan: { scanned: 10000, complete: false } })));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "mobile" }))).toContain("The count may be low: the tag scan stopped after 10,000 comments");
  });

  it("deletes with confirm: true in one request", async () => {
    on("delete", "/tags/:tag", ok(deleted));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "mobile", confirm: true });
    expect(data(result)).toEqual(deleted);
    expect(summaryOf(result)).toBe("Took tag mobile (tag_mobile) off 5 comments.");
    expect(recorded.map((r) => [r.method, r.operationId, r.query])).toEqual([["DELETE", "deleteTag", { confirm: "true" }]]);
    expect(recorded[0]?.path).toBe("/tags/mobile");
  });

  it("says when the delete did not reach every comment, and how to finish", async () => {
    on("delete", "/tags/:tag", ok({ ...deleted, removed_from: 500, complete: false }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "mobile", confirm: true }))).toBe(
      "Took tag mobile (tag_mobile) off 500 comments. Not every comment was changed (one call changes at most 500): call superflow_delete_tag again with the same arguments to finish.",
    );
  });

  it("surfaces an error from the delete itself", async () => {
    on("delete", "/tags/:tag", fail(404, { code: "not_found", message: 'No tag matches "mobile".', hint: "List the tags." }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "mobile", confirm: true })).code).toBe("not_found");
  });

  // The preview's first request is the workspace tag list.
  standardErrorCases({
    tool: TOOL,
    args: { tag: "copy" },
    method: "get",
    path: "/tags",
    success: ok(list(tags, { scan })),
  });
});
