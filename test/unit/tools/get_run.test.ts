import { describe, expect, it } from "vitest";
import { doneRun, runningRun } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_run";

describe(TOOL, () => {
  it("says a running run is still going and when to check again", async () => {
    on("get", "/runs/:run", ok(runningRun));
    const h = await connect();
    const result = await h.call(TOOL, { run: "run_8f3k2" });
    expect(data(result)).toEqual(runningRun);
    expect(summaryOf(result)).toBe(
      "Run run_8f3k2 on Acme Dental: running (1 of 2 agents finished). Credits charged: 10. Check again with superflow_get_run in 20 seconds or more; it is finished when the status is done, failed or partial.",
    );
    expect(recorded[0]?.path).toBe("/runs/run_8f3k2");
  });

  it("summarizes a finished run and points at the findings", async () => {
    on("get", "/runs/:run", ok(doneRun));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { run: "run_8f3k2" }))).toBe(
      "Run run_8f3k2 on Acme Dental: done. 5 findings from 2 agents (Proofreader, Legal footer). Credits charged: 10. Read them with superflow_list_findings.",
    );
  });

  it("explains a partial run", async () => {
    on("get", "/runs/:run", ok({ ...doneRun, status: "partial", findings_count: 0 }));
    const h = await connect();
    const summary = summaryOf(await h.call(TOOL, { run: "run_8f3k2" }));
    expect(summary).toContain(": partial. 0 findings");
    expect(summary).toContain("Some agents did not finish");
    expect(summary).not.toContain("superflow_list_findings");
  });

  standardErrorCases({ tool: TOOL, args: { run: "run_8f3k2" }, method: "get", path: "/runs/:run", success: ok(doneRun) });
});
