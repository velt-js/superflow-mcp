import { describe, expect, it } from "vitest";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_test_webhook";

describe(TOOL, () => {
  it("sends a ping and points at the deliveries", async () => {
    const sent = { sent: true, id: "whk_2b3c4d", event: "ping", message_id: "msg_ping" };
    on("post", "/webhooks/:webhook/test", ok(sent));
    const h = await connect();
    const result = await h.call(TOOL, { webhook: "whk_2b3c4d" });
    expect(data(result)).toEqual(sent);
    expect(summaryOf(result)).toBe(
      "Sent a ping to webhook whk_2b3c4d (message msg_ping). Check the delivery with superflow_list_webhook_deliveries in a few seconds.",
    );
    expect(recorded[0]?.path).toBe("/webhooks/whk_2b3c4d/test");
    expect(recorded[0]?.body).toBeUndefined();
  });

  it("says when the ping was not sent", async () => {
    on("post", "/webhooks/:webhook/test", ok({ sent: false, id: "whk_2b3c4d", event: "ping", message_id: null }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { webhook: "whk_2b3c4d" }))).toBe(
      "The ping to webhook whk_2b3c4d was not sent. Check that the endpoint is active with superflow_get_webhook.",
    );
  });

  standardErrorCases({
    tool: TOOL,
    args: { webhook: "whk_2b3c4d" },
    method: "post",
    path: "/webhooks/:webhook/test",
    success: ok({ sent: true, id: "whk_2b3c4d", event: "ping", message_id: null }),
  });
});
