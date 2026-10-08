import { describe, expect, it } from "vitest";
import { CONFIRM_POST_TO_SLACK_MESSAGE } from "../../../src/lib/confirm.ts";
import { compactComment, jiraIntegration, list, slackIntegration } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_post_to_slack";
const posted = { ok: true, permalink: "https://acme.slack.com/archives/C1/p123" };

describe(TOOL, () => {
  it("without confirm, reads the connection and the matching comments and posts nothing", async () => {
    on("get", "/integrations/:integration", ok(slackIntegration));
    on("get", "/comments", ok(list([compactComment], { total: 40, next_cursor: "c2" })));
    on("post", "/integrations/slack/post", ok(posted));
    const h = await connect();
    const filter = { project: "Acme Dental", priority: ["critical"] };
    const result = await h.call(TOOL, { integration: "int_1a2b3c", text: "Critical items below.", filter, template: "list" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: {
        integration: slackIntegration,
        channel: "#design-feedback",
        text: "Critical items below.",
        filter,
        template: "list",
        matching_comments: { count: 40, at_least: false, sample: [compactComment] },
      },
      message: CONFIRM_POST_TO_SLACK_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      'Would post to Slack #design-feedback (Acme workspace): the text "Critical items below." and 40 matching comments as a list. Nothing was posted. Ask the user to confirm.',
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["getIntegration", "listComments"]);
    expect(recorded[1]?.query).toEqual({ project: "Acme Dental", priority: "critical", limit: "25", fields: "compact" });
    expect(writes()).toEqual([]);
  });

  it("says at least when the comment list has more pages and no total", async () => {
    on("get", "/integrations/:integration", ok(slackIntegration));
    on("get", "/comments", ok(list([compactComment], { next_cursor: "c2" })));
    const h = await connect();
    const result = await h.call(TOOL, { integration: "int_1a2b3c", filter: { project: "Acme Dental" } });
    expect(summaryOf(result)).toBe(
      "Would post to Slack #design-feedback (Acme workspace): at least 1 matching comment. Nothing was posted. Ask the user to confirm.",
    );
  });

  it("still previews when the key cannot list comments", async () => {
    on("get", "/integrations/:integration", ok(slackIntegration));
    on("get", "/comments", fail(403, { code: "forbidden", message: "This key lacks comments:read." }));
    const h = await connect();
    const result = await h.call(TOOL, { integration: "int_1a2b3c", filter: { project: "Acme Dental", status: ["open"] } });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toMatchObject({ needs_confirmation: true });
    expect(data(result).preview).not.toHaveProperty("matching_comments");
    expect(summaryOf(result)).toBe(
      "Would post to Slack #design-feedback (Acme workspace): the comments matching the filter (this key cannot list them for a preview). Nothing was posted. Ask the user to confirm.",
    );
    expect(writes()).toEqual([]);
  });

  it("previews comment ids without reading them", async () => {
    on("get", "/integrations/:integration", ok(slackIntegration));
    const h = await connect();
    const result = await h.call(TOOL, { integration: "Acme workspace", comments: ["cmt_8f3k2", "#4822"] });
    expect(summaryOf(result)).toBe("Would post to Slack #design-feedback (Acme workspace): 2 comments. Nothing was posted. Ask the user to confirm.");
    expect((data(result).preview as { comments: string[] }).comments).toEqual(["cmt_8f3k2", "4822"]);
    expect(recorded.map((r) => r.operationId)).toEqual(["getIntegration"]);
    expect(writes()).toEqual([]);
  });

  it("refuses a connection that is not Slack", async () => {
    on("get", "/integrations/:integration", ok(jiraIntegration));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { integration: "Acme Jira", text: "Hi" })).message).toBe(
      "Acme Jira is a Jira connection, not Slack.",
    );
    expect(writes()).toEqual([]);
  });

  it("posts with confirm: true, without sending confirm to the API", async () => {
    on("post", "/integrations/slack/post", ok(posted));
    const h = await connect();
    const result = await h.call(TOOL, { integration: "int_1a2b3c", text: "Done.", comments: ["4821"], template: "summary", confirm: true });
    expect(data(result)).toEqual(posted);
    expect(summaryOf(result)).toBe("Posted the message to Slack. Link: https://acme.slack.com/archives/C1/p123");
    expect(recorded.map((r) => r.operationId)).toEqual(["postToSlack"]);
    expect(recorded[0]?.body).toEqual({ integration: "int_1a2b3c", text: "Done.", comments: ["4821"], template: "summary" });
  });

  it("reports a message Slack did not accept as an error", async () => {
    on("post", "/integrations/slack/post", ok({ ok: false, permalink: null }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { integration: "int_1a2b3c", text: "Hi", confirm: true })).code).toBe("upstream");
  });

  it("checks the input before any request", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { integration: "int_1", comments: ["4821"], filter: { project: "Acme" } })).message).toBe(
      "Give comments or filter, not both.",
    );
    expect(errorOf(await h.call(TOOL, { integration: "int_1" })).message).toBe("Nothing to post. Give text, comments or filter.");
    expect(errorOf(await h.call(TOOL, { integration: "int_1", filter: {} })).message).toContain("The filter is empty");
    expect(errorOf(await h.call(TOOL, { integration: "int_1", filter: { created_after: "soon" } })).message).toContain("filter.created_after");
    expect(errorOf(await h.call(TOOL, { integration: "int_1", comments: Array.from({ length: 26 }, (_, i) => `${i + 1}`) })).code).toBe(
      "invalid",
    );
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { integration: "int_1a2b3c", text: "Hi", confirm: true },
    method: "post",
    path: "/integrations/slack/post",
    success: ok(posted),
  });
});
