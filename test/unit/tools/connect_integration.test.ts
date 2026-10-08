import { describe, expect, it } from "vitest";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_connect_integration";
const link = {
  type: "jira",
  url: "https://app.usesuperflow.ai/settings/integrations/jira",
  note: "Open the link and sign in to Jira.",
};

describe(TOOL, () => {
  it("returns a link the user opens, and says this server cannot finish the sign-in", async () => {
    on("post", "/integrations/connect", ok(link));
    const h = await connect();
    const result = await h.call(TOOL, { type: "jira" });
    expect(data(result)).toEqual(link);
    expect(summaryOf(result)).toBe(
      `Give the user this link to connect Jira: ${link.url}. They sign in to the tool in their browser; this server cannot finish it. Then check with superflow_list_integrations. Open the link and sign in to Jira.`,
    );
    expect(recorded[0]?.body).toEqual({ type: "jira" });
  });

  it("stays available in read-only mode", async () => {
    on("post", "/integrations/connect", ok(link));
    const h = await connect({ readOnly: true });
    expect((await h.call(TOOL, { type: "slack" })).isError).toBeFalsy();
  });

  it("rejects an unknown tool before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { type: "trello" })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({ tool: TOOL, args: { type: "jira" }, method: "post", path: "/integrations/connect", success: ok(link) });
});
