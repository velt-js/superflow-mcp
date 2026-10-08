import { describe, expect, it } from "vitest";
import { UNTRUSTED_NOTICE } from "../../../src/lib/format.ts";
import { appliedProject, compactComment, list } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, textOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_comments";

describe(TOOL, () => {
  it("returns compact rows, applied filters, pagination and the untrusted notice", async () => {
    const body = list([compactComment], {
      next_cursor: "c_2",
      total: 140,
      applied_filters: { ...appliedProject, status: [{ id: "sts_OPEN", name: "Open" }], page_url: "https://acme.com/pricing" },
      scan: { scanned: 500, complete: true },
    });
    on("get", "/comments", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, {
      project: "Acme Dental",
      status: ["open"],
      page_url: "acme.com/pricing",
      page_match: "prefix",
      tags: ["copy", "mobile"],
      has_replies: false,
    });

    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual(body);
    const summary = summaryOf(result);
    expect(summary).toContain("140 comments match in Acme Dental");
    expect(summary).toContain("Showing 1 of 140. Call again with cursor=c_2 for more.");
    expect(textOf(result).split("\n")[1]).toBe(UNTRUSTED_NOTICE);

    const request = recorded[0];
    expect(request?.operationId).toBe("listComments");
    expect(request?.query).toEqual({
      project: "Acme Dental",
      status: "open",
      page_url: "acme.com/pricing",
      page_match: "prefix",
      tags: "copy,mobile",
      has_replies: "false",
      limit: "25",
      fields: "compact",
    });
  });

  it("passes cursor, sort, limit and fields through", async () => {
    on("get", "/comments", ok(list([])));
    const h = await connect();
    await h.call(TOOL, { cursor: "abc", sort: "created_asc", limit: 100, fields: "full", unanswered: true, stale_days: 3 });
    expect(recorded[0]?.query).toEqual({
      cursor: "abc",
      sort: "created_asc",
      limit: "100",
      fields: "full",
      unanswered: "true",
      stale_days: "3",
    });
  });

  it("says when the scan stopped early", async () => {
    on("get", "/comments", ok(list([compactComment], { scan: { scanned: 10000, complete: false } })));
    const h = await connect();
    const result = await h.call(TOOL, {});
    expect(summaryOf(result)).toContain("scanned 10,000 comments and stopped early");
  });

  it("rejects a bad date before calling the API", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { created_after: "last tuesday" });
    expect(errorOf(result).code).toBe("invalid");
    expect(errorOf(result).message).toContain("created_after");
    expect(recorded).toHaveLength(0);
  });

  it("accepts relative date tokens", async () => {
    on("get", "/comments", ok(list([])));
    const h = await connect();
    const result = await h.call(TOOL, { updated_after: "7d", created_before: "2026-10-01" });
    expect(result.isError).toBeFalsy();
    expect(recorded[0]?.query.updated_after).toBe("7d");
  });

  it("rejects a limit over 100 through the schema", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { limit: 500 });
    expect(result.isError).toBe(true);
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({ tool: TOOL, args: { project: "Acme" }, method: "get", path: "/comments", success: ok(list([compactComment])) });
});
