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
