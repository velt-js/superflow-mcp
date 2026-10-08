import { describe, expect, it } from "vitest";
import { webhook } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_webhook";

describe(TOOL, () => {
  it("returns one endpoint", async () => {
    const many = { ...webhook, events: ["comment.created", "comment.updated", "comment.resolved", "reply.created"], project_id: null, last_delivery: null };
    on("get", "/webhooks/:webhook", ok(many));
    const h = await connect();
    const result = await h.call(TOOL, { webhook: "whk_2b3c4d" });
    expect(data(result)).toEqual(many);
    expect(summaryOf(result)).toBe(
      "Webhook whk_2b3c4d https://hooks.example.com/superflow (4 events, all projects, active, no deliveries yet).",
    );
    expect(recorded[0]?.path).toBe("/webhooks/whk_2b3c4d");
  });

  standardErrorCases({ tool: TOOL, args: { webhook: "whk_2b3c4d" }, method: "get", path: "/webhooks/:webhook", success: ok(webhook) });
});
