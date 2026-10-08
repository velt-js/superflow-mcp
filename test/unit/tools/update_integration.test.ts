import { describe, expect, it } from "vitest";
import { jiraIntegration } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_integration";
const updated = { ...jiraIntegration, settings: { default_project: "APP:10002" } };

describe(TOOL, () => {
  it("sets the default project", async () => {
    on("patch", "/integrations/:integration", ok(updated));
    const h = await connect();
    const result = await h.call(TOOL, { integration: "int_7g8h9i", default_project: "APP:10002" });
    expect(data(result)).toEqual(updated);
    expect(summaryOf(result)).toBe("Updated Jira: Acme Jira, example.atlassian.net (int_7g8h9i, connected). Default project: APP:10002.");
    expect(recorded[0]?.body).toEqual({ default_project: "APP:10002" });
  });

  it("clears the default project with null", async () => {
    on("patch", "/integrations/:integration", ok({ ...jiraIntegration, settings: { default_project: null } }));
    const h = await connect();
    const result = await h.call(TOOL, { integration: "int_7g8h9i", default_project: null });
    expect(recorded[0]?.body).toEqual({ default_project: null });
    expect(summaryOf(result)).toBe("Updated Jira: Acme Jira, example.atlassian.net (int_7g8h9i, connected). No default project now.");
  });

  it("refuses a target with spaces before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { integration: "int_7g8h9i", default_project: "WEB 10001" })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { integration: "int_7g8h9i", default_project: "APP:10002" },
    method: "patch",
    path: "/integrations/:integration",
    success: ok(updated),
  });
});
