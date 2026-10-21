import { describe, expect, it } from "vitest";
import { project, projectDetail } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_project";

describe(TOOL, () => {
  it("returns the project with settings and install, and summarizes it", async () => {
    on("get", "/projects/:project", ok(projectDetail));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual(projectDetail);
    expect(summaryOf(result)).toBe(
      `Project Acme Dental (https://acme.com): installed and verified, webflow, 12 open of 40 comments, 3 members and 2 guests. Settings: guest comments on. Link: ${project.url}`,
    );
    expect(recorded[0]?.operationId).toBe("getProject");
    expect(recorded[0]?.path).toBe("/projects/Acme%20Dental");
  });

  it("mentions archived projects and switched-off settings", async () => {
    on(
      "get",
      "/projects/:project",
      ok({ ...projectDetail, archived: true, settings: { ...projectDetail.settings, comments_disabled: true, toolbar_enabled: false } }),
    );
    const h = await connect();
    const summary = summaryOf(await h.call(TOOL, { project: "prj_1a2b" }));
    expect(summary).toContain("webflow, archived,");
    expect(summary).toContain("Settings: guest comments on, commenting turned off, toolbar hidden.");
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme" },
    method: "get",
    path: "/projects/:project",
    success: ok(projectDetail),
  });
});
