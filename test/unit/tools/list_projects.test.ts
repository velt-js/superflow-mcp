import { describe, expect, it } from "vitest";
import { list, project } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_projects";

describe(TOOL, () => {
  it("lists projects with a summary and pagination", async () => {
    const body = list([project], { next_cursor: "p2" });
    on("get", "/projects", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, { query: "acme" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe(
      "Found 1 project: Acme Dental. Showing 1. More results exist. Call again with cursor=p2 for more.",
    );
    expect(recorded[0]?.query).toEqual({ query: "acme", include_archived: "false", limit: "25" });
  });

  it("passes include_archived, limit and cursor", async () => {
    on("get", "/projects", ok(list([])));
    const h = await connect();
    await h.call(TOOL, { include_archived: true, limit: 5, cursor: "p2" });
    expect(recorded[0]?.query).toEqual({ include_archived: "true", limit: "5", cursor: "p2" });
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/projects", success: ok(list([project])) });
});
