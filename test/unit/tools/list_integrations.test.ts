import { describe, expect, it } from "vitest";
import { jiraIntegration, slackIntegration } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_integrations";

describe(TOOL, () => {
  it("lists connected tools and flags the ones that need reconnecting", async () => {
    const body = { items: [slackIntegration, { ...jiraIntegration, status: "needs_reauth" }] };
    on("get", "/integrations", ok(body));
    const h = await connect();
    const result = await h.call(TOOL);
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe(
      "2 connected tools: Slack: Acme workspace, #design-feedback (int_1a2b3c, connected); Jira: Acme Jira, example.atlassian.net (int_7g8h9i, needs reconnecting). 1 connection needs reconnecting: get a link with superflow_connect_integration.",
    );
  });

  it("says when nothing is connected", async () => {
    on("get", "/integrations", ok({ items: [] }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL))).toBe("No tools are connected. Connect one with superflow_connect_integration.");
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/integrations", success: ok({ items: [slackIntegration] }) });
});
