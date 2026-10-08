import { describe, expect, it } from "vitest";
import { compactComment, fullComment, list, page, project, projectFull } from "../helpers/fixtures.ts";
import { connect, ok, on, recorded, useMsw } from "../helpers/harness.ts";

useMsw();

function json(result: { contents: Array<{ text?: unknown; mimeType?: string }> }): unknown {
  const first = result.contents[0];
  expect(first?.mimeType).toBe("application/json");
  return JSON.parse(String(first?.text));
}

describe("resources", () => {
  it("superflow://projects returns the first page of projects", async () => {
    on("get", "/projects", ok(list([project])));
    const h = await connect();
    expect(json(await h.client.readResource({ uri: "superflow://projects" }))).toEqual(list([project]));
    expect(recorded[0]?.query).toEqual({ include_archived: "false", limit: "25" });
  });

  it("superflow://projects/{project} returns { project, pages }", async () => {
    on("get", "/projects/:project", ok(projectFull));
    on("get", "/projects/:project/pages", ok(list([page])));
    const h = await connect();
    const body = json(await h.client.readResource({ uri: "superflow://projects/Acme%20Dental" }));
    expect(body).toEqual({ project: projectFull, pages: list([page]) });
    expect(recorded.map((r) => r.path).sort()).toEqual(["/projects/Acme%20Dental", "/projects/Acme%20Dental/pages"]);
  });

  it("superflow://projects/{project}/comments accepts any subset of the query variables", async () => {
    on("get", "/comments", ok(list([compactComment])));
    const h = await connect();
    const body = json(
      await h.client.readResource({ uri: "superflow://projects/prj_1a2b/comments?assignee=me&status=open,In%20progress" }),
    );
    expect(body).toEqual(list([compactComment]));
    expect(recorded[0]?.query).toEqual({
      project: "prj_1a2b",
      status: "open,In progress",
      assignee: "me",
      limit: "25",
      fields: "compact",
    });

    await h.client.readResource({ uri: "superflow://projects/prj_1a2b/comments" });
    expect(recorded[1]?.query).toEqual({ project: "prj_1a2b", limit: "25", fields: "compact" });
  });

  it("superflow://comments/{comment} returns the full comment and uses the default project", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect({ defaultProject: "Acme Dental" });
    expect(json(await h.client.readResource({ uri: "superflow://comments/4821" }))).toEqual(fullComment);
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental", include_replies: "true" });
  });

  it("fails the read with the API message on an error", async () => {
    on("get", "/comments/:comment", () =>
      Response.json(
        { error: { code: "not_found", message: "No comment #4821.", hint: "", candidates: [] } },
        { status: 404 },
      ),
    );
    const h = await connect();
    await expect(h.client.readResource({ uri: "superflow://comments/4821" })).rejects.toThrow(/No comment #4821/);
  });
});
