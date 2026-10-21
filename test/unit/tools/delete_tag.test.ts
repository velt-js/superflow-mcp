import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_TAG_MESSAGE } from "../../../src/lib/confirm.ts";
import { list, tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_tag";

describe(TOOL, () => {
  it("without confirm, reads the project's tags and returns the tag as a preview", async () => {
    on("get", "/projects/:project/tags", ok(list(tags)));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "MOBILE", project: "Acme Dental" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { tag: tags[1], comment_count: 5 },
      message: CONFIRM_DELETE_TAG_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Tag mobile (tag_mobile) would be deleted and removed from 5 comments. Nothing was deleted. Ask the user to confirm.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["listProjectTags"]);
    expect(writes()).toEqual([]);
  });

  it("looks in the workspace tags without a project, and asks for the project on a miss", async () => {
    on("get", "/tags", ok(list([tags[0]])));
    const h = await connect();
    expect((data(await h.call(TOOL, { tag: "tag_copy" })).preview as { tag: { id: string } }).tag.id).toBe("tag_copy");
    const missing = errorOf(await h.call(TOOL, { tag: "mobile" }));
    expect(missing.code).toBe("not_found");
    expect(missing.hint).toContain("pass project");
    expect(writes()).toEqual([]);
  });

  it("deletes with confirm: true", async () => {
    on("delete", "/tags/:tag", ok({ deleted: true, id: "tag_mobile", removed_from: 5 }));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "tag_mobile", confirm: true });
    expect(summaryOf(result)).toBe("Deleted tag tag_mobile (tag_mobile) and removed it from 5 comments.");
    expect(recorded.map((r) => [r.method, r.query])).toEqual([["DELETE", { confirm: "true" }]]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { tag: "copy", confirm: true },
    method: "delete",
    path: "/tags/:tag",
    success: ok({ deleted: true, id: "tag_copy", removed_from: 0 }),
  });
});
