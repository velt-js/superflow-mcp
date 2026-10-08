import { describe, expect, it } from "vitest";
import { fullComment } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_push_comment";
const pushed = { comment: "cmt_8f3k2", link: { type: "jira", key: "WEB-42", url: "https://acme.atlassian.net/browse/WEB-42" } };

describe(TOOL, () => {
  it("resolves a comment number to its id, then pushes it with a generated idempotency key", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    on("post", "/comments/:comment/push", ok(pushed, 201));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "#4821", project: "Acme Dental", integration: "int_7g8h9i", project_key: "WEB" });
    expect(data(result)).toEqual(pushed);
    expect(summaryOf(result)).toBe(
      "Created Jira WEB-42 from comment cmt_8f3k2: https://acme.atlassian.net/browse/WEB-42. The customer's team can see it in their tool. The link is saved on the comment.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["getComment", "pushComment"]);
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental", include_replies: "false" });
    expect(recorded[1]?.path).toBe("/comments/cmt_8f3k2/push");
    expect(recorded[1]?.body).toEqual({ integration: "int_7g8h9i", project_key: "WEB", idempotency_key: expect.any(String) });
  });

  it("pushes an id directly, with the caller's title and key", async () => {
    on("post", "/comments/:comment/push", ok(pushed, 201));
    const h = await connect({ defaultProject: "Acme Dental" });
    await h.call(TOOL, { comment: "cmt_8f3k2", integration: "Acme Jira", title: "Fix nav overlap", idempotency_key: "k-1" });
    expect(recorded.map((r) => r.operationId)).toEqual(["pushComment"]);
    expect(recorded[0]?.body).toEqual({ integration: "Acme Jira", title: "Fix nav overlap", idempotency_key: "k-1" });
  });

  it("uses the default project to resolve a number", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    on("post", "/comments/:comment/push", ok(pushed, 201));
    const h = await connect({ defaultProject: "Acme Dental" });
    await h.call(TOOL, { comment: "4821", integration: "int_7g8h9i" });
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental", include_replies: "false" });
    expect(recorded[1]?.path).toBe("/comments/cmt_8f3k2/push");
  });

  it("passes a bare number through when no project is known", async () => {
    on("post", "/comments/:comment/push", ok(pushed, 201));
    const h = await connect();
    await h.call(TOOL, { comment: "#4821", integration: "int_7g8h9i" });
    expect(recorded.map((r) => r.path)).toEqual(["/comments/4821/push"]);
  });

  it("passes the connect hint through when the tool is not connected", async () => {
    on(
      "post",
      "/comments/:comment/push",
      fail(400, { code: "invalid", message: "Jira is not connected to this workspace.", hint: "Connect it with superflow_connect_integration." }),
    );
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { comment: "cmt_8f3k2", integration: "int_7g8h9i" }))).toMatchObject({
      code: "invalid",
      hint: "Connect it with superflow_connect_integration.",
    });
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "cmt_8f3k2", integration: "int_7g8h9i" },
    method: "post",
    path: "/comments/:comment/push",
    success: ok(pushed, 201),
  });
});
