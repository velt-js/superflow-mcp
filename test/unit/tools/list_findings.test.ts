import { describe, expect, it } from "vitest";
import { UNTRUSTED_NOTICE } from "../../../src/lib/format.ts";
import { finding, list } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, textOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_findings";

describe(TOOL, () => {
  it("lists a run's findings with counts by severity and the untrusted notice", async () => {
    const second = { ...finding, id: "cmt_f3", number: 4902 };
    const low = { ...finding, id: "cmt_f2", number: 4901, severity: "low" };
    const body = list([finding, second, low], { total: 3 });
    on("get", "/runs/:run/findings", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, { run: "run_8f3k2", severity: ["high", "low"], limit: 50 });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe("Run run_8f3k2 has 3 findings with severity high, low. By severity: high 2, low 1.");
    expect(textOf(result).split("\n")[1]).toBe(UNTRUSTED_NOTICE);
    expect(recorded[0]?.path).toBe("/runs/run_8f3k2/findings");
    expect(recorded[0]?.query).toEqual({ severity: "high,low", limit: "50" });
  });

  it("pages with the cursor", async () => {
    on("get", "/runs/:run/findings", ok(list([finding], { next_cursor: "c2" })));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { run: "run_8f3k2", cursor: "c1" }))).toBe(
      "Found 1 finding from run run_8f3k2. By severity: high 1. Showing 1. More results exist. Call again with cursor=c2 for more.",
    );
    expect(recorded[0]?.query).toEqual({ limit: "25", cursor: "c1" });
  });

  standardErrorCases({
    tool: TOOL,
    args: { run: "run_8f3k2" },
    method: "get",
    path: "/runs/:run/findings",
    success: ok(list([finding])),
  });
});
