import { describe, expect, it } from "vitest";
import { guest, list } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_guests";

describe(TOOL, () => {
  it("lists the project's guests", async () => {
    on("get", "/projects/:project/guests", ok(list([guest])));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(data(result)).toEqual(list([guest]));
    expect(summaryOf(result)).toBe('1 guest on project "Acme Dental": Dana Client (dana@acme.com).');
    expect(recorded[0]?.operationId).toBe("listProjectGuests");
    expect(recorded[0]?.query).toEqual({});
  });

  it("handles a project without guests", async () => {
    on("get", "/projects/:project/guests", ok(list([])));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { project: "Acme Dental" }))).toBe('0 guests on project "Acme Dental".');
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme" },
    method: "get",
    path: "/projects/:project/guests",
    success: ok(list([guest])),
  });
});
