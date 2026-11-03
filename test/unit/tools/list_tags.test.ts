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
