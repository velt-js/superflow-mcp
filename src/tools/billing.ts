// Billing tools: what the workspace is on and where to change it (GET /billing). Read only:
// buying and changing plans happens in the Superflow portal, never from a tool.
import { z } from "zod";
import type { Billing, Invoice, InvoiceList } from "../client/types.ts";
import { okResult, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool } from "./define.ts";
import { asData, join } from "./helpers.ts";

function planLine(billing: Billing): string {
  const plan = billing.plan ?? "no plan";
  if (!billing.valid) return `Plan: ${plan}, not active (${billing.trial_ends_at ? "the trial ended" : "cancelled or unpaid"}).`;
  const until = billing.period_ends_at ? `, renews or ends ${billing.period_ends_at.slice(0, 10)}` : billing.trial_ends_at ? `, trial ends ${billing.trial_ends_at.slice(0, 10)}` : "";
  return `Plan: ${plan}${until}.`;
}

function subscriptionLine(billing: Billing): string {
  if (!billing.subscription_checked) return "The subscription could not be checked right now.";
  if (!billing.subscription) return "No paid subscription.";
  const sub = billing.subscription;
  return join(
    `Subscription: ${sub.status ?? "live"}${sub.interval ? `, billed ${sub.interval}` : ""}${sub.owned_by_you === false ? ", paid by another admin" : ""}.`,
    sub.live_count > 1 && `Warning: ${sub.live_count} live subscriptions. Contact Superflow support before changing anything.`,
  );
}

export const getBilling = defineTool({
  name: "superflow_get_billing",
  title: "Billing",
  description: [
    "The workspace's plan and paid subscription: plan name, whether it is active, when the period or trial ends, the billing interval, and the portal page to change it.",
    "Use it for questions like \"what plan are we on\" or \"when does our trial end\". For seats, projects and AI credits use superflow_get_organization; for credit spend use superflow_get_credit_usage.",
    "Example: {}",
  ].join("\n"),
  inputSchema: {},
  annotations: READ_HINTS,
  write: false,
  async run(_args, { api }) {
    const billing = await api.call<Billing>("getBilling");
    return okResult(join(planLine(billing), subscriptionLine(billing), `Manage billing: ${billing.manage_url}`), asData(billing));
  },
});

export const getPaymentLink = defineTool({
  name: "superflow_get_payment_link",
  title: "Payment link",
  description: [
    "The link where a person picks a plan and pays, or changes seats on the plan they have. It never charges anything: the person pays in the Superflow portal.",
    "Use it when the user wants to upgrade, buy seats or start paying. Never ask for card details in the conversation. When the workspace already pays, the link manages that subscription instead of starting a second one.",
    "Example: {}",
  ].join("\n"),
  inputSchema: {},
  annotations: READ_HINTS,
  write: false,
  async run(_args, { api }) {
    const billing = await api.call<Billing>("getBilling");
    const summary =
      billing.next_step === "subscribe"
        ? `Open ${billing.manage_url} to pick a plan and pay. Superflow does not charge anything from here.`
        : billing.subscription_checked
          ? `This workspace already has a subscription. Change the plan or seats at ${billing.manage_url}. Do not start a new one.`
          : `Open ${billing.manage_url} to see the plan and pay or change it. The subscription could not be checked right now, so do not assume there is none.`;
    return okResult(summary, asData(billing));
  },
});

function money(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  return `${amount} ${currency.toUpperCase()}`;
}

function invoiceLine(invoice: Invoice): string {
  const when = invoice.created_at ? invoice.created_at.slice(0, 10) : "undated";
  const owed = invoice.status === "open" && invoice.amount_due > invoice.amount_paid ? `, ${money(invoice.amount_due - invoice.amount_paid, invoice.currency)} due` : "";
  return `${invoice.number ?? invoice.id} (${when}): ${money(invoice.total, invoice.currency)}, ${invoice.status ?? "unknown"}${owed}.`;
}

export const getInvoices = defineTool({
  name: "superflow_get_invoices",
  title: "Invoices",
  description: [
    "The workspace's invoices, newest first: number, date, total, whether it is paid, and the Stripe links to view, pay or download each one. Only the workspace owner can read them.",
    "Use it for questions like \"send me last month's invoice\" or \"do we owe anything\". For the plan itself use superflow_get_billing. Never ask for card details: paying happens on the invoice page or in the portal.",
    'Example: {"limit": 3}',
  ].join("\n"),
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional().describe("How many invoices, newest first. Default 12, max 50."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = await api.call<InvoiceList>("listInvoices", { query: args.limit !== undefined ? { limit: args.limit } : {} });
    if (!list.items.length) return okResult(`No invoices yet. Billing: ${list.manage_url}`, asData(list), { untrusted: false });
    return okResult(join(`${plural(list.items.length, "invoice")}, newest first.`, ...list.items.map(invoiceLine)), asData(list), { untrusted: false });
  },
});

export const billingTools = [getBilling, getPaymentLink, getInvoices];
