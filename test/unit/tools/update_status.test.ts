import { describe, expect, it } from "vitest";
import { customStatus } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, seen, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_status";

describe(TOOL, () => {
  it("renames a project status", async () => {
    const body = { ...customStatus, name: "Client review", custom_statuses_enabled: true };
    on("patch", "/statuses/:status", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, { status: "In review", project: "Acme Dental", name: "Client review" });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe("Updated status Client review (sts_IN_REVIEW) in project Acme Dental.");
    expect(recorded[0]?.path).toBe("/statuses/In%20review");
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental" });
    expect(recorded[0]?.body).toEqual({ name: "Client review" });
  });

  it("recolors a workspace status without a project", async () => {
    on("patch", "/statuses/:status", ok({ ...customStatus, color: "#000000" }));
    const h = await connect();
    await h.call(TOOL, { status: "sts_IN_REVIEW", color: "#000000" });
    expect(recorded[0]?.query).toEqual({});
    expect(recorded[0]?.body).toEqual({ color: "#000000" });
  });

  it("refuses an empty change", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { status: "In review" })).code).toBe("invalid");
    expect(seen).toEqual([]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { status: "In review", name: "Review" },
    method: "patch",
    path: "/statuses/:status",
    success: ok(customStatus),
  });
});
