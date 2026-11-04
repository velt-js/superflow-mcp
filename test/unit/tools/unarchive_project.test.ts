import { describe, expect, it } from "vitest";
import { project } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_unarchive_project";
const restored = { project: { ...project, install_status: "installed" }, changed: true };

describe(TOOL, () => {
  it("unarchives and reports the restored install status", async () => {
    on("post", "/projects/:project/unarchive", ok(restored));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(data(result)).toEqual(restored);
    expect(summaryOf(result)).toBe(`Unarchived project Acme Dental. Install status: installed. Link: ${project.url}`);
    expect(recorded[0]?.operationId).toBe("unarchiveProject");
    expect(recorded[0]?.body).toBeUndefined();
  });

  it("is a no-op when the project is active", async () => {
    on("post", "/projects/:project/unarchive", ok({ ...restored, changed: false }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { project: "Acme Dental" }))).toBe(
      `Project Acme Dental was already active. Nothing changed. Link: ${project.url}`,
    );
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme" },
    method: "post",
    path: "/projects/:project/unarchive",
    success: ok(restored),
  });
});
