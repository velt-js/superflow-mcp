import { describe, expect, it } from "vitest";
import { connect, ok, on, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const BASE = {
  plan: "pro",
  valid: true,
  billing_status: "active",
  trial_ends_at: null,
  period_ends_at: "2026-11-01T00:00:00Z",
  subscription: { status: "active", interval: "yearly", owned_by_you: true, live_count: 1 },
  subscription_checked: true,
  next_step: "manage",
  manage_url: "https://app.example.test/settings/billing",
};

describe("superflow_get_billing", () => {
  it("summarizes the plan, the subscription and the manage link", async () => {
    on("get", "/billing", ok(BASE));
    const h = await connect();
    expect(summaryOf(await h.call("superflow_get_billing", {}))).toBe(
      "Plan: pro, renews or ends 2026-11-01. Subscription: active, billed yearly. Manage billing: https://app.example.test/settings/billing",
    );
  });

  it("warns about more than one live subscription", async () => {
    on("get", "/billing", ok({ ...BASE, subscription: { ...BASE.subscription, live_count: 2 } }));
    const h = await connect();
    expect(summaryOf(await h.call("superflow_get_billing", {}))).toContain("2 live subscriptions");
  });

  standardErrorCases({ tool: "superflow_get_billing", args: {}, method: "get", path: "/billing", success: ok(BASE) });
});

describe("superflow_get_payment_link", () => {
  it("points a workspace with no subscription at the plan page", async () => {
    on("get", "/billing", ok({ ...BASE, subscription: null, next_step: "subscribe" }));
    const h = await connect();
    expect(summaryOf(await h.call("superflow_get_payment_link", {}))).toBe(
      "Open https://app.example.test/settings/billing to pick a plan and pay. Superflow does not charge anything from here.",
    );
  });

  it("never offers a second subscription to a workspace that pays", async () => {
    on("get", "/billing", ok(BASE));
    const h = await connect();
    expect(summaryOf(await h.call("superflow_get_payment_link", {}))).toContain("Do not start a new one.");
  });

  it("does not assume there is no subscription when the check failed", async () => {
    on("get", "/billing", ok({ ...BASE, subscription: null, subscription_checked: false, next_step: "manage" }));
    const h = await connect();
    expect(summaryOf(await h.call("superflow_get_payment_link", {}))).toContain("do not assume there is none");
  });

  it("stays available in read-only mode", async () => {
    const h = await connect({ readOnly: true });
    const { tools } = await h.client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["superflow_get_billing", "superflow_get_payment_link"]));
  });
});
