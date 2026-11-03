import { describe, expect, it } from "vitest";
import { tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, seen, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_tag";
const renamed = { id: "tag_copywriting", name: "copywriting", color: null, usage_count: 12, comments_updated: 12, failed: 0, complete: true };

describe(TOOL, () => {
  it("renames a tag on every comment, and the tag takes the new name's id", async () => {
    on("patch", "/tags/:tag", ok(renamed));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "copy", name: "copywriting" });
    expect(data(result)).toEqual(renamed);
    expect(summaryOf(result)).toBe("Updated tag copywriting (tag_copywriting) on 12 comments.");
    expect(recorded[0]?.path).toBe("/tags/copy");
    expect(recorded[0]?.body).toEqual({ name: "copywriting" });
  });

  it("after a rename that stopped early, says to finish with merge_tags", async () => {
    on("patch", "/tags/:tag", ok({ ...renamed, comments_updated: 500, complete: false }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "copy", name: "copywriting" }))).toBe(
      'Updated tag copywriting (tag_copywriting) on 500 comments. Not every comment was changed (one call changes at most 500): finish with superflow_merge_tags from "copy" into "copywriting".',
    );
  });

  it("recolors a tag, and says how many comments failed", async () => {
    on("patch", "/tags/:tag", ok({ ...tags[0], color: "#000000", comments_updated: 10, failed: 2, complete: false }));
    const h = await connect();
    const summary = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000" }));
    expect(summary).toContain("Updated tag copy (tag_copy) on 10 comments. 2 comments could not be changed.");
    expect(summary).toContain("tell the user the rest keep the old color for now.");
    expect(recorded[0]?.body).toEqual({ color: "#000000" });
  });

  it("refuses an empty change", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "copy" })).code).toBe("invalid");
    expect(seen).toEqual([]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { tag: "copy", color: "#000000" },
    method: "patch",
    path: "/tags/:tag",
    success: ok(renamed),
  });
});
