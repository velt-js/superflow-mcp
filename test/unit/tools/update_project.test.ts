import { describe, expect, it } from "vitest";
import { projectDetail } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, seen, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_project";

describe(TOOL, () => {
  it("sends only the fields given", async () => {
    on("patch", "/projects/:project", ok(projectDetail));
    const h = await connect();
    const result = await h.call(TOOL, {
      project: "Acme Dental",
      settings: { guest_comments: true, guest_sign_in: false },
      add_domains: ["staging.acme.com"],
    });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual(projectDetail);
    expect(recorded[0]?.body).toEqual({
      settings: { guest_comments: true, guest_sign_in: false },
      add_domains: ["staging.acme.com"],
    });
    expect(summaryOf(result)).toMatch(/^Updated\. Project Acme Dental \(https:\/\/acme\.com\): /);
  });

  it("renames a project", async () => {
    on("patch", "/projects/:project", ok({ ...projectDetail, name: "Acme Dental Group" }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "prj_1a2b", name: "Acme Dental Group" });
    expect(recorded[0]?.body).toEqual({ name: "Acme Dental Group" });
    expect(summaryOf(result)).toContain("Updated. Project Acme Dental Group");
  });

  it("refuses an empty change, and explains that the site URL cannot change", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", settings: {}, site_url: "https://new.acme.com" });
    const error = errorOf(result);
    expect(error.code).toBe("invalid");
    expect(error.hint).toContain("The site URL cannot change");
    expect(seen).toEqual([]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", name: "Acme Dental" },
    method: "patch",
    path: "/projects/:project",
    success: ok(projectDetail),
  });
});
