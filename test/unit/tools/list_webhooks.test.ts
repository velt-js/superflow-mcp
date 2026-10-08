import { describe, expect, it } from "vitest";
import { list, webhook } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, standardErrorCases, summaryOf, textOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_webhooks";

describe(TOOL, () => {
  it("lists endpoints with events, project, state and the last delivery, never a secret", async () => {
    on("get", "/webhooks", ok(list([webhook])));
    const h = await connect();
    const result = await h.call(TOOL);
    expect(data(result)).toEqual(list([webhook]));
    expect(summaryOf(result)).toBe(
      "Found 1 webhook: whk_2b3c4d https://hooks.example.com/superflow (comment.created, comment.resolved, agent_run.completed, project prj_1a2b, active, last delivery succeeded at 2026-10-08T09:30:00Z).",
    );
    expect(textOf(result)).not.toContain("whsec_");
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/webhooks", success: ok(list([webhook])) });
});
