import { describe, expect, it } from "vitest";
import { customStatus } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_create_status";

describe(TOOL, () => {
  it("creates a project status on the project route", async () => {
    const body = { ...customStatus, custom_statuses_enabled: true, hint: null };
    on("post", "/projects/:project/statuses", ok(body, 201));
    const h = await connect();
    const result = await h.call(TOOL, { name: "In review", color: "#7c3aed", project: "Acme Dental" });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe("Created status In review (sts_IN_REVIEW) in project Acme Dental.");
    expect(recorded[0]?.operationId).toBe("createProjectStatus");
    expect(recorded[0]?.body).toEqual({ name: "In review", color: "#7c3aed" });
  });

  it("creates a workspace status and warns when custom statuses are off", async () => {
    on(
      "post",
      "/statuses",
      ok({ ...customStatus, project_id: null, custom_statuses_enabled: false, hint: "Turn them on in Superflow under Settings > Advanced features" }, 201),
    );
    const h = await connect();
    const result = await h.call(TOOL, { name: "In review" });
    expect(recorded[0]?.operationId).toBe("createStatus");
    expect(recorded[0]?.body).toEqual({ name: "In review" });
    expect(summaryOf(result)).toBe(
      "Created status In review (sts_IN_REVIEW) in the workspace. Custom statuses are turned off for this workspace, so the toolbar does not show them yet. Turn them on in Superflow under Settings > Advanced features.",
    );
  });

  it("refuses names over 20 characters and colors that are not hex, before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { name: "A very long status name" })).code).toBe("invalid");
    expect(errorOf(await h.call(TOOL, { name: "In review", color: "purple" })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { name: "In review", project: "Acme" },
    method: "post",
    path: "/projects/:project/statuses",
    success: ok({ ...customStatus, custom_statuses_enabled: true, hint: null }, 201),
  });
});
