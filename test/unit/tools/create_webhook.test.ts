import { describe, expect, it } from "vitest";
import { createdWebhook } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, textOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_create_webhook";
const args = {
  url: "https://hooks.example.com/superflow",
  events: ["comment.created", "comment.resolved", "agent_run.completed"],
  project: "Acme Dental",
};

describe(TOOL, () => {
  it("creates an endpoint, shows the secret once and says to save it", async () => {
    on("post", "/webhooks", ok(createdWebhook, 201));
    const h = await connect();
    const result = await h.call(TOOL, args);
    expect(data(result)).toEqual(createdWebhook);
    expect(summaryOf(result)).toBe(
      "Created webhook whk_2b3c4d for https://hooks.example.com/superflow. Save the signing secret now (the secret field below): Superflow shows it only this once. Use it to verify the svix-signature header on every delivery.",
    );
    expect(textOf(result)).toContain(createdWebhook.secret);
    expect(recorded[0]?.body).toEqual(args);
  });

  it("refuses an http URL and unknown events before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { ...args, url: "http://hooks.example.com/superflow" })).message).toBe(
      "The webhook URL must use https.",
    );
    expect(errorOf(await h.call(TOOL, { ...args, events: ["comment.liked"] })).code).toBe("invalid");
    expect(errorOf(await h.call(TOOL, { ...args, events: [] })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({ tool: TOOL, args, method: "post", path: "/webhooks", success: ok(createdWebhook, 201) });
});
