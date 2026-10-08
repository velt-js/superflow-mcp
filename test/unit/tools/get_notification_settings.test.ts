import { describe, expect, it } from "vitest";
import { notificationSettings } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_notification_settings";

describe(TOOL, () => {
  it("returns the caller's settings", async () => {
    on("get", "/me/notifications", ok(notificationSettings));
    const h = await connect();
    const result = await h.call(TOOL);
    expect(data(result)).toEqual(notificationSettings);
    expect(summaryOf(result)).toBe("Your notification settings. Email digest: on, daily. Inbox: all. Email: mine.");
    expect(recorded[0]?.operationId).toBe("getNotificationSettings");
  });

  it("says when the digest is off", async () => {
    on("get", "/me/notifications", ok({ ...notificationSettings, email_digest: { enabled: false, cadence: "weekly" } }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL))).toContain("Email digest: off.");
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/me/notifications", success: ok(notificationSettings) });
});
