// Shared zod shapes. The comment filters mirror CONTRACT section 6.2 exactly and are used
// by superflow_list_comments, superflow_comment_stats, superflow_export_comments and the
// bulk tool's filter object.
import { z } from "zod";

export const PRIORITIES = ["none", "low", "medium", "high", "critical"] as const;
export const DEVICES = ["desktop", "mobile", "tablet"] as const;
export const AUTHOR_TYPES = ["member", "guest", "agent"] as const;
export const SOURCES = ["widget", "extension", "figma", "voice", "api", "agent"] as const;
export const SORTS = ["updated_desc", "created_desc", "created_asc", "priority_desc", "page", "number"] as const;
export const GROUP_BY = [
  "status",
  "priority",
  "assignee",
  "author",
  "author_type",
  "page",
  "tag",
  "project",
  "source",
  "device",
  "day",
  "week",
] as const;
export const METRICS = ["count", "avg_hours_to_resolve", "median_hours_to_first_reply"] as const;
export const EXPORT_FORMATS = ["csv", "json", "markdown"] as const;

const DATE_DESCRIPTION = "ISO date (2026-10-01) or a token: 24h, 7d, 2w, 1m, today, yesterday, this_week, last_week.";

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(25)
  .describe("How many rows to return, 1 to 100. Default 25.");

export const cursorSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Opaque cursor from a previous call's next_cursor. Use it with the same filters to get the next page.");

export const projectRefSchema = z
  .string()
  .min(1)
  .describe("Project: its name (\"Acme Dental\"), site URL or domain (\"acme.com\"), or id (prj_...).");

export const commentRefSchema = z
  .string()
  .min(1)
  .describe("Comment: its number (\"4821\" or \"#4821\") or id (cmt_...). Numbers need a project.");

export const projectForNumberSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Project for a comment number (name, site URL or id). Not needed for cmt_ ids. Defaults to SUPERFLOW_DEFAULT_PROJECT when set.");

export const peopleListSchema = (what: string) =>
  z
    .array(z.string().min(1))
    .optional()
    .describe(`${what}: names, emails or ids (usr_..., gst_...), or "me".`);

export const anchorSchema = z
  .object({
    selector: z.string().optional().describe("CSS selector of the element."),
    xpath: z.string().optional().describe("XPath of the element."),
    x: z.number().min(0).max(1).optional().describe("Horizontal position as a fraction of the width, 0 to 1."),
    y: z.number().min(0).max(1).optional().describe("Vertical position as a fraction of the height, 0 to 1."),
    element_text: z.string().optional().describe("Visible text of the element."),
    viewport: z
      .object({
        width: z.number().int().positive().describe("Viewport width in CSS pixels."),
        height: z.number().int().positive().describe("Viewport height in CSS pixels."),
      })
      .optional()
      .describe("Viewport the comment was made in."),
    device: z.enum(DEVICES).optional().describe("Device type."),
  })
  .describe("Where on the page the comment is pinned. Omit for a page-level comment.");

export const attachmentInputSchema = z.object({
  url: z.string().url().describe("Public https URL of an image, video or PDF, at most 25 MB. Superflow downloads it."),
  name: z.string().min(1).optional().describe("File name to show. Defaults to the URL's file name."),
});

/** CONTRACT 6.2 filters (everything except the listing controls sort, limit, cursor, fields). */
export const filterShape = {
  project: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional()
    .describe("Project or projects: name, site URL, domain or id. Omit for every project the key can see."),
  page_url: z.string().min(1).optional().describe("Page URL to match. See page_match."),
  page_match: z
    .enum(["exact", "prefix", "contains"])
    .optional()
    .describe("How page_url matches: exact (default; ignores the query string unless you give one), prefix, or contains."),
  status: z
    .array(z.string().min(1))
    .optional()
    .describe("Status names or ids, or the words \"open\" (every unresolved status) and \"resolved\"."),
  priority: z.array(z.enum(PRIORITIES)).optional().describe("Priorities to include."),
  assignee: z
    .array(z.string().min(1))
    .optional()
    .describe("Assignees: names, emails, ids, \"me\", or \"unassigned\" for comments with no assignee."),
  author: peopleListSchema("Authors"),
  author_type: z.array(z.enum(AUTHOR_TYPES)).optional().describe("member (your team), guest (clients and reviewers) or agent (AI review agents)."),
  tags: z.array(z.string().min(1)).optional().describe("Tag names or ids. See tags_match."),
  tags_match: z.enum(["any", "all"]).optional().describe("any (default): a comment with any of the tags. all: every tag."),
  query: z.string().min(1).optional().describe("Case-insensitive text search over every message in the thread."),
  created_after: z.string().min(1).optional().describe(`Created at or after. ${DATE_DESCRIPTION}`),
  created_before: z.string().min(1).optional().describe(`Created before. ${DATE_DESCRIPTION}`),
  updated_after: z.string().min(1).optional().describe(`Last activity at or after. ${DATE_DESCRIPTION}`),
  updated_before: z.string().min(1).optional().describe(`Last activity before. ${DATE_DESCRIPTION}`),
  resolved_after: z
    .string()
    .min(1)
    .optional()
    .describe(`Approximate: resolved threads whose last update is at or after this. ${DATE_DESCRIPTION}`),
  resolved_before: z
    .string()
    .min(1)
    .optional()
    .describe(`Approximate: resolved threads whose last update is before this. ${DATE_DESCRIPTION}`),
  has_attachments: z.boolean().optional().describe("true: only threads with attachments. false: only threads without."),
  has_replies: z.boolean().optional().describe("true: only threads with replies. false: only threads with none."),
  has_external_link: z.boolean().optional().describe("Linked to an external tracker. Matches nothing yet (Phase 1)."),
  unanswered: z
    .boolean()
    .optional()
    .describe("true: the last message is from a guest or agent and no team member replied after it."),
  stale_days: z.number().int().min(1).optional().describe("Not resolved and no activity for at least this many days."),
  device: z.array(z.enum(DEVICES)).optional().describe("Device the comment was made on."),
  source: z
    .array(z.enum(SOURCES))
    .optional()
    .describe("Where the comment came from: widget (toolbar), agent, api, figma, voice, extension."),
  agent: z.string().min(1).optional().describe("AI review agent name or id (agt_...)."),
  agent_run: z.string().min(1).optional().describe("Agent run id (run_... or the raw execution id)."),
};

export const FILTER_KEYS = Object.keys(filterShape) as Array<keyof typeof filterShape>;

export const sortSchema = z.enum(SORTS).optional().describe("Sort order. Default updated_desc (most recent activity first).");

export const fieldsSchema = z
  .enum(["compact", "full"])
  .default("compact")
  .describe("compact (default): short rows. full: every field, use only when you need anchors, metadata or authors in detail.");

/** Picks the filter keys from parsed tool input, for a query string or a bulk filter object. */
export function pickFilters(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

export const idempotencySchema = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe("Optional key so a retried call is not applied twice. Same key within 24 hours returns the first result.");

// ---------------------------------------------------------------------------------------------
// Phase 2 (admin tools).
// ---------------------------------------------------------------------------------------------

/** Platforms with their own install steps (CONTRACT-P2 section 2). */
export const PLATFORMS = ["webflow", "shopify", "wordpress", "framer", "html", "netlify", "nextjs", "vercel", "other"] as const;
export const CREDIT_GROUP_BY = ["project", "agent", "day"] as const;
export const DIGEST_CADENCES = ["daily", "weekly", "monthly"] as const;
export const NOTIFICATION_LEVELS = ["all", "mine", "none"] as const;

export const platformSchema = z
  .enum(PLATFORMS)
  .optional()
  .describe("What the site is built with: webflow, shopify, wordpress, framer, html, netlify, nextjs, vercel or other.");

/** 1 to 10 email addresses. Invite tools send each one a real email. */
export const inviteEmailsSchema = (who: string) =>
  z
    .array(z.string().email())
    .min(1)
    .max(10)
    .describe(`${who}: 1 to 10 email addresses. Each one gets a real invite email.`);

/** The confirm flag of a destructive tool. */
export const confirmSchema = (action: string) =>
  z
    .boolean()
    .default(false)
    .describe(`Must be true to ${action}. Set it only after the user explicitly agreed in this conversation.`);

export const dateSchema = (what: string) => z.string().min(1).optional().describe(`${what} ${DATE_DESCRIPTION}`);

/** An absolute http or https URL, as the API requires for sites, domains and pages. */
export const httpUrlSchema = z
  .string()
  .url()
  .max(2000)
  .regex(/^https?:\/\//i, "must be an http or https URL, for example https://acme.com");

/** A hex color, as the API requires for statuses and tags. */
export const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color like #605CEC");
