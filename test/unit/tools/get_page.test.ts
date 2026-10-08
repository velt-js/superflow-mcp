import { describe, expect, it } from "vitest";
import { page } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_page";

describe(TOOL, () => {
  it("returns one page with counts, encoding a URL in the path", async () => {
    on("get", "/projects/:project/pages/:page", ok(page));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", page: "https://acme.com/pricing" });
    expect(data(result)).toEqual(page);
    expect(summaryOf(result)).toBe(
      'Page https://acme.com/pricing ("Pricing") in Acme Dental: 4 open of 9 comments. Last comment 2026-10-07T18:02:11Z.',
    );
    expect(recorded[0]?.path).toBe("/projects/Acme%20Dental/pages/https%3A%2F%2Facme.com%2Fpricing");
    expect(recorded[0]?.operationId).toBe("getPage");
  });

  it("handles pages without counts", async () => {
    on("get", "/projects/:project/pages/:page", ok({ ...page, open_comment_count: null, total_comment_count: null, last_comment_at: null }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { project: "Acme Dental", page: "/pricing" }))).toBe(
      'Page https://acme.com/pricing ("Pricing") in Acme Dental: comment counts unknown.',
    );
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", page: "/pricing" },
    method: "get",
    path: "/projects/:project/pages/:page",
    success: ok(page),
  });
});
