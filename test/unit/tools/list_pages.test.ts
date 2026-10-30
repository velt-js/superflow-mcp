import { describe, expect, it } from "vitest";
import { emptyPage, list, page } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_pages";

describe(TOOL, () => {
  it("lists pages with counts and URL-encodes the project", async () => {
    const body = list([page, emptyPage], { next_cursor: null });
    on("get", "/projects/:project/pages", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe('Found 2 pages in project "Acme Dental". 4 open comments across them; 1 page with no comments.');
    expect(recorded[0]?.path).toBe("/projects/Acme%20Dental/pages");
    expect(recorded[0]?.query).toEqual({ with_counts: "true", limit: "25" });
  });

  it("encodes a site URL used as the project", async () => {
    on("get", "/projects/:project/pages", ok(list([])));
    const h = await connect();
    await h.call(TOOL, { project: "https://acme.com/", with_counts: false });
    expect(recorded[0]?.path).toBe("/projects/https%3A%2F%2Facme.com%2F/pages");
    expect(recorded[0]?.query.with_counts).toBe("false");
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme" },
    method: "get",
    path: "/projects/:project/pages",
    success: ok(list([page])),
  });
});
