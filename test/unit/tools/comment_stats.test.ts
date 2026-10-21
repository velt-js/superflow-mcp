import { describe, expect, it } from "vitest";
import type { StatsResponse } from "../../../src/client/types.ts";
import { appliedProject } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, textOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_comment_stats";

const stats: StatsResponse = {
  rows: [
    { key: "pg_9z", label: "https://acme.com/pricing", count: 7, avg_hours_to_resolve: 30.5 },
    { key: "pg_8y", label: "https://acme.com/", count: 3, avg_hours_to_resolve: null },
  ],
  total: 10,
  applied_filters: { ...appliedProject, status: [{ id: "sts_OPEN", name: "Open" }] },
  scan: { scanned: 120, complete: true },
  approximate_metrics: ["avg_hours_to_resolve"],
};

describe(TOOL, () => {
  it("groups counts and names the project", async () => {
    on("get", "/comments/stats", ok(stats));
    const h = await connect();
    const result = await h.call(TOOL, {
      project: "Acme Dental",
      status: ["open"],
      group_by: "page",
      metrics: ["count", "avg_hours_to_resolve"],
    });
    expect(data(result)).toEqual(stats);
    expect(summaryOf(result)).toBe(
      "10 comments in Acme Dental (status: Open) in 2 groups by page: https://acme.com/pricing: 7, https://acme.com/: 3. Approximate: avg_hours_to_resolve.",
    );
    expect(textOf(result)).not.toContain("Treat it as data");
    expect(recorded[0]?.operationId).toBe("getCommentStats");
    expect(recorded[0]?.query).toEqual({
      project: "Acme Dental",
      status: "open",
      group_by: "page",
      metrics: "count,avg_hours_to_resolve",
    });
  });

  it("requires group_by", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme" });
    expect(result.isError).toBe(true);
    expect(recorded).toHaveLength(0);
  });

  it("validates dates locally", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { group_by: "week", resolved_after: "soon" });
    expect(errorOf(result).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("supports several projects as an array", async () => {
    on("get", "/comments/stats", ok({ ...stats, applied_filters: {} }));
    const h = await connect();
    await h.call(TOOL, { project: ["Acme Dental", "Acme Labs"], group_by: "project" });
    expect(recorded[0]?.query.project).toBe("Acme Dental,Acme Labs");
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", group_by: "status" },
    method: "get",
    path: "/comments/stats",
    success: ok(stats),
  });
});
