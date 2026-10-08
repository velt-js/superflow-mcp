import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_WEBHOOK_MESSAGE } from "../../../src/lib/confirm.ts";
import { webhook } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_webhook";

describe(TOOL, () => {
  it("without confirm, reads the webhook and returns it as a preview", async () => {
    on("get", "/webhooks/:webhook", ok(webhook));
    on("delete", "/webhooks/:webhook", ok({ deleted: true, id: "whk_2b3c4d" }));
    const h = await connect();
    const result = await h.call(TOOL, { webhook: "whk_2b3c4d" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({ needs_confirmation: true, preview: webhook, message: CONFIRM_DELETE_WEBHOOK_MESSAGE });
    expect(summaryOf(result)).toBe(
      "Webhook whk_2b3c4d https://hooks.example.com/superflow (comment.created, comment.resolved, agent_run.completed, project prj_1a2b, active, last delivery succeeded at 2026-10-08T09:30:00Z) would be deleted. Nothing was deleted. Ask the user to confirm.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["getWebhook"]);
    expect(writes()).toEqual([]);
  });

  it("deletes with confirm: true", async () => {
    on("delete", "/webhooks/:webhook", ok({ deleted: true, id: "whk_2b3c4d" }));
    const h = await connect();
    const result = await h.call(TOOL, { webhook: "whk_2b3c4d", confirm: true });
    expect(summaryOf(result)).toBe("Deleted webhook whk_2b3c4d. It gets no more events.");
    expect(recorded.map((r) => [r.method, r.query])).toEqual([["DELETE", { confirm: "true" }]]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { webhook: "whk_2b3c4d", confirm: true },
    method: "delete",
    path: "/webhooks/:webhook",
    success: ok({ deleted: true, id: "whk_2b3c4d" }),
  });
});
