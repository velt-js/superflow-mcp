import { describe, expect, it } from "vitest";
import { project } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_archive_project";
const archived = { project: { ...project, archived: true }, changed: true };

describe(TOOL, () => {
  it("archives the project", async () => {
    on("post", "/projects/:project/archive", ok(archived));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(data(result)).toEqual(archived);
    expect(summaryOf(result)).toBe(`Archived project Acme Dental. Link: ${project.url}`);
    expect(recorded[0]?.operationId).toBe("archiveProject");
    expect(recorded[0]?.body).toEqual({});
  });

  it("is a no-op when already archived", async () => {
    on("post", "/projects/:project/archive", ok({ ...archived, changed: false }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(summaryOf(result)).toBe(`Project Acme Dental was already archived. Nothing changed. Link: ${project.url}`);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme" },
    method: "post",
    path: "/projects/:project/archive",
    success: ok(archived),
  });
});
