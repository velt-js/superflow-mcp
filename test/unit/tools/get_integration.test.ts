import { describe, expect, it } from "vitest";
import { jiraIntegration, slackIntegration } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_integration";

describe(TOOL, () => {
  it("returns one connection with its default project", async () => {
    on("get", "/integrations/:integration", ok(jiraIntegration));
    const h = await connect();
    const result = await h.call(TOOL, { integration: "Acme Jira" });
    expect(data(result)).toEqual(jiraIntegration);
    expect(summaryOf(result)).toBe("Jira: Acme Jira, acme.atlassian.net (int_7g8h9i, connected). Default project: WEB.");
    expect(recorded[0]?.path).toBe("/integrations/Acme%20Jira");
  });

  it("says when no default project is set", async () => {
    on("get", "/integrations/:integration", ok(slackIntegration));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { integration: "int_1a2b3c" }))).toContain("No default project set.");
  });

  standardErrorCases({
    tool: TOOL,
    args: { integration: "int_7g8h9i" },
    method: "get",
    path: "/integrations/:integration",
    success: ok(jiraIntegration),
  });
});
