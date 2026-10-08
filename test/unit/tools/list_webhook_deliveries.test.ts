import { describe, expect, it } from "vitest";
import { delivery, list } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_webhook_deliveries";

describe(TOOL, () => {
  it("lists recent deliveries and counts the failures", async () => {
    const failed = { id: "msg_2", event: "comment.resolved", status: "failed", response_code: 500, at: "2026-10-08T09:20:00Z" };
    on("get", "/webhooks/:webhook/deliveries", ok(list([delivery, failed])));
    const h = await connect();
    const result = await h.call(TOOL, { webhook: "whk_2b3c4d" });
    expect(data(result)).toEqual(list([delivery, failed]));
    expect(summaryOf(result)).toBe(
      "2 deliveries for webhook whk_2b3c4d: 1 succeeded, 1 failed or pending. Latest: comment.created at 2026-10-08T09:30:00Z, succeeded (HTTP 200).",
    );
    expect(recorded[0]?.path).toBe("/webhooks/whk_2b3c4d/deliveries");
  });

  standardErrorCases({
    tool: TOOL,
    args: { webhook: "whk_2b3c4d" },
    method: "get",
    path: "/webhooks/:webhook/deliveries",
    success: ok(list([delivery])),
  });
});
