import { describe, expect, it } from "vitest";
import { jiraIntegration, slackIntegration } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_integration";

describe(TOOL, () => {
  it("returns one connection, with no default project or settings", async () => {
    on("get", "/integrations/:integration", ok(jiraIntegration));
    const h = await connect();
    const result = await h.call(TOOL, { integration: "Acme Jira" });
    expect(data(result)).toEqual(jiraIntegration);
    expect(summaryOf(result)).toBe("Jira: Acme Jira, example.atlassian.net (int_7g8h9i, connected).");
    expect(summaryOf(result)).not.toContain("efault project");
    expect(recorded[0]?.path).toBe("/integrations/Acme%20Jira");
  });

  it("says when a connection needs reconnecting", async () => {
    on("get", "/integrations/:integration", ok({ ...slackIntegration, status: "needs_reauth" }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { integration: "int_1a2b3c" }))).toBe(
      "Slack: Acme workspace, #design-feedback (int_1a2b3c, needs reconnecting). It needs reconnecting: get a link with superflow_connect_integration.",
    );
  });

  standardErrorCases({
    tool: TOOL,
    args: { integration: "int_7g8h9i" },
    method: "get",
    path: "/integrations/:integration",
    success: ok(jiraIntegration),
  });
});
