// Workspace tools: the organization, renaming it, AI credit usage, and the API activity log.
import { z } from "zod";
import type { ActivityEntry, CreditUsageResponse, ListEnvelope, Organization } from "../client/types.ts";
import { isValidDateFilter, DATE_HELP } from "../lib/dates.ts";
import { invalidInput, okResult, paginationNote, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, count, join, ofTotal } from "./helpers.ts";
import { CREDIT_GROUP_BY, cursorSchema, dateSchema, limitSchema } from "./schemas.ts";

/** Returns a problem for the first bad date among the given fields, or undefined. */
function badDate(fields: Record<string, string | undefined>): string | undefined {
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && !isValidDateFilter(value)) {
      return `${name} "${value}" is not a date Superflow understands. ${DATE_HELP}`;
    }
  }
  return undefined;
}

export function organizationSummary(org: Organization): string {
  const members = org.seats?.members;
  const guests = org.seats?.guests;
  const credits = org.credits;
  return join(
    `${org.name ?? "The workspace"}${org.plan ? `: ${org.plan} plan` : ""}${org.owner?.name || org.owner?.email ? `, owner ${org.owner.name ?? org.owner.email}` : ""}.`,
    members && `Members: ${ofTotal(members.used, members.total)} seats used${members.invited ? `, ${members.invited} invited` : ""}.`,
    guests && `Guests: ${ofTotal(guests.used, guests.total)}${guests.invited ? `, ${guests.invited} invited` : ""}.`,
    org.projects && `Projects: ${ofTotal(org.projects.used, org.projects.total)}.`,
    credits
      ? `AI credits: ${count(credits.balance)} left (auto refill ${credits.auto_refill?.enabled ? "on" : "off"}).`
      : "AI credits: not available.",
  );
}

export const getOrganization = defineTool({
  name: "superflow_get_organization",
  title: "Get the workspace",
  description: [
    "Show the workspace: name, plan, owner, member and guest seats (used, invited, total), projects used against the plan limit, and the AI credit balance with auto refill. A total of null means unlimited.",
    "Use it for questions about seats, plan limits or credits left. For who you are and your key's scopes use superflow_get_me. For where credits went use superflow_get_credit_usage.",
    "Example: {}",
  ].join("\n"),
  inputSchema: {},
  annotations: READ_HINTS,
  write: false,
  async run(_args, { api }) {
    const org = await api.call<Organization>("getOrganization");
    return okResult(organizationSummary(org), asData(org));
  },
});

export const updateOrganization = defineTool({
  name: "superflow_update_organization",
  title: "Rename the workspace",
  description: [
    "Rename the workspace. Only the workspace owner can do this.",
    "Nothing else about the workspace changes here: plan, seats, billing and credits stay in the Superflow portal.",
    'Example: {"name": "Wonderist Studio"}',
  ].join("\n"),
  inputSchema: {
    name: z.string().min(1).max(100).describe("New workspace name, 1 to 100 characters."),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const org = await api.call<Organization>("updateOrganization", { body: { name: args.name } });
    return okResult(`Renamed the workspace to ${org.name ?? args.name}.`, asData(org));
  },
});

export const getCreditUsage = defineTool({
  name: "superflow_get_credit_usage",
  title: "AI credit usage",
  description: [
    "Show where AI credits went: credits and runs grouped by project, agent or day, for a date range (default the last 30 days).",
    "Use it for questions like which project or agent used the most credits this month, or credits per day. For the balance left use superflow_get_organization.",
    'Example: {"group_by": "agent", "since": "this_week"}',
  ].join("\n"),
  inputSchema: {
    group_by: z.enum(CREDIT_GROUP_BY).describe("Group by project, agent or day."),
    since: dateSchema("Start of the range. Default 30 days ago."),
    until: dateSchema("End of the range. Default now."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const problem = badDate({ since: args.since, until: args.until });
    if (problem) return invalidInput(problem);
    const usage = await api.call<CreditUsageResponse>("getCreditUsage", {
      query: { group_by: args.group_by, since: args.since, until: args.until },
    });
    const rows = usage.rows ?? [];
    const runs = rows.reduce((sum, row) => sum + (row.runs ?? 0), 0);
    const top = rows
      .slice(0, 6)
      .map((row) => `${row.label}: ${count(row.credits)}`)
      .join(", ");
    const since = typeof usage.applied_filters?.since === "string" ? ` since ${usage.applied_filters.since}` : "";
    const summary = join(
      `${count(usage.total_credits)} AI credits over ${plural(runs, "run")}${since}, by ${args.group_by}${top ? `: ${top}${rows.length > 6 ? ", ..." : ""}` : ""}.`,
      usage.scan?.complete === false &&
        `The API read ${count(usage.scan.scanned)} ledger entries and stopped early, so the totals may be low. Narrow the dates for a full answer.`,
    );
    return okResult(summary, asData(usage));
  },
});

export const listActivity = defineTool({
  name: "superflow_list_activity",
  title: "List API activity",
  description: [
    "List changes made through the Superflow API (by this server or any other API key), newest first: who changed what, and when. Filter by person, by any id (a comment, project, tag and so on), by action, or by dates.",
    "Use it to audit what an assistant or a teammate's script changed. Changes made in the Superflow app or toolbar are not in this log.",
    'Example: {"actor": "me", "since": "7d"}',
  ].join("\n"),
  inputSchema: {
    actor: z.string().min(1).optional().describe('Who made the change: name, email, id or "me".'),
    entity: z.string().min(1).optional().describe("Only changes to this item: any id (cmt_..., prj_..., tag_..., usr_...)."),
    action: z
      .string()
      .min(1)
      .optional()
      .describe("Only this API action, for example updateComment, bulkUpdateComments, inviteGuests or deleteProject."),
    since: dateSchema("Changes at or after."),
    until: dateSchema("Changes before."),
    limit: limitSchema,
    cursor: cursorSchema,
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const problem = badDate({ since: args.since, until: args.until });
    if (problem) return invalidInput(problem);
    const list = await api.call<ListEnvelope<ActivityEntry>>("listActivity", {
      query: {
        actor: args.actor,
        entity: args.entity,
        action: args.action,
        since: args.since,
        until: args.until,
        limit: args.limit,
        cursor: args.cursor,
      },
    });
    const items = list.items ?? [];
    const latest = items[0];
    const summary = join(
      `Found ${plural(items.length, "change")}.`,
      latest && `Latest: ${latest.action} by ${latest.actor?.name ?? latest.actor?.email ?? "unknown"} at ${latest.at}.`,
      paginationNote(list),
    );
    return okResult(summary, asData(list));
  },
});

export const organizationTools = [getOrganization, updateOrganization, getCreditUsage, listActivity];
