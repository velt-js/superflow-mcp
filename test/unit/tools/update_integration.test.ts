import { describe, expect, it } from "vitest";
import { jiraIntegration } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_integration";
const updated = { ...jiraIntegration, settings: { default_project: "APP" } };

describe(TOOL, () => {
  it("sets the default project", async () => {
    on("patch", "/integrations/:integration", ok(updated));
    const h = await connect();
    const result = await h.call(TOOL, { integration: "int_7g8h9i", default_project: "APP" });
    expect(data(result)).toEqual(updated);
    expect(summaryOf(result)).toBe("Updated Jira: Acme Jira, acme.atlassian.net (int_7g8h9i, connected). Default project: APP.");
    expect(recorded[0]?.body).toEqual({ default_project: "APP" });
  });

  standardErrorCases({
    tool: TOOL,
    args: { integration: "int_7g8h9i", default_project: "APP" },
    method: "patch",
    path: "/integrations/:integration",
    success: ok(updated),
  });
});
