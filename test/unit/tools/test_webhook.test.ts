import { describe, expect, it } from "vitest";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_test_webhook";

describe(TOOL, () => {
  it("sends a ping and points at the deliveries", async () => {
    on("post", "/webhooks/:webhook/test", ok({ ok: true, id: "msg_ping" }));
    const h = await connect();
    const result = await h.call(TOOL, { webhook: "whk_2b3c4d" });
    expect(data(result)).toEqual({ ok: true, id: "msg_ping" });
    expect(summaryOf(result)).toBe(
      "Sent a ping to webhook whk_2b3c4d. Check the delivery with superflow_list_webhook_deliveries in a few seconds.",
    );
    expect(recorded[0]?.path).toBe("/webhooks/whk_2b3c4d/test");
    expect(recorded[0]?.body).toBeUndefined();
  });

  standardErrorCases({
    tool: TOOL,
    args: { webhook: "whk_2b3c4d" },
    method: "post",
    path: "/webhooks/:webhook/test",
    success: ok({ ok: true }),
  });
});
