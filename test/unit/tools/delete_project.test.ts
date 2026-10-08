import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_PROJECT_MESSAGE } from "../../../src/lib/confirm.ts";
import { emptyPage, list, page, project, projectDetail } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_project";

describe(TOOL, () => {
  it("without confirm, only reads the project and its pages and returns a preview", async () => {
    on("get", "/projects/:project", ok(projectDetail));
    on("get", "/projects/:project/pages", ok(list([page, emptyPage])));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { project: projectDetail, comment_count: 40, page_count: 2 },
      message: CONFIRM_DELETE_PROJECT_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      `Project Acme Dental (https://acme.com) would be deleted permanently with 40 comments and 2 pages. Nothing was deleted. Ask the user to confirm. Link: ${project.url}`,
    );
    expect(recorded.map((r) => r.method)).toEqual(["GET", "GET"]);
    expect(recorded.find((r) => r.operationId === "listProjectPages")?.query).toEqual({ with_counts: "false", limit: "100" });
    expect(writes()).toEqual([]);
  });

  it("says the page count is a minimum when there are more pages", async () => {
    on("get", "/projects/:project", ok(projectDetail));
    on("get", "/projects/:project/pages", ok(list([page], { next_cursor: "c2" })));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", confirm: false });
    expect((data(result).preview as Record<string, unknown>).page_count_is_minimum).toBe(true);
    expect(summaryOf(result)).toContain("with 40 comments and at least 1 page.");
    expect(writes()).toEqual([]);
  });

  it("returns the read error and sends nothing else when the project is unknown", async () => {
    on("get", "/projects/:project", fail(404, { code: "not_found", message: "No project Acme." }));
    on("get", "/projects/:project/pages", fail(404, { code: "not_found", message: "No project Acme." }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme" });
    expect(errorOf(result).code).toBe("not_found");
    expect(writes()).toEqual([]);
  });

  it("deletes with confirm: true, sending confirm=true", async () => {
    on("delete", "/projects/:project", ok({ deleted: true, id: "prj_1a2b" }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", confirm: true });
    expect(data(result)).toEqual({ deleted: true, id: "prj_1a2b" });
    expect(summaryOf(result)).toBe("Deleted project Acme Dental (prj_1a2b) permanently.");
    expect(recorded.map((r) => [r.method, r.query])).toEqual([["DELETE", { confirm: "true" }]]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", confirm: true },
    method: "delete",
    path: "/projects/:project",
    success: ok({ deleted: true, id: "prj_1a2b" }),
  });
});
