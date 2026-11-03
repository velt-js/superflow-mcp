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
const WINDOW = "on a project with more than 1,000 comments, only the newest 1,000 can be changed";
const DONE_FIRST_PASS =
  'Done: this pass reached the last comment. If an earlier call of this job said a retry pass can try comments again, make it now, once: superflow_update_tag with {"tag":"copy","color":"#000000","retry":true}. Otherwise the job is finished.';

describe(TOOL, () => {
  it("renames a tag on every comment, the tag takes the new name's id, and a finished pass says it is done", async () => {
    on("patch", "/tags/:tag", ok(renamed));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "copy", name: "copywriting" });
    expect(data(result)).toEqual(renamed);
    expect(summaryOf(result)).toBe(
      'Updated tag copywriting (tag_copywriting) on 12 comments. Done: this pass reached the last comment. If an earlier call of this job said a retry pass can try comments again, make it now, once: superflow_merge_tags with {"tag":"copy","into":"copywriting","confirm":true,"retry":true} (part of the rename the user agreed to). Otherwise the job is finished.',
    );
    expect(recorded[0]?.path).toBe("/tags/copy");
    expect(recorded[0]?.body).toEqual({ name: "copywriting" });
  });

  it("a real rename that stopped early goes on with the cursor, not with a merge", async () => {
    on("patch", "/tags/:tag", ok({ ...renamed, comments_updated: 500, complete: false, next_cursor: "c1" }), ok(renamed));
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "copy", name: "copywriting" }));
    expect(first).toBe(
      'Updated tag copywriting (tag_copywriting) on 500 comments. More comments may carry the tag (one call rewrites at most 500): call superflow_update_tag again with {"tag":"copy","name":"copywriting","cursor":"c1"}. Stop when next_cursor is null.',
    );
    expect(first).not.toContain("merge_tags");
    await h.call(TOOL, { tag: "copy", name: "copywriting", cursor: "c1" });
    expect(recorded[1]?.body).toEqual({ name: "copywriting", cursor: "c1" });
  });

  it("goes on with the cursor after a recolor that stopped early, even when a call changed nothing", async () => {
    on("patch", "/tags/:tag", ok({ ...recolored, comments_updated: 0 }), ok({ ...recolored, comments_updated: 20, complete: true, next_cursor: null }));
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000" }));
    expect(first).toBe(
      'Updated tag copy (tag_copy) on 0 comments. More comments may carry the tag (one call rewrites at most 500): call superflow_update_tag again with {"tag":"copy","color":"#000000","cursor":"c1"}. Stop when next_cursor is null.',
    );
    expect(recorded[0]?.body).toEqual({ color: "#000000" });
    const second = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000", cursor: "c1" }));
    expect(recorded[1]?.body).toEqual({ color: "#000000", cursor: "c1" });
    expect(second).toBe(`Updated tag copy (tag_copy) on 20 comments. ${DONE_FIRST_PASS}`);
  });

  it("offers ONE retry pass when a call could not rewrite comments while it changed others, and the retry pass ends the job", async () => {
    on(
      "patch",
      "/tags/:tag",
      // First pass: a refused batch in the middle, then the end.
      ok({ ...recolored, comments_updated: 480, failed: 20 }),
      ok({ ...recolored, comments_updated: 10, failed: 0, complete: true, next_cursor: null }),
      // Retry pass: the same comments fail again (outside the window), the chain goes on to the end.
      ok({ ...recolored, comments_updated: 0, failed: 20, next_cursor: "r1" }),
      ok({ ...recolored, comments_updated: 0, failed: 0, complete: true, next_cursor: null }),
    );
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000" }));
    expect(first).toContain(`20 comments could not be rewritten in this call (a refused batch, or ${WINDOW}). When this pass ends, one retry pass can try them again.`);
    expect(first).toContain('call superflow_update_tag again with {"tag":"copy","color":"#000000","cursor":"c1"}');
    expect(summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000", cursor: "c1" }))).toContain(DONE_FIRST_PASS);

    const retry = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000", retry: true }));
    // A call that changed nothing while comments failed promises no retry, and the pass goes on.
    expect(retry).toContain(`20 comments could not be rewritten and cannot change: ${WINDOW}.`);
    expect(retry).toContain('call superflow_update_tag again with {"tag":"copy","color":"#000000","cursor":"r1","retry":true}');
    expect(retry).not.toContain("retry pass can try");
    const end = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000", cursor: "r1", retry: true }));
    expect(end).toBe("Updated tag copy (tag_copy) on 0 comments. Done: the retry pass is over. Do not call again.");
    // retry is the package's own flag: it never reaches the API, so the cursor stays valid.
    expect(recorded.map((r) => r.body)).toEqual([{ color: "#000000" }, { color: "#000000", cursor: "c1" }, { color: "#000000" }, { color: "#000000", cursor: "r1" }]);
  });

  it("a pass that ends with comments it could not rewrite while changing others asks for the retry pass right away", async () => {
    on("patch", "/tags/:tag", ok({ ...recolored, comments_updated: 10, failed: 2, next_cursor: null }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000", cursor: "c1" }))).toBe(
      `Updated tag copy (tag_copy) on 10 comments. 2 comments could not be rewritten in this call (a refused batch, or ${WINDOW}). This pass is done. Make the one retry pass now: superflow_update_tag with {"tag":"copy","color":"#000000","retry":true}. After it, stop.`,
    );
  });

  it("a retry pass that ends with comments still failing says to tell the user and stop", async () => {
    on("patch", "/tags/:tag", ok({ ...recolored, comments_updated: 3, failed: 2, next_cursor: null }));
    const h = await connect();
    const summary = summaryOf(await h.call(TOOL, { tag: "copy", color: "#000000", retry: true }));
    expect(summary).toBe(
      `Updated tag copy (tag_copy) on 3 comments. 2 comments could not be rewritten and cannot change: ${WINDOW}. Done: the retry pass is over. Tell the user how many comments could not be changed, and stop: do not call again.`,
    );
    expect(summary).not.toContain("retry pass now");
  });

  it("the retry pass of a real rename is a merge from the old name", async () => {
    on("patch", "/tags/:tag", ok({ ...renamed, comments_updated: 10, failed: 2, complete: false, next_cursor: null }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "copy", name: "copywriting" }))).toContain(
      'Make the one retry pass now: superflow_merge_tags with {"tag":"copy","into":"copywriting","confirm":true,"retry":true} (part of the rename the user agreed to).',
    );
  });

  it("treats a change of letter case as the same tag, by name or by id", async () => {
    on("patch", "/tags/:tag", ok({ ...recolored, name: "Copy", color: null, comments_updated: 10, failed: 2, next_cursor: null }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { tag: "copy", name: "Copy" }))).toContain('superflow_update_tag with {"tag":"copy","name":"Copy","retry":true}');
    expect(summaryOf(await h.call(TOOL, { tag: "tag_copy", name: "COPY" }))).toContain('superflow_update_tag with {"tag":"tag_copy","name":"COPY","retry":true}');
  });

  it("when the API's tag scan stopped before finding the tag, says how to look further", async () => {
    on(
      "patch",
      "/tags/:tag",
      fail(404, { code: "not_found", message: 'No tag matches "copy".', hint: "List the tags.", scan: { scanned: 10000, complete: false }, next_cursor: "c9" }),
    );
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { tag: "copy", color: "#000000" }));
    expect(error.code).toBe("not_found");
    expect(error.hint).toBe(
      'The API read 10,000 comments without finding the tag and stopped before the last, so it may be on later ones: call superflow_update_tag again with {"tag":"copy","color":"#000000","cursor":"c9"} to look further.',
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
