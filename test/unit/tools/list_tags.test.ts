import { describe, expect, it } from "vitest";
import { list, tags } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_tags";

describe(TOOL, () => {
  it("lists tags by usage", async () => {
    on("get", "/tags", ok(list(tags)));
    const h = await connect();
    const result = await h.call(TOOL);
    expect(data(result)).toEqual(list(tags));
    expect(summaryOf(result)).toBe("2 tags: copy (12), mobile (5).");
    expect(recorded[0]?.operationId).toBe("listTags");
  });

  it("says when the tag scan stopped early", async () => {
    on("get", "/tags", ok(list(tags, { scan: { scanned: 10000, complete: false } })));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL))).toBe(
      "2 tags: copy (12), mobile (5). The tag scan stopped after 10,000 comments, so some tags or counts may be missing. Give a project for a full answer on one site.",
    );
  });

  it("says how to page on with next_cursor, and to add counts up by tag id across pages", async () => {
    on("get", "/projects/:project/tags", ok(list(tags, { scan: { scanned: 10000, complete: false }, next_cursor: "t2" })), ok(list([tags[0]], { scan: { scanned: 300, complete: true } })));
    const h = await connect();
    const first = summaryOf(await h.call(TOOL, { project: "Acme Dental" }));
    expect(first).toBe(
      '2 tags: copy (12), mobile (5). This page read 10,000 comments and more remain: call superflow_list_tags again with {"project":"Acme Dental","cursor":"t2"} for the next page. A tag can show on several pages: add up usage_count by tag id, or say these counts cover only the pages read.',
    );
    const last = summaryOf(await h.call(TOOL, { project: "Acme Dental", cursor: "t2" }));
    expect(last).toBe("1 tag: copy (12) on this page. This was the last page.");
    expect(recorded.map((r) => r.query)).toEqual([{}, { cursor: "t2" }]);
  });

  it("uses the project route when a project is given", async () => {
    on("get", "/projects/:project/tags", ok(list(tags)));
    const h = await connect();
    await h.call(TOOL, { project: "Acme Dental" });
    expect(recorded[0]?.operationId).toBe("listProjectTags");
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme" },
    method: "get",
    path: "/projects/:project/tags",
    success: ok(list(tags)),
  });
});
