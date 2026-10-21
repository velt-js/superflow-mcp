import { describe, expect, it } from "vitest";
import { organization } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_organization";
const renamed = { ...organization, name: "Wonderist Studio" };

describe(TOOL, () => {
  it("renames the workspace", async () => {
    on("patch", "/organization", ok(renamed));
    const h = await connect();
    const result = await h.call(TOOL, { name: "Wonderist Studio" });
    expect(data(result)).toEqual(renamed);
    expect(summaryOf(result)).toBe("Renamed the workspace to Wonderist Studio.");
    expect(recorded[0]?.body).toEqual({ name: "Wonderist Studio" });
  });

  it("passes the owner-only refusal through", async () => {
    on("patch", "/organization", fail(403, { code: "forbidden", message: "Only the workspace owner can rename the workspace." }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { name: "X" })).message).toBe("Only the workspace owner can rename the workspace.");
  });

  it("refuses an empty name", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { name: "" })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({ tool: TOOL, args: { name: "Wonderist Studio" }, method: "patch", path: "/organization", success: ok(renamed) });
});
