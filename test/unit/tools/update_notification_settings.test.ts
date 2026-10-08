import { describe, expect, it } from "vitest";
import { notificationSettings } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, seen, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_notification_settings";
const updated = { email_digest: { enabled: true, cadence: "weekly" }, inbox: "all", email: "mine" };

describe(TOOL, () => {
  it("sends only the fields given", async () => {
    on("patch", "/me/notifications", ok(updated));
    const h = await connect();
    const result = await h.call(TOOL, { email_digest: { cadence: "weekly" }, email: "mine" });
    expect(data(result)).toEqual(updated);
    expect(summaryOf(result)).toBe("Updated your notification settings. Email digest: on, weekly. Inbox: all. Email: mine.");
    expect(recorded[0]?.body).toEqual({ email_digest: { cadence: "weekly" }, email: "mine" });
  });

  it("refuses an empty change, including an empty digest object", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { email_digest: {} })).code).toBe("invalid");
    expect(seen).toEqual([]);
  });

  it("rejects an unknown level", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { inbox: "some" })).code).toBe("invalid");
    expect(seen).toEqual([]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { inbox: "none" },
    method: "patch",
    path: "/me/notifications",
    success: ok(notificationSettings),
  });
});
