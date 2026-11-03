import { describe, expect, it } from "vitest";
import { tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, seen, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_tag";
const scan = { scanned: 40, complete: true };
const renamed = {
  id: "tag_copywriting",
  name: "copywriting",
  color: null,
  usage_count: 12,
  comments_updated: 12,
  failed: 0,
  complete: true,
  next_cursor: null,
  scan,
};
const recolored = {
  ...tags[0],
  color: "#000000",
  comments_updated: 500,
  failed: 0,
  complete: false,
  next_cursor: "c1",
  scan: { scanned: 900, complete: false },
};

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

  it("after a real rename that stopped early, says to finish with merge_tags, not to rename again", async () => {
    on("patch", "/tags/:tag", ok({ ...renamed, comments_updated: 500, complete: false, next_cursor: "c1" }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "copy", name: "copywriting" }))).toBe(
      'Updated tag copywriting (tag_copywriting) on 500 comments. More comments may carry the tag (one call rewrites at most 500): finish with superflow_merge_tags from "copy" into "copywriting" (a second rename is refused, since the new name is now in use).',
    );
  });

  it("goes on with the cursor after a recolor that stopped early, until next_cursor is null", async () => {
    on(
      "patch",
      "/tags/:tag",
      ok(recolored),
      ok({ ...recolored, comments_updated: 20, complete: true, next_cursor: null, scan: { scanned: 300, complete: true } }),
    );
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000" }));
    expect(first).toBe(
      'Updated tag copy (tag_copy) on 500 comments. More comments may carry the tag (one call rewrites at most 500): call superflow_update_tag again with {"tag":"copy","color":"#000000","cursor":"c1"}. Stop when next_cursor is null.',
    );
    expect(first).not.toContain("merge_tags");
    expect(recorded[0]?.body).toEqual({ color: "#000000" });
    const second = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000", cursor: "c1" }));
    expect(recorded[1]?.body).toEqual({ color: "#000000", cursor: "c1" });
    expect(second).toBe("Updated tag copy (tag_copy) on 20 comments.");
  });

  it("treats a change of letter case as the same tag: it goes on with the cursor, by name or by id", async () => {
    on("patch", "/tags/:tag", ok({ ...recolored, name: "Copy", color: null }));
    const h = await connect();
    const byName = summaryOf(await h.call(TOOL, { tag: "copy", name: "Copy" }));
    expect(byName).toContain('call superflow_update_tag again with {"tag":"copy","name":"Copy","cursor":"c1"}.');
    expect(byName).not.toContain("merge_tags");
    const byId = summaryOf(await h.call(TOOL, { tag: "tag_copy", name: "COPY" }));
    expect(byId).toContain('call superflow_update_tag again with {"tag":"tag_copy","name":"COPY","cursor":"c1"}.');
    expect(byId).not.toContain("merge_tags");
  });

  it("when next_cursor is null but some comments failed, offers one retry without a cursor, then stops", async () => {
    on(
      "patch",
      "/tags/:tag",
      ok({ ...recolored, comments_updated: 10, failed: 2, complete: false, next_cursor: null }),
      ok({ ...recolored, comments_updated: 0, failed: 2, complete: false, next_cursor: null }),
    );
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000", cursor: "c1" }));
    expect(first).toBe(
      'Updated tag copy (tag_copy) on 10 comments. 2 comments could not be rewritten: on a project with more than 1,000 comments, only the newest 1,000 can be changed. One more call without a cursor retries them: superflow_update_tag with {"tag":"copy","color":"#000000"}. If that changes nothing, tell the user and stop.',
    );
    // The retry changed nothing: no further call is offered, so it cannot loop.
    const second = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000" }));
    expect(second).toBe(
      "Updated tag copy (tag_copy) on 0 comments. 2 comments could not be rewritten: on a project with more than 1,000 comments, only the newest 1,000 can be changed. This call changed nothing, so calling again will not help: tell the user and stop.",
    );
    expect(recorded[1]?.body).toEqual({ color: "#000000" });
  });

  it("a real rename that left failed comments retries them with a merge from the old name", async () => {
    on("patch", "/tags/:tag", ok({ ...renamed, comments_updated: 10, failed: 2, complete: false, next_cursor: null }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "copy", name: "copywriting" }))).toContain(
      'One more call without a cursor retries them: superflow_merge_tags from "copy" into "copywriting".',
    );
  });

  it("when the API's tag scan stopped before finding the tag, says how to look further", async () => {
    on("patch", "/tags/:tag", fail(404, { code: "not_found", message: 'No tag matches "copy".', hint: "List the tags.", scan: { scanned: 10000, complete: false }, next_cursor: "c9" }));
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { tag: "copy", color: "#000000" }));
    expect(error.code).toBe("not_found");
    expect(error.hint).toBe(
      'The tag scan stopped after 10,000 comments, so the tag may be on later ones: call superflow_update_tag again with {"tag":"copy","color":"#000000","cursor":"c9"} to look further.',
    );
    expect(error).toMatchObject({ scan: { scanned: 10000, complete: false }, next_cursor: "c9" });
  });

  it("refuses an empty change", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "copy" })).code).toBe("invalid");
    expect(errorOf(await h.call(TOOL, { tag: "copy", cursor: "c1" })).code).toBe("invalid");
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
