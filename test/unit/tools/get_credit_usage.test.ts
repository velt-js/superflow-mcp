import { describe, expect, it } from "vitest";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_credit_usage";
const usage = {
  rows: [
    { key: "agt_proof", label: "Proofreader", credits: 420, runs: 14 },
    { key: "agt_a11y", label: "Accessibility", credits: 180, runs: 6 },
  ],
  total_credits: 600,
  applied_filters: { since: "2026-10-06T00:00:00Z", group_by: "agent" },
  scan: { scanned: 20, complete: true },
};

describe(TOOL, () => {
  it("groups credit usage and sends the dates through", async () => {
    on("get", "/organization/credits/usage", ok(usage));
    const h = await connect();
    const result = await h.call(TOOL, { group_by: "agent", since: "this_week" });
    expect(data(result)).toEqual(usage);
    expect(summaryOf(result)).toBe(
      "600 AI credits over 20 runs since 2026-10-06T00:00:00Z, by agent: Proofreader: 420, Accessibility: 180.",
    );
    expect(recorded[0]?.query).toEqual({ group_by: "agent", since: "this_week" });
  });

  it("says when the ledger scan stopped early", async () => {
    on("get", "/organization/credits/usage", ok({ ...usage, scan: { scanned: 10000, complete: false } }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { group_by: "day" }))).toContain(
      "The API read 10,000 ledger entries and stopped early, so the totals may be low.",
    );
  });

  it("rejects a bad date before calling the API", async () => {
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { group_by: "project", until: "next tuesday" }));
    expect(error.code).toBe("invalid");
    expect(error.message).toContain('until "next tuesday"');
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { group_by: "project" },
    method: "get",
    path: "/organization/credits/usage",
    success: ok(usage),
  });
});
