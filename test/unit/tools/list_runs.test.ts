import { describe, expect, it } from "vitest";
import { doneRun, list } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_runs";

describe(TOOL, () => {
  it("lists runs with filters and pagination", async () => {
    const body = list([doneRun], { next_cursor: "c2" });
    on("get", "/runs", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", status: "done", since: "7d", limit: 5 });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe(
      "Found 1 run. Latest: Run run_8f3k2 on Acme Dental: done. 5 findings from 2 agents (Proofreader, Legal footer). Credits charged: 10. Read them with superflow_list_findings. Showing 1. More results exist. Call again with cursor=c2 for more.",
    );
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental", status: "done", since: "7d", limit: "5" });
  });

  it("defaults the limit to 25", async () => {
    on("get", "/runs", ok(list([])));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL))).toBe("Found 0 runs.");
    expect(recorded[0]?.query).toEqual({ limit: "25" });
  });

  it("rejects a bad date before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { since: "last tuesday" })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/runs", success: ok(list([doneRun])) });
});
