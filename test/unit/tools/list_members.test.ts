import { describe, expect, it } from "vitest";
import { guest, list, member } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_members";

describe(TOOL, () => {
  it("lists workspace members without a project", async () => {
    on("get", "/members", ok(list([member])));
    const h = await connect();
    const result = await h.call(TOOL, { query: "jen" });
    expect(summaryOf(result)).toBe("Found 1 member and 0 guests.");
    expect(recorded[0]?.operationId).toBe("listMembers");
    expect(recorded[0]?.query).toEqual({ query: "jen" });
  });

  it("includes guests when a project is given", async () => {
    const body = list([member, guest]);
    on("get", "/projects/:project/members", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe('Found 1 member and 1 guest for project "Acme Dental".');
    expect(recorded[0]?.operationId).toBe("listProjectMembers");
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme" },
    method: "get",
    path: "/projects/:project/members",
    success: ok(list([member])),
  });
});
