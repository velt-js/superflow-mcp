import { describe, expect, it } from "vitest";
import { connect, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

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

describe("superflow_get_invoices", () => {
  const INVOICES = {
    items: [
      { id: "in_2", number: "INV-0002", status: "open", currency: "usd", amount_due: 4900, amount_paid: 0, total: 4900, created_at: "2026-10-01T00:00:00Z", period_start: null, period_end: null, hosted_invoice_url: "https://invoice.stripe.com/in_2", pdf_url: null },
      { id: "in_1", number: "INV-0001", status: "paid", currency: "usd", amount_due: 4900, amount_paid: 4900, total: 4900, created_at: "2026-09-01T00:00:00Z", period_start: null, period_end: null, hosted_invoice_url: null, pdf_url: null },
    ],
    next_cursor: null,
    applied_filters: { limit: 12 },
    manage_url: "https://app.example.test/settings/billing",
  };

  it("lists the invoices newest first with what is owed", async () => {
    on("get", "/billing/invoices", ok(INVOICES));
    const h = await connect();
    expect(summaryOf(await h.call("superflow_get_invoices", {}))).toBe(
      "2 invoices, newest first. INV-0002 (2026-10-01): 49.00 USD, open, 49.00 USD due. INV-0001 (2026-09-01): 49.00 USD, paid.",
    );
  });

  it("passes the limit and says when there are none", async () => {
    on("get", "/billing/invoices", ok({ ...INVOICES, items: [] }));
    const h = await connect();
    expect(summaryOf(await h.call("superflow_get_invoices", { limit: 3 }))).toBe("No invoices yet. Billing: https://app.example.test/settings/billing");
    expect(recorded[0]?.query).toEqual({ limit: "3" });
  });

  standardErrorCases({ tool: "superflow_get_invoices", args: {}, method: "get", path: "/billing/invoices", success: ok(INVOICES) });
});

