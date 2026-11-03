import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_TAG_MESSAGE } from "../../../src/lib/confirm.ts";
import { list, tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_tag";
const scan = { scanned: 40, complete: true };
const deleted = { deleted: true, id: "tag_mobile", removed_from: 5, failed: 0, complete: true, next_cursor: null, scan };

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
    expect(summaryOf(result)).toBe(
      "Tag mobile (tag_mobile) would be taken off 5 comments, in every project. Nothing was deleted. Ask the user to confirm.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["listTags"]);
    expect(writes()).toEqual([]);
  });

  it("says a tag no comment carries is not found, and points to list_tags", async () => {
    on("get", "/tags", ok(list([tags[0]], { scan })));
    const h = await connect();
    const missing = errorOf(await h.call(TOOL, { tag: "mobile" }));
    expect(missing.code).toBe("not_found");
    expect(missing.hint).toContain("superflow_list_tags");
    expect(missing.hint).not.toContain("did not read");
    expect(writes()).toEqual([]);
  });

  it("after a tag scan that stopped early, says the tag may be on comments it did not read", async () => {
    on("get", "/tags", ok(list([tags[0]], { scan: { scanned: 10000, complete: false } })));
    const h = await connect();
    const missing = errorOf(await h.call(TOOL, { tag: "mobile" }));
    expect(missing.code).toBe("not_found");
    expect(missing.hint).toContain("The tag scan stopped after 10,000 comments, so the tag may be on comments it did not read.");
    expect(writes()).toEqual([]);
  });

  it("says the count may be low when the tag scan stopped early", async () => {
    on("get", "/tags", ok(list(tags, { scan: { scanned: 10000, complete: false } })));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "mobile" }))).toContain(
      "The tag scan stopped after 10,000 comments, so the count may be low and the tag may also be on comments it did not read.",
    );
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

  it("goes on with the cursor while next_cursor is set, and stops when it is null", async () => {
    on("delete", "/tags/:tag", ok({ ...deleted, removed_from: 500, complete: false, next_cursor: "c1" }), ok(deleted));
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "mobile", confirm: true }));
    expect(first).toBe(
      'Took tag mobile (tag_mobile) off 500 comments. More comments may carry the tag (one call rewrites at most 500): call superflow_delete_tag again with {"tag":"mobile","confirm":true,"cursor":"c1"}. Stop when next_cursor is null.',
    );
    expect(first).not.toContain("same arguments");
    const second = summaryOf(await h.call(TOOL, { tag: "mobile", confirm: true, cursor: "c1" }));
    expect(recorded[1]?.query).toEqual({ confirm: "true", cursor: "c1" });
    expect(second).toBe("Took tag mobile (tag_mobile) off 5 comments.");
  });

  it("when next_cursor is null but some comments failed, offers one retry without a cursor, then stops", async () => {
    on(
      "delete",
      "/tags/:tag",
      ok({ ...deleted, removed_from: 3, failed: 2, complete: false, next_cursor: null }),
      ok({ ...deleted, removed_from: 0, failed: 2, complete: false, next_cursor: null }),
    );
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "mobile", confirm: true, cursor: "c1" }))).toBe(
      'Took tag mobile (tag_mobile) off 3 comments. 2 comments could not be rewritten: on a project with more than 1,000 comments, only the newest 1,000 can be changed. One more call without a cursor retries them: superflow_delete_tag with {"tag":"mobile","confirm":true}. If that changes nothing, tell the user and stop.',
    );
    expect(summaryOf(await h.call(TOOL, { tag: "mobile", confirm: true }))).toContain(
      "This call changed nothing, so calling again will not help: tell the user and stop.",
    );
  });

  it("when the API's tag scan stopped before finding the tag, says how to look further", async () => {
    on(
      "delete",
      "/tags/:tag",
      fail(404, { code: "not_found", message: 'No tag matches "mobile".', hint: "List the tags.", scan: { scanned: 10000, complete: false }, next_cursor: "c9" }),
    );
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { tag: "mobile", confirm: true }));
    expect(error.code).toBe("not_found");
    expect(error.hint).toContain('call superflow_delete_tag again with {"tag":"mobile","confirm":true,"cursor":"c9"} to look further.');
    expect(error).toMatchObject({ scan: { scanned: 10000, complete: false }, next_cursor: "c9" });
  });

  it("only previews when a cursor comes without confirm", async () => {
    on("get", "/tags", ok(list(tags, { scan })));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "mobile", cursor: "c1" });
    expect((data(result) as { needs_confirmation?: boolean }).needs_confirmation).toBe(true);
    expect(writes()).toEqual([]);
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
