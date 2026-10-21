import { describe, expect, it } from "vitest";
import { list, statuses } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_statuses";

describe(TOOL, () => {
  it("lists workspace statuses and marks the resolved ones", async () => {
    on("get", "/statuses", ok(list(statuses)));
    const h = await connect();
    const result = await h.call(TOOL);
    expect(data(result)).toEqual(list(statuses));
    expect(summaryOf(result)).toBe("3 statuses: Open, In progress, Resolved (resolved).");
    expect(recorded[0]?.operationId).toBe("listStatuses");
  });

  it("uses the project route when a project is given", async () => {
    on("get", "/projects/:project/statuses", ok(list(statuses)));
    const h = await connect();
    await h.call(TOOL, { project: "prj_1a2b" });
    expect(recorded[0]?.operationId).toBe("listProjectStatuses");
    expect(recorded[0]?.path).toBe("/projects/prj_1a2b/statuses");
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme" },
    method: "get",
    path: "/projects/:project/statuses",
    success: ok(list(statuses)),
  });
});
