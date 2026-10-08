// Webhook tools: list, get, create, update, delete and test endpoints, and their deliveries.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
  CreatedWebhook,
  DeleteWebhookResponse,
  ListEnvelope,
  Webhook,
  WebhookDelivery,
  WebhookTestResponse,
} from "../client/types.ts";
import { CONFIRM_DELETE_WEBHOOK_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, join } from "./helpers.ts";
import { confirmSchema, projectRefSchema, webhookEventsSchema, webhookRefSchema } from "./schemas.ts";

const SAVE_SECRET =
  "Save the signing secret now (the secret field below): Superflow shows it only this once. Use it to verify the svix-signature header on every delivery.";

const urlSchema = z
  .string()
  .url()
  .describe("Public https URL that receives the events, for example https://hooks.example.com/superflow.");

/** Webhook URLs must be https. The API also refuses private and local hosts. */
function checkHttps(url: string | undefined): CallToolResult | undefined {
  if (url === undefined) return undefined;
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    return invalidInput(`"${url}" is not a URL.`);
  }
  return protocol === "https:" ? undefined : invalidInput("The webhook URL must use https.", "Give a public https URL.");
}

/** "whk_1 https://hooks.example.com/sf (3 events, project prj_1, active, last delivery succeeded at ...)". */
export function webhookLine(webhook: Webhook): string {
  const events = webhook.events ?? [];
  const notes = [
    events.length <= 3 ? events.join(", ") || "no events" : plural(events.length, "event"),
    webhook.project_id ? `project ${webhook.project_id}` : "all projects",
    webhook.active ? "active" : "paused",
    webhook.last_delivery ? `last delivery ${webhook.last_delivery.status} at ${webhook.last_delivery.at}` : "no deliveries yet",
  ];
  return `${webhook.id} ${webhook.url} (${notes.join(", ")})`;
}

export const listWebhooks = defineTool({
  name: "superflow_list_webhooks",
  title: "List webhooks",
  description: [
    "List the workspace's webhook endpoints: URL, events, project filter, whether each is active, the last 4 characters of its signing secret, and the last delivery.",
    "Use it to find a webhook id, or to check what a system receives. For one endpoint's delivery history use superflow_list_webhook_deliveries.",
    "Example: {}",
  ].join("\n"),
  inputSchema: {},
  annotations: READ_HINTS,
  write: false,
  async run(_args, { api }) {
    const list = await api.call<ListEnvelope<Webhook>>("listWebhooks");
    const items = list.items ?? [];
    const shown = items.slice(0, 4).map(webhookLine).join("; ");
    return okResult(`Found ${plural(items.length, "webhook")}${shown ? `: ${shown}${items.length > 4 ? "; ..." : ""}` : ""}.`, asData(list));
  },
});

export const getWebhook = defineTool({
  name: "superflow_get_webhook",
  title: "Get a webhook",
  description: [
    "Get one webhook endpoint: URL, events, project filter, active or paused, secret hint (last 4 characters) and the last delivery. The full secret is never shown again after creation.",
    "To see recent deliveries use superflow_list_webhook_deliveries.",
    'Example: {"webhook": "whk_2b3c4d"}',
  ].join("\n"),
  inputSchema: { webhook: webhookRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const webhook = await api.call<Webhook>("getWebhook", { path: { webhook: args.webhook } });
    return okResult(`Webhook ${webhookLine(webhook)}.`, asData(webhook));
  },
});

export const createWebhook = defineTool({
  name: "superflow_create_webhook",
  title: "Create a webhook",
  description: [
    "Add a webhook endpoint: Superflow sends signed POST requests to your https URL when the chosen events happen (comment created, resolved, reply added, project archived, agent run completed, and more). Give project to receive one project's events only.",
    "The answer includes the signing secret. It is shown once and cannot be read again: tell the user to store it now, for example in their secret manager. Events cover changes made through the API, this server and agent runs, not yet comments made in the Superflow toolbar.",
    "Ask the user before creating. Send a test with superflow_test_webhook.",
    'Example: {"url": "https://hooks.example.com/superflow", "events": ["comment.created", "comment.resolved", "agent_run.completed"], "project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    url: urlSchema,
    events: webhookEventsSchema,
    project: projectRefSchema.optional().describe("Only this project's events (name, site URL or id). Omit for every project."),
    description: z.string().min(1).max(500).optional().describe("What the endpoint is for, for example \"Zapier: new comments to Linear\"."),
  },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api }) {
    const problem = checkHttps(args.url);
    if (problem) return problem;
    const webhook = await api.call<CreatedWebhook>("createWebhook", {
      body: compact({ url: args.url, events: args.events, project: args.project, description: args.description }),
    });
    return okResult(join(`Created webhook ${webhook.id} for ${webhook.url ?? args.url}.`, SAVE_SECRET), asData(webhook));
  },
});

export const updateWebhook = defineTool({
  name: "superflow_update_webhook",
  title: "Update a webhook",
  description: [
    "Change a webhook endpoint: its URL, its events (the new list replaces the old one), its project filter, or pause and resume it with active. The signing secret stays the same.",
    "To delete an endpoint use superflow_delete_webhook.",
    'Example: {"webhook": "whk_2b3c4d", "active": false}',
  ].join("\n"),
  inputSchema: {
    webhook: webhookRefSchema,
    url: urlSchema.optional(),
    events: webhookEventsSchema.optional().describe("The full new list of events. It replaces the old list."),
    project: projectRefSchema.optional().describe("Only this project's events from now on (name, site URL or id)."),
    active: z.boolean().optional().describe("false pauses deliveries, true resumes them."),
  },
  annotations: hints(false, false, true, true),
  write: true,
  async run(args, { api }) {
    const problem = checkHttps(args.url);
    if (problem) return problem;
    const body = compact({ url: args.url, events: args.events, project: args.project, active: args.active });
    if (Object.keys(body).length === 0) return invalidInput("Nothing to change. Give url, events, project or active.");
    const webhook = await api.call<Webhook>("updateWebhook", { path: { webhook: args.webhook }, body });
    return okResult(`Updated webhook ${webhookLine(webhook)}.`, asData(webhook));
  },
});

export const deleteWebhook = defineTool({
  name: "superflow_delete_webhook",
  title: "Delete a webhook",
  description: [
    "Delete a webhook endpoint. The receiving system stops getting events right away, and its signing secret is gone. Safe to repeat.",
    "Without confirm: true nothing is deleted: you get the webhook as a preview to show the user. Call again with confirm: true only after the user says yes.",
    "To pause instead, use superflow_update_webhook with active: false.",
    'Example: {"webhook": "whk_2b3c4d"}',
  ].join("\n"),
  inputSchema: {
    webhook: webhookRefSchema,
    confirm: confirmSchema("delete the webhook"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      const result = await api.call<DeleteWebhookResponse>("deleteWebhook", {
        path: { webhook: args.webhook },
        query: { confirm: true },
      });
      return okResult(`Deleted webhook ${result.id ?? args.webhook}. It gets no more events.`, asData(result));
    }
    // Preview: one read. Nothing that could delete is sent without confirm.
    const webhook = await api.call<Webhook>("getWebhook", { path: { webhook: args.webhook } });
    return confirmationResult(
      `Webhook ${webhookLine(webhook)} would be deleted. Nothing was deleted. Ask the user to confirm.`,
      { preview: webhook, message: CONFIRM_DELETE_WEBHOOK_MESSAGE },
    );
  },
});

export const testWebhook = defineTool({
  name: "superflow_test_webhook",
  title: "Test a webhook",
  description: [
    "Send a ping event to a webhook endpoint, signed like every real event, to check that the receiving system gets it and verifies the signature.",
    "Then check the result with superflow_list_webhook_deliveries after a few seconds.",
    'Example: {"webhook": "whk_2b3c4d"}',
  ].join("\n"),
  inputSchema: { webhook: webhookRefSchema },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api }) {
    const result = await api.call<WebhookTestResponse>("testWebhook", { path: { webhook: args.webhook } });
    return okResult(
      `Sent a ping to webhook ${args.webhook}. Check the delivery with superflow_list_webhook_deliveries in a few seconds.`,
      asData(result),
    );
  },
});

export const listWebhookDeliveries = defineTool({
  name: "superflow_list_webhook_deliveries",
  title: "List webhook deliveries",
  description: [
    "List the last 100 deliveries to a webhook endpoint, newest first: event, status, the HTTP response code from the receiving system, and when.",
    "Use it to debug an endpoint that is not receiving events, or after superflow_test_webhook. Failed deliveries are retried by Superflow on a schedule.",
    'Example: {"webhook": "whk_2b3c4d"}',
  ].join("\n"),
  inputSchema: { webhook: webhookRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = await api.call<ListEnvelope<WebhookDelivery>>("listWebhookDeliveries", { path: { webhook: args.webhook } });
    const items = list.items ?? [];
    const failed = items.filter((item) => typeof item.response_code !== "number" || item.response_code < 200 || item.response_code >= 300);
    const latest = items[0];
    return okResult(
      join(
        `${plural(items.length, "delivery", "deliveries")} for webhook ${args.webhook}${items.length > 0 ? `: ${items.length - failed.length} succeeded, ${failed.length} failed or pending` : ""}.`,
        latest && `Latest: ${latest.event} at ${latest.at}, ${latest.status}${typeof latest.response_code === "number" ? ` (HTTP ${latest.response_code})` : ""}.`,
      ),
      asData(list),
    );
  },
});

export const webhookTools = [
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  listWebhookDeliveries,
];
