import { describe, expect, it } from "vitest";
import { organization } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_organization";

describe(TOOL, () => {
  it("returns the workspace with seats, projects and credits", async () => {
    on("get", "/organization", ok(organization));
    const h = await connect();
    const result = await h.call(TOOL);
    expect(data(result)).toEqual(organization);
    expect(summaryOf(result)).toBe(
      "Wonderist: scale plan, owner Rakesh. Members: 4 of 10 seats used, 1 invited. Guests: 12 of unlimited. Projects: 7 of 20. AI credits: 1,234 left (auto refill on).",
    );
    expect(recorded[0]?.operationId).toBe("getOrganization");
  });

  it("handles a workspace without credits", async () => {
    on("get", "/organization", ok({ ...organization, credits: null }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL))).toContain("AI credits: not available.");
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/organization", success: ok(organization) });
});
