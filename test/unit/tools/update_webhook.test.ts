import { describe, expect, it } from "vitest";
import { webhook } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_webhook";

describe(TOOL, () => {
  it("pauses an endpoint", async () => {
    on("patch", "/webhooks/:webhook", ok({ ...webhook, active: false }));
    const h = await connect();
    const result = await h.call(TOOL, { webhook: "whk_2b3c4d", active: false });
    expect(data(result)).toEqual({ ...webhook, active: false });
    expect(summaryOf(result)).toBe(
      "Updated webhook whk_2b3c4d https://hooks.example.com/superflow (comment.created, comment.resolved, agent_run.completed, project prj_1a2b, paused, last delivery succeeded at 2026-10-08T09:30:00Z).",
    );
    expect(recorded[0]?.body).toEqual({ active: false });
  });

  it("replaces the events and the URL", async () => {
    on("patch", "/webhooks/:webhook", ok(webhook));
    const h = await connect();
    await h.call(TOOL, { webhook: "whk_2b3c4d", url: "https://hooks.example.com/v2", events: ["agent_run.failed"] });
    expect(recorded[0]?.body).toEqual({ url: "https://hooks.example.com/v2", events: ["agent_run.failed"] });
  });

  it("refuses an empty change or an http URL before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { webhook: "whk_2b3c4d" })).message).toContain("Nothing to change");
    expect(errorOf(await h.call(TOOL, { webhook: "whk_2b3c4d", url: "http://hooks.example.com" })).message).toBe(
      "The webhook URL must use https.",
    );
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { webhook: "whk_2b3c4d", active: true },
    method: "patch",
    path: "/webhooks/:webhook",
    success: ok(webhook),
  });
});
