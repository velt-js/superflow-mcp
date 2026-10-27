// Checks (spec addendum "Checks tools"): the layer above comments. A check is one kind of
// problem on a site (broken links, images without alt text), with every finding of that kind
// under it. Fixing is a claim: the scan verifies it, and a finding that is still there reopens.
import { z } from "zod";
import { CONFIRM_EXCLUDE_CHECK_MESSAGE, CONFIRM_MARK_CHECK_FIXED_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, okResult, plural } from "../lib/format.ts";
import { normalizeCommentRef, projectForComment } from "../lib/resolve.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, count, join } from "./helpers.ts";
import { POLL_SECONDS } from "./runs.ts";
import { commentRefSchema, confirmSchema, cursorSchema, projectForNumberSchema, projectRefSchema } from "./schemas.ts";

export const CHECK_STATES = ["failing", "passing", "excluded"] as const;
export const CHECK_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const CHECK_COMMENT_STATUSES = ["open", "resolved", "rejected"] as const;
/** The four reasons a person rejects a finding or excludes a check for. "Already fixed" is a resolve. */
export const REJECT_REASONS = ["wrong", "not_important", "not_applicable", "cannot_tell"] as const;

/** The fix-list priority of a check's severity (critical is P0). */
const PRIORITY_OF: Record<string, string> = { critical: "P0", high: "P1", medium: "P2", low: "P3" };

const ruleKeySchema = z
  .string()
  .min(1)
  .max(120)
  .describe("The check's rule key, for example link-broken or image-alt (superflow_list_failing_checks lists a site's checks).");

const reasonSchema = z
  .enum(REJECT_REASONS)
  .describe("wrong (the agent is mistaken), not_important, not_applicable (does not apply to this site) or cannot_tell. If it was fixed, resolve it instead.");

const ownerRefSchema = z
  .string()
  .min(1)
  .max(320)
  .nullable()
  .describe("A workspace member: name, email, id (usr_...) or me. null means the project admin.");

interface Person {
  id: string;
  name: string | null;
  email: string | null;
}

interface Check {
  rule_key: string;
  title: string;
  severity: string;
  responsibility: string;
  fix_guide: string | null;
  state: string;
  open_count: number;
  page_count: number;
  score_impact: number;
  owner: Person | null;
  owner_is_default: boolean;
}

interface CheckList {
  project: { id: string; name: string };
  items: Check[];
  excluded_count: number;
  grouping_in_progress: boolean;
  writes_pending: boolean;
}

interface CheckComment {
  id: string;
  title: string;
  status: string;
  pending_verify: boolean;
  verified_at: string | null;
  scope: string;
  page_url: string | null;
  page_count: number;
}

interface CheckDetails {
  project: { id: string; name: string };
  check: Check | null;
  status: string;
  comments: CheckComment[];
  next_cursor: string | null;
}

interface CheckResolved {
  project: { id: string; name: string };
  rule_key: string;
  resolved: number;
  already_pending: number;
  verify_run_ids: string[];
  truncated: boolean;
}

interface SiteScore {
  project: { id: string; name: string };
  site_score: number | null;
  recent_runs: Array<{ run_id: string; site_score: number | null; at: string | null }>;
  pages: Array<{ url: string; score: number | null; open_count: number }>;
  next_pages_cursor: string | null;
  total_pages: number;
  excluded_count: number;
  next_scan_at: string | null;
}

interface CheckSettings {
  project: { id: string; name: string };
  confidence_floor: number;
  default_owners: Record<"content" | "design" | "dev", Person | null>;
}

const personName = (person: Person | null | undefined): string => (person ? person.name ?? person.email ?? person.id : "the project admin");

/** "P0 Broken link: 3 open on 212 pages" for one check. */
function checkLine(check: Check): string {
  const priority = PRIORITY_OF[check.severity] ?? check.severity;
  return `${priority} ${check.title} (${check.rule_key}): ${plural(check.open_count, "open finding")} on ${plural(check.page_count, "page")}`;
}

export const listFailingChecks = defineTool({
  name: "superflow_list_failing_checks",
  title: "List a site's failing checks",
  description: [
    "What is broken on a site, one row per kind of problem (a check), worst first by how much fixing it raises the site score. Each row has the open findings and pages it covers, its owner and severity (critical is P0, high P1, medium P2).",
    "Use it first when the user asks what is broken, what to fix first, or for the fix list. Then read one check with superflow_get_check_details.",
    "Not for one comment or a person's feedback: use superflow_list_comments. Passing and excluded checks are listed with state.",
    'Example: {"project": "dental-smiles.com"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    state: z.enum([...CHECK_STATES, "all"]).default("failing").describe("failing (default), passing, excluded, or all."),
    severity: z.enum(CHECK_SEVERITIES).optional().describe("Only checks of this severity."),
    agent: z.string().min(1).optional().describe("Only checks this agent reports (name or id)."),
    owner: z.string().min(1).optional().describe("Only checks this member owns: name, email, id or me."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const { project, state, ...rest } = args;
    const result = await api.call<CheckList>("listChecks", {
      path: { project },
      query: compact({ ...rest, state: state === "all" ? undefined : state }),
    });
    const items = result.items ?? [];
    const name = result.project?.name ?? project;
    const label = state === "all" ? "" : `${state} `;
    return okResult(
      join(
        items.length ? `${plural(items.length, `${label}check`)} on ${name}, worst first: ${items.slice(0, 5).map(checkLine).join("; ")}.` : `No ${label}checks on ${name}.`,
        items.length > 5 && `${items.length - 5} more in the data.`,
        result.excluded_count > 0 && `${plural(result.excluded_count, "check")} excluded.`,
        result.grouping_in_progress && "A run is still grouping its findings, so counts may change in a minute.",
      ),
      asData(result),
      { untrusted: false },
    );
  },
});

export const getCheckDetails = defineTool({
  name: "superflow_get_check_details",
  title: "Get one check and its findings",
  description: [
    "One check: what it looks for, how to fix it, its counts and owner, and its findings (default the open ones, 20 at a time) with their pages and whether a fix is waiting for its verify rescan.",
    "Use it after superflow_list_failing_checks, before fixing, and after superflow_mark_check_fixed to see what the rescan verified (verified_at) or reopened. status resolved or rejected lists those instead.",
    "To read one finding in full (replies, anchor) use superflow_get_comment with its id. To find the HTML of a finding use superflow_get_finding_source.",
    'Example: {"project": "dental-smiles.com", "rule_key": "image-alt"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    rule_key: ruleKeySchema,
    status: z.enum(CHECK_COMMENT_STATUSES).default("open").describe("Which findings: open (default), resolved or rejected."),
    limit: z.number().int().min(1).max(100).default(20).describe("Findings per page, default 20, at most 100."),
    cursor: cursorSchema,
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const { project, rule_key, ...query } = args;
    const result = await api.call<CheckDetails>("getCheck", { path: { project, rule_key }, query: compact(query) });
    const check = result.check;
    const comments = result.comments ?? [];
    const waiting = comments.filter((comment) => comment.pending_verify).length;
    return okResult(
      join(
        check ? `${checkLine(check)}. Owner: ${personName(check.owner)}.` : `Check ${rule_key} has no record yet.`,
        `${plural(comments.length, `${result.status} finding`)} listed.`,
        waiting > 0 && `${waiting} waiting for the verify rescan.`,
        check?.fix_guide && `How to fix: ${check.fix_guide}`,
        result.next_cursor && "More findings: call again with cursor.",
      ),
      asData(result),
    );
  },
});

export const getSiteScore = defineTool({
  name: "superflow_get_site_score",
  title: "Get a site's score",
  description: [
    "The site score (0 to 100), the score after each of the last runs, and the pages lowest score first.",
    "Use it to report progress (\"81 to 94\") before and after fixing, or to find the worst pages. Pages come 20 at a time; pass pages_cursor for more.",
    "For what to fix use superflow_list_failing_checks.",
    'Example: {"project": "dental-smiles.com"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    page_size: z.number().int().min(1).max(200).default(20).describe("Pages per read, default 20, at most 200."),
    pages_cursor: z.string().min(1).optional().describe("next_pages_cursor from the read before."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const { project, ...query } = args;
    const result = await api.call<SiteScore>("getSiteScore", { path: { project }, query: compact(query) });
    const runs = result.recent_runs ?? [];
    const previous = runs.length > 1 ? runs[1]?.site_score : null;
    const worst = (result.pages ?? [])[0];
    return okResult(
      join(
        typeof result.site_score === "number" ? `${result.project?.name ?? project} scores ${result.site_score}.` : `${result.project?.name ?? project} has no score yet (no scan finished).`,
        typeof previous === "number" && typeof result.site_score === "number" && previous !== result.site_score && `It was ${previous} the run before.`,
        `${plural(result.total_pages ?? 0, "page")} scored.`,
        worst && `Lowest: ${worst.url} (${worst.score ?? "no score"}, ${plural(worst.open_count, "open finding")}).`,
        result.next_pages_cursor && "More pages: call again with pages_cursor.",
      ),
      asData(result),
      { untrusted: false },
    );
  },
});

export const markCheckFixed = defineTool({
  name: "superflow_mark_check_fixed",
  title: "Mark a check fixed",
  description: [
    "Say a whole check is fixed after you fixed it on the site: every open finding of it is resolved, and Superflow rescans their pages to verify. A finding that is still there reopens, so this is a claim the scan checks, never the final word.",
    "Without confirm: true nothing changes: you get the open count to show the user. The rescan costs 1 credit. Call again with confirm: true only after the user says yes (an approved fix list counts).",
    `Then wait a minute and check with superflow_get_check_details (verified_at, or the finding reopened), or follow a run id with superflow_get_run no more often than every ${POLL_SECONDS} seconds. For one finding use superflow_resolve_comment, which verifies the same way.`,
    'Example: {"project": "dental-smiles.com", "rule_key": "image-alt", "confirm": true}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    rule_key: ruleKeySchema,
    confirm: confirmSchema("resolve every open finding of the check and rescan their pages"),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const { project, rule_key } = args;
    if (!isConfirmed(args.confirm)) {
      const details = await api.call<CheckDetails>("getCheck", { path: { project, rule_key }, query: { status: "open", limit: 20 } });
      const open = details.check?.open_count ?? details.comments?.length ?? 0;
      return confirmationResult(
        `${details.check ? checkLine(details.check) : `Check ${rule_key}`}. Marking it fixed resolves ${plural(open, "open finding")} and rescans their pages (1 credit). Nothing was resolved. Ask the user to confirm.`,
        { preview: { check: details.check, open_count: open }, message: CONFIRM_MARK_CHECK_FIXED_MESSAGE },
      );
    }
    const result = await api.call<CheckResolved>("resolveCheck", { path: { project, rule_key } });
    return okResult(
      join(
        result.resolved > 0 ? `Marked ${rule_key} fixed: ${plural(result.resolved, "finding")} resolved, rescan queued.` : `Nothing new to resolve on ${rule_key}.`,
        result.already_pending > 0 && `${result.already_pending} already waiting for their rescan.`,
        result.truncated && "Some findings stayed open (over the server limit): call again to resolve the rest.",
        `Check again in a minute with superflow_get_check_details; a finding that is still there reopens.`,
      ),
      asData(result),
      { untrusted: false },
    );
  },
});

export const excludeCheck = defineTool({
  name: "superflow_exclude_check",
  title: "Exclude a check for a site",
  description: [
    "Turn off one check for a site because it does not apply (\"this site has no phone number\"): its open findings are rejected with the reason and new ones are kept out. superflow_include_check undoes it and brings exactly those findings back.",
    "Without confirm: true nothing changes: you get the check and its open count to show the user. Call again with confirm: true only after the user says yes.",
    "Not for one wrong finding: use superflow_reject_comment. Not for a fixed problem: use superflow_mark_check_fixed.",
    'Example: {"project": "dental-smiles.com", "rule_key": "link-unlinked-phone", "reason": "not_applicable", "confirm": true}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    rule_key: ruleKeySchema,
    reason: reasonSchema,
    confirm: confirmSchema("exclude the check for this site"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    const { project, rule_key, reason } = args;
    if (!isConfirmed(args.confirm)) {
      const details = await api.call<CheckDetails>("getCheck", { path: { project, rule_key }, query: { status: "open", limit: 20 } });
      const open = details.check?.open_count ?? details.comments?.length ?? 0;
      return confirmationResult(
        `${details.check ? checkLine(details.check) : `Check ${rule_key}`}. Excluding it rejects ${plural(open, "open finding")} as ${reason} and keeps new ones out. Nothing was excluded. Ask the user to confirm.`,
        { preview: { check: details.check, open_count: open, reason }, message: CONFIRM_EXCLUDE_CHECK_MESSAGE },
      );
    }
    const result = await api.call<Record<string, unknown>>("excludeCheck", { path: { project, rule_key }, body: { reason } });
    return okResult(`Excluded ${rule_key} (${reason}). Undo with superflow_include_check.`, asData(result), { untrusted: false });
  },
});

export const includeCheck = defineTool({
  name: "superflow_include_check",
  title: "Include an excluded check",
  description: [
    "Turn an excluded check back on for a site: the findings its exclusion rejected come back as they were, and the next scan reports it again.",
    "Use it when the user changed their mind about an exclusion. Safe to repeat.",
    "To see which checks are excluded use superflow_list_failing_checks with state excluded.",
    'Example: {"project": "dental-smiles.com", "rule_key": "link-unlinked-phone"}',
  ].join("\n"),
  inputSchema: { project: projectRefSchema, rule_key: ruleKeySchema },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const result = await api.call<Record<string, unknown>>("includeCheck", { path: { project: args.project, rule_key: args.rule_key } });
    return okResult(`Included ${args.rule_key} again.`, asData(result), { untrusted: false });
  },
});

export const assignCheckOwner = defineTool({
  name: "superflow_assign_check_owner",
  title: "Assign a check's owner",
  description: [
    "Set the workspace member who owns one check (they get its alerts and it lists under them), or null to follow the project's default owner for that kind of work.",
    "Use it when the user hands a kind of problem to someone (\"Dana owns broken links\"). For the defaults per kind of work use superflow_set_default_owners. To assign one comment use superflow_update_comment.",
    'Example: {"project": "dental-smiles.com", "rule_key": "link-broken", "owner": "dana@agency.com"}',
  ].join("\n"),
  inputSchema: { project: projectRefSchema, rule_key: ruleKeySchema, owner: ownerRefSchema },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const result = await api.call<{ owner: Person | null }>("setCheckOwner", { path: { project: args.project, rule_key: args.rule_key }, body: { owner: args.owner } });
    return okResult(
      result.owner ? `${personName(result.owner)} now owns ${args.rule_key}.` : `${args.rule_key} now follows the project's default owner.`,
      asData(result),
      { untrusted: false },
    );
  },
});

export const rejectComment = defineTool({
  name: "superflow_reject_comment",
  title: "Reject an agent finding",
  description: [
    "Say an agent finding is wrong or does not matter, with one of four reasons. It leaves the open list and the score, no scan reopens it, and the reason teaches the agent. It cannot be undone, so ask the user first.",
    "Use it when the user disagrees with a finding. If it was fixed, use superflow_resolve_comment instead (the scan verifies it). For a whole check that does not apply use superflow_exclude_check. A person's comment cannot be rejected; resolve it or leave it.",
    'Example: {"comment": "cmt_abc123", "reason": "wrong", "note": "The image is decorative."}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: projectForNumberSchema,
    reason: reasonSchema,
    note: z.string().min(1).max(2000).optional().describe("The user's own words, kept with the reason."),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api, config }) {
    const result = await api.call<{ comment: { id: string; number?: number | null } }>("rejectComment", {
      path: { comment: normalizeCommentRef(args.comment) },
      body: compact({ project: projectForComment(args.comment, args.project, config.defaultProject), reason: args.reason, note: args.note }),
    });
    const label = result.comment?.number ? `#${result.comment.number}` : result.comment?.id ?? args.comment;
    return okResult(`Rejected ${label} as ${args.reason}.`, asData(result));
  },
});

export const getFindingSource = defineTool({
  name: "superflow_get_finding_source",
  title: "Find a finding in the page's HTML",
  description: [
    "Where an agent finding sits in the HTML Superflow stored for its page: the line, its number and the matching part, so you can find the code or CMS field to change.",
    "Use it before fixing a finding whose selector is not enough to find it in the code. For a site-wide finding pass page_url to read another page.",
    "Not for the screenshot or the comment thread: use superflow_get_comment.",
    'Example: {"comment": "cmt_abc123"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: projectForNumberSchema,
    page_url: z.string().url().optional().describe("Another page of a site-wide finding."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api, config }) {
    const result = await api.call<{ page_url: string | null; line_number: number | null; line: string }>("getCommentSource", {
      path: { comment: normalizeCommentRef(args.comment) },
      query: compact({ project: projectForComment(args.comment, args.project, config.defaultProject), page_url: args.page_url }),
    });
    return okResult(
      typeof result.line_number === "number" ? `Line ${result.line_number} of ${result.page_url ?? "the stored page"}.` : "The evidence was not found in the stored HTML; the line shows the evidence itself.",
      asData(result),
    );
  },
});

export const getCheckSettings = defineTool({
  name: "superflow_get_check_settings",
  title: "Get a site's check settings",
  description: [
    "The confidence floor (findings under it write no comment) and the default owner for each kind of work (content, design, dev); null is the project admin.",
    "Use it before changing owners, or when the user asks who gets a site's alerts.",
    "To change owners use superflow_set_default_owners.",
    'Example: {"project": "dental-smiles.com"}',
  ].join("\n"),
  inputSchema: { project: projectRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const result = await api.call<CheckSettings>("getCheckSettings", { path: { project: args.project } });
    const owners = result.default_owners ?? { content: null, design: null, dev: null };
    return okResult(
      `Confidence floor ${count(result.confidence_floor)}. Content: ${personName(owners.content)}; design: ${personName(owners.design)}; dev: ${personName(owners.dev)}.`,
      asData(result),
      { untrusted: false },
    );
  },
});

export const setDefaultOwners = defineTool({
  name: "superflow_set_default_owners",
  title: "Set a site's default owners",
  description: [
    "Set who owns each kind of work on a site by default: content (copy, alt text, links in the CMS), design and dev. A check with no owner of its own goes to the owner of its kind. Leave one out to keep it; null makes it the project admin.",
    "Use it when the user sets up a site's team. For one check use superflow_assign_check_owner.",
    'Example: {"project": "dental-smiles.com", "content": "dana@agency.com", "dev": "me"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    content: ownerRefSchema.optional(),
    design: ownerRefSchema.optional(),
    dev: ownerRefSchema.optional(),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const { project, ...owners } = args;
    const changes = compact(owners);
    if (!Object.keys(changes).length) {
      const current = await api.call<CheckSettings>("getCheckSettings", { path: { project } });
      return okResult("Nothing to change: pass content, design or dev.", asData(current), { untrusted: false });
    }
    const result = await api.call<CheckSettings>("updateCheckSettings", { path: { project }, body: { default_owners: changes } });
    const set = result.default_owners ?? { content: null, design: null, dev: null };
    return okResult(
      `Default owners of ${result.project?.name ?? project}: content ${personName(set.content)}, design ${personName(set.design)}, dev ${personName(set.dev)}.`,
      asData(result),
      { untrusted: false },
    );
  },
});

export const checkTools = [
  listFailingChecks,
  getCheckDetails,
  getSiteScore,
  getFindingSource,
  markCheckFixed,
  excludeCheck,
  includeCheck,
  assignCheckOwner,
  rejectComment,
  getCheckSettings,
  setDefaultOwners,
];
