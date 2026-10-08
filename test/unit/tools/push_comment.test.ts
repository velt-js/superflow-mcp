import { describe, expect, it } from "vitest";
import { fullComment } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_push_comment";
const link = { type: "jira", key: "WEB-42", url: "https://example.atlassian.net/browse/WEB-42" };
const pushed = { comment: { ...fullComment, external_links: [link] }, link };

describe(TOOL, () => {
  it("resolves a comment number to its id, then pushes it with a generated idempotency key", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    on("post", "/comments/:comment/push", ok(pushed, 201));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "#4821", project: "Acme Dental", integration: "int_7g8h9i", project_key: "WEB:10001" });
    expect(data(result)).toEqual(pushed);
    expect(summaryOf(result)).toBe(
      "Created Jira WEB-42 from comment #4821: https://example.atlassian.net/browse/WEB-42. The customer's team can see it in their tool. The link is saved on the comment.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["getComment", "pushComment"]);
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental", include_replies: "false" });
    expect(recorded[1]?.path).toBe("/comments/cmt_8f3k2/push");
    expect(recorded[1]?.body).toEqual({ integration: "int_7g8h9i", project_key: "WEB:10001", idempotency_key: expect.any(String) });
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

  it("passes the connect hint through when the connection is not set up to create items", async () => {
    const hint = "Connect it in Superflow under Settings > Integrations (superflow_connect_integration returns the link), then retry.";
    on(
      "post",
      "/comments/:comment/push",
      fail(400, { code: "invalid", message: "The asana connection Acme Asana is not set up to create items from Superflow yet.", hint }),
    );
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { comment: "cmt_8f3k2", integration: "Acme Asana", project_key: "1200:3400" }));
    expect(error).toMatchObject({ code: "invalid", hint });
    expect(recorded).toHaveLength(1);
  });

  it("hands back its idempotency key when the push times out, so a retry cannot create a second item", async () => {
    on(
      "post",
      "/comments/:comment/push",
      fail(502, { code: "upstream", message: "The jira item did not finish within 20 seconds.", hint: "Retry with the same idempotency_key." }),
    );
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { comment: "cmt_8f3k2", integration: "int_7g8h9i", idempotency_key: "k-push" }));
    expect(error.code).toBe("upstream");
    expect(error.hint).toBe(
      'Retry with the same idempotency_key. To check again without creating a second item, call superflow_push_comment with the same arguments and idempotency_key "k-push".',
    );
    // The client retried the 502 with the same key, which is safe.
    expect(new Set(recorded.map((r) => (r.body as { idempotency_key: string }).idempotency_key))).toEqual(new Set(["k-push"]));
  });

  it("refuses a target with spaces before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { comment: "cmt_8f3k2", integration: "int_7g8h9i", project_key: "WEB 10001" })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "cmt_8f3k2", integration: "int_7g8h9i" },
    method: "post",
    path: "/comments/:comment/push",
    success: ok(pushed, 201),
  });
});
