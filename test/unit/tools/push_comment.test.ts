import { describe, expect, it } from "vitest";
import { fullComment } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_push_comment";
const link = { type: "jira", key: "WEB-42", url: "https://example.atlassian.net/browse/WEB-42" };
const pushed = { comment: { ...fullComment, external_links: [link] }, link, already_linked: false };

describe(TOOL, () => {
  it("pushes a comment with a generated idempotency key, in one request", async () => {
    on("post", "/comments/:comment/push", ok(pushed, 201));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", project: "Acme Dental", integration: "int_7g8h9i", project_key: "WEB:10001" });
    expect(data(result)).toEqual(pushed);
    expect(summaryOf(result)).toBe(
      "Created Jira WEB-42 from comment cmt_8f3k2: https://example.atlassian.net/browse/WEB-42. The customer's team can see it in their tool. The link is saved on the comment.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["pushComment"]);
    expect(recorded[0]?.path).toBe("/comments/cmt_8f3k2/push");
    expect(recorded[0]?.body).toEqual({
      integration: "int_7g8h9i",
      project: "Acme Dental",
      project_key: "WEB:10001",
      idempotency_key: expect.any(String),
    });
  });

  it("sends the caller's title and key, and no project when none is given", async () => {
    on("post", "/comments/:comment/push", ok(pushed, 201));
    const h = await connect();
    await h.call(TOOL, { comment: "cmt_8f3k2", integration: "Acme Jira", project_key: "WEB:10001", title: "Fix nav overlap", idempotency_key: "k-1" });
    expect(recorded[0]?.body).toEqual({ integration: "Acme Jira", project_key: "WEB:10001", title: "Fix nav overlap", idempotency_key: "k-1" });
  });

  it("says when the comment was already linked and nothing was created", async () => {
    on("post", "/comments/:comment/push", ok({ ...pushed, already_linked: true }));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", integration: "int_7g8h9i", project_key: "WEB:10001" });
    expect(result.isError).toBeFalsy();
    expect(summaryOf(result)).toBe(
      "Comment cmt_8f3k2 is already linked to Jira WEB-42: https://example.atlassian.net/browse/WEB-42. Nothing was created: a comment holds one item per tool.",
    );
  });

  it("needs project_key: a connection has no default project", async () => {
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { comment: "cmt_8f3k2", integration: "int_7g8h9i" }));
    expect(error.code).toBe("invalid");
    expect(error.message).toContain("project_key");
    expect(recorded).toHaveLength(0);
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
    const error = errorOf(await h.call(TOOL, { comment: "cmt_8f3k2", integration: "int_7g8h9i", project_key: "WEB:10001", idempotency_key: "k-push" }));
    expect(error.code).toBe("upstream");
    expect(error.idempotency_key).toBe("k-push");
    expect(error.hint).toMatch(/^Retry with the same idempotency_key\. The change may still have gone through\. To retry safely, call the tool again with the same arguments and idempotency_key "k-push"/);
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
    args: { comment: "cmt_8f3k2", integration: "int_7g8h9i", project_key: "WEB:10001" },
    method: "post",
    path: "/comments/:comment/push",
    success: ok(pushed, 201),
  });
});
