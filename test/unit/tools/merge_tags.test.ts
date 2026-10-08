import { describe, expect, it } from "vitest";
import { CONFIRM_MERGE_TAGS_MESSAGE } from "../../../src/lib/confirm.ts";
import { list, tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_merge_tags";
const copyText = { id: "tag_copytext", project_id: "prj_1a2b", name: "Copy text", color: null, usage_count: 3 };
const all = [...tags, copyText];

describe(TOOL, () => {
  it("without confirm, reads the tags and returns both as a preview", async () => {
    on("get", "/projects/:project/tags", ok(list(all)));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "Copy text", into: "copy", project: "Acme Dental" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { from: copyText, into: tags[0], comments_to_update: 3 },
      message: CONFIRM_MERGE_TAGS_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Tag Copy text would be merged into copy: 3 comments would get copy, and Copy text would be deleted. Nothing was merged. Ask the user to confirm.",
    );
    expect(writes()).toEqual([]);
  });

  it("refuses merging a tag into itself without writing", async () => {
    on("get", "/projects/:project/tags", ok(list(all)));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "copy", into: "tag_copy", project: "Acme Dental" })).code).toBe("invalid");
    expect(writes()).toEqual([]);
  });

  it("merges with confirm: true, sending confirm in the body", async () => {
    on("post", "/tags/:tag/merge", ok({ merged: true, from: "tag_copytext", into: "tag_copy", comments_updated: 3 }));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "Copy text", into: "copy", confirm: true });
    expect(summaryOf(result)).toBe("Merged tag Copy text into copy: 3 comments updated, and Copy text was deleted.");
    expect(recorded[0]?.path).toBe("/tags/Copy%20text/merge");
    expect(recorded[0]?.body).toEqual({ into: "copy", confirm: true });
  });

  standardErrorCases({
    tool: TOOL,
    args: { tag: "Copy text", into: "copy", confirm: true },
    method: "post",
    path: "/tags/:tag/merge",
    success: ok({ merged: true, from: "tag_copytext", into: "tag_copy", comments_updated: 0 }),
  });
});
