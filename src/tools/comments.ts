// The 14 comment tools: read, filter, count, export, write, reply, delete, bulk.
import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type {
  Attachment,
  BulkDryRunResponse,
  BulkRunResponse,
  CommentCompact,
  CommentFull,
  CreateReplyResponse,
  DeleteResponse,
  ExportResponse,
  ListEnvelope,
  Reply,
  ResolveResponse,
  StatsResponse,
  VerifyInfo,
} from "../client/types.ts";
import {
  CONFIRM_BULK_MESSAGE,
  CONFIRM_DELETE_COMMENT_MESSAGE,
  CONFIRM_DELETE_REPLY_MESSAGE,
  bulkMode,
  isConfirmed,
} from "../lib/confirm.ts";
import { findInvalidDate } from "../lib/dates.ts";
import {
  confirmationResult,
  describeFilters,
  errorResult,
  invalidInput,
  okResult,
  paginationNote,
  plural,
  scanNote,
  toCompactComment,
} from "../lib/format.ts";
import { normalizeCommentRef, parseReplyId } from "../lib/resolve.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import type { Data } from "./helpers.ts";
import { asData, compact, join } from "./helpers.ts";
import {
  EXPORT_FORMATS,
  GROUP_BY,
  METRICS,
  anchorSchema,
  attachmentInputSchema,
  commentProjectSchema,
  commentRefSchema,
  cursorSchema,
  fieldsSchema,
  filterShape,
  idempotencySchema,
  limitSchema,
  pickFilters,
  projectRefSchema,
  sortSchema,
  TAG_PRIVACY_NOTE,
  tagInputSchema,
} from "./schemas.ts";


function commentSummary(comment: CommentFull): string {
  const assignee = comment.assignees?.[0]?.name;
  const page = comment.page?.url ? ` on ${comment.page.url}` : "";
  const status = comment.status?.name ?? "unknown status";
  // A rejected agent finding keeps its status but is not open: say so first.
  const state = comment.rejected
    ? `rejected${comment.rejected.reason ? ` (${comment.rejected.reason})` : ""}, not open (status ${status})`
    : status;
  return (
    `Comment ${comment.id} in ${comment.project?.name ?? "its project"}${page}: ` +
    `${state}, ${comment.priority ?? "no"} priority, ` +
    `${assignee ? `assigned to ${assignee}` : "unassigned"}, ${plural(comment.reply_count ?? 0, "reply", "replies")}. ` +
    `Link: ${comment.url}`
  );
}

const statusInput = z
  .string()
  .min(1)
  .optional()
  .describe('Status name or id. "open" means the default status and "resolved" the resolved status.');
const PRIORITY_NOTE = "Superflow has three priorities: critical (P0), high (P1) and medium (P2).";
const UNASSIGN_NOTE = "Removing the assignee is not supported yet: tell the user to unassign in the Superflow toolbar.";

const createPriorityInput = z
  .enum(["critical", "high", "medium", "none"])
  .optional()
  .describe(`${PRIORITY_NOTE} "none", or leaving it out, creates the comment without a priority.`);
const setPriorityInput = z
  .enum(["critical", "high", "medium"])
  .optional()
  .describe(`${PRIORITY_NOTE} Clearing a priority is not supported yet.`);
const createAssigneesInput = z
  .array(z.string().min(1))
  .min(1)
  .max(1)
  .optional()
  .describe('The assignee: one name, email or id, or "me". A comment has one assignee. Leave it out for no assignee.');
const setAssigneesInput = (what: string) =>
  z
    .array(z.string().min(1))
    .min(1)
    .max(1)
    .optional()
    .describe(`${what}: one name, email or id, or "me". It replaces the current assignee, since a comment has one. ${UNASSIGN_NOTE}`);

/** Clearing the assignee is not supported yet (CONTRACT 6.3). Refuse it before calling the API. */
function refuseUnassign(...lists: Array<readonly string[] | undefined>): CallToolResult | undefined {
  const clears = lists.some((list) => list?.some((value) => value.trim().toLowerCase() === "unassigned"));
  if (!clears) return undefined;
  return invalidInput(
    "Removing the assignee is not supported yet.",
    "Assign someone else, or tell the user to unassign the comment in the Superflow toolbar.",
  );
}
const TAG_NOTE = `Use tag names. A tag_ id works only for a tag already on the comment. {"name", "color"} sets the color of this comment's copy of the tag only, so one tag can show two colors. A new name creates the tag for the whole workspace (default color #605CEC). ${TAG_PRIVACY_NOTE}`;
const tagsInput = (what: string) => z.array(tagInputSchema).optional().describe(`${what} ${TAG_NOTE}`);
const idempotencyInput = idempotencySchema;

// ---------------------------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------------------------

export const listComments = defineTool({
  name: "superflow_list_comments",
  title: "List comments",
  description: [
    "List comments in Superflow with filters. Use this to find, review or read specific comments: by project, page, status, assignee, author, tags, dates, text, device, source or agent run.",
    "AI agent findings are comments too. To work on one kind of finding, filter by rule_key (for example image-alt or link-broken): each row then carries rule_key and the agent's suggested_fix. For the list of what is broken, worst first, use superflow_list_failing_checks.",
    "For totals or breakdowns (how many per page, per status, per assignee) use superflow_comment_stats instead, it is cheaper. For a file of many rows use superflow_export_comments.",
    'Returns compact rows by default; set fields "full" only when you need every field. Pages with cursor.',
    'Example: {"project": "Acme Dental", "status": ["open"], "page_url": "acme.com/pricing", "page_match": "prefix"}',
  ].join("\n"),
  inputSchema: {
    ...filterShape,
    sort: sortSchema,
    limit: limitSchema,
    cursor: cursorSchema,
    fields: fieldsSchema,
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const badDate = findInvalidDate(args);
    if (badDate) return invalidInput(badDate);
    const list = await api.call<ListEnvelope<CommentCompact | CommentFull>>("listComments", {
      query: { ...pickFilters(args), sort: args.sort, limit: args.limit, cursor: args.cursor, fields: args.fields },
    });
    const items = list.items ?? [];
    const filters = describeFilters(list.applied_filters);
    const head =
      typeof list.total === "number"
        ? `${plural(list.total, "comment")} match${filters ? ` ${filters}` : ""}.`
        : `Found ${plural(items.length, "comment")}${filters ? ` ${filters}` : ""}.`;
    return okResult(join(head, paginationNote(list), scanNote(list.scan)), asData(list));
  },
});

export const getComment = defineTool({
  name: "superflow_get_comment",
  title: "Get a comment",
  description: [
    "Get one comment with every field: page, status, priority, assignee, author, tags, pin position, attachments, and its replies.",
    "Use it when you have a comment's id (cmt_...) or its link, for example after a list call, to read a thread in full.",
    "To find a comment by its page, text, author or status, or to list many, use superflow_list_comments.",
    'Example: {"comment": "cmt_8f3k2"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: commentProjectSchema,
    include_replies: z.boolean().default(true).describe("Include the thread's replies. Default true."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const comment = await api.call<CommentFull>("getComment", {
      path: { comment: normalizeCommentRef(args.comment) },
      query: { project: args.project, include_replies: args.include_replies },
    });
    return okResult(commentSummary(comment), asData(comment));
  },
});

export const commentStats = defineTool({
  name: "superflow_comment_stats",
  title: "Comment stats",
  description: [
    "Count comments grouped by one dimension (status, priority, assignee, author, author_type, page, tag, project, source, device, day or week), with the same filters as superflow_list_comments.",
    'Use it for "how many", "per page", "per assignee", "trend by week" and response-time questions (metrics avg_hours_to_resolve, median_hours_to_first_reply). It is much cheaper than listing.',
    "To read the comments behind a number use superflow_list_comments with the same filters.",
    'Example: {"project": "Acme Dental", "status": ["open"], "group_by": "page"}',
  ].join("\n"),
  inputSchema: {
    ...filterShape,
    group_by: z.enum(GROUP_BY).describe("The dimension to group by."),
    metrics: z
      .array(z.enum(METRICS))
      .optional()
      .describe("Metrics per group. Default [\"count\"]. Hours metrics may be approximate."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const badDate = findInvalidDate(args);
    if (badDate) return invalidInput(badDate);
    const stats = await api.call<StatsResponse>("getCommentStats", {
      query: { ...pickFilters(args), group_by: args.group_by, metrics: args.metrics },
    });
    const rows = stats.rows ?? [];
    const filters = describeFilters(stats.applied_filters);
    const top = rows
      .slice(0, 6)
      .map((row) => `${row.label}: ${row.count}`)
      .join(", ");
    const approx =
      stats.approximate_metrics && stats.approximate_metrics.length > 0
        ? `Approximate: ${stats.approximate_metrics.join(", ")}.`
        : "";
    const summary = join(
      `${plural(stats.total ?? 0, "comment")}${filters ? ` ${filters}` : ""} in ${plural(rows.length, "group")} by ${args.group_by}${top ? `: ${top}${rows.length > 6 ? ", ..." : ""}` : ""}.`,
      approx,
      scanNote(stats.scan),
    );
    return okResult(summary, asData(stats));
  },
});

export const exportComments = defineTool({
  name: "superflow_export_comments",
  title: "Export comments",
  description: [
    "Export the comments that match the filters as csv, json or markdown, for a report, a spreadsheet or a client update.",
    "Under 500 rows the file comes back inline in content; larger exports return a download_url that works for 1 hour.",
    "To read or count comments in the conversation use superflow_list_comments or superflow_comment_stats instead.",
    'Example: {"project": "Acme Dental", "status": ["resolved"], "updated_after": "this_week", "format": "markdown"}',
  ].join("\n"),
  inputSchema: {
    ...filterShape,
    sort: sortSchema,
    format: z.enum(EXPORT_FORMATS).describe("File format: csv, json or markdown."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const badDate = findInvalidDate(args);
    if (badDate) return invalidInput(badDate);
    const result = await api.call<ExportResponse>("exportComments", {
      query: { ...pickFilters(args), sort: args.sort, format: args.format },
    });
    const filters = describeFilters(result.applied_filters);
    const where = result.download_url
      ? `Download it from ${result.download_url}${result.expires_at ? ` (expires ${result.expires_at})` : ""}.`
      : "The file content is inline below.";
    const summary = join(
      `Exported ${plural(result.row_count ?? 0, "comment")}${filters ? ` ${filters}` : ""} as ${result.format ?? args.format}.`,
      where,
      scanNote(result.scan),
    );
    return okResult(summary, asData(result), {
      untrusted: typeof result.content === "string" && result.content !== "" && (result.row_count ?? 0) > 0,
    });
  },
});

// ---------------------------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------------------------

export const createComment = defineTool({
  name: "superflow_create_comment",
  title: "Create a comment",
  description: [
    "Create a new comment on a page of a project, as the key's member. Optionally pin it to an element, and set priority, status, assignee, tags and attachments.",
    "The comment is public, the same as a comment left with the Superflow toolbar in normal (not private) mode: everyone with access to the project can see it.",
    `${PRIORITY_NOTE} Use "none" or leave priority out for no priority.`,
    "Use it when the user asks to leave or log feedback on a page. To answer an existing thread use superflow_add_reply instead.",
    "Ask the user before creating comments they did not ask for.",
    'Example: {"project": "Acme Dental", "page_url": "https://acme.com/pricing", "text": "The CTA button overlaps the nav on mobile.", "priority": "high", "tags": ["mobile", {"name": "launch blocker", "color": "#b3261e"}]}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    page_url: z.string().min(1).describe("Full URL of the page the comment is about."),
    text: z.string().min(1).max(10_000).describe("The comment text. @Name or @email mentions notify those people."),
    anchor: anchorSchema.optional(),
    priority: createPriorityInput,
    status: statusInput,
    assignees: createAssigneesInput,
    tags: tagsInput("Tags to add."),
    attachments: z.array(attachmentInputSchema).max(10).optional().describe("Files to attach, by public URL."),
    on_behalf_of: z
      .string()
      .email()
      .optional()
      .describe("Post as this existing project guest (email). Needs the users:invite scope."),
    idempotency_key: idempotencyInput,
  },
  annotations: hints(false, false, false, false),
  write: true,
  async run(args, { api }) {
    const comment = await api.call<CommentFull>("createComment", {
      body: compact({
        project: args.project,
        page_url: args.page_url,
        text: args.text,
        anchor: args.anchor,
        priority: args.priority,
        status: args.status,
        assignees: args.assignees,
        tags: args.tags,
        attachments: args.attachments,
        on_behalf_of: args.on_behalf_of,
        // Generated once per tool call, so the client's own retries cannot double-post.
        idempotency_key: args.idempotency_key ?? randomUUID(),
      }),
    });
    const page = comment.page?.url ?? args.page_url;
    return okResult(
      `Created comment ${comment.id} on ${page} in ${comment.project?.name ?? args.project}. Link: ${comment.url}`,
      asData(comment),
    );
  },
});

export const updateComment = defineTool({
  name: "superflow_update_comment",
  title: "Update a comment",
  description: [
    "Change one comment: text, priority, status, assignee, tags (replace, add or remove; a new tag name creates the tag), page URL or pin position.",
    `${PRIORITY_NOTE} Clearing the priority or removing the assignee is not supported yet: set a different value, or tell the user to change it in the Superflow toolbar.`,
    "Use it for a single comment. To resolve or reopen prefer superflow_resolve_comment and superflow_reopen_comment (they can post a note). For many comments use superflow_bulk_update_comments.",
    "To attach a person's comment to a check an agent already found (a client's \"the Book now button is dead\" on the same element as a link-broken finding), set rule_key. It then lists, resolves and verifies with that check, in the portal too. null detaches it. An agent finding already belongs to its own check and cannot be attached.",
    "Ask the user before changing comments they did not ask about.",
    'Example: {"comment": "cmt_8f3k2", "priority": "high", "assignees": ["Jen"], "add_tags": ["mobile"]}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: commentProjectSchema,
    text: z.string().min(1).max(10_000).optional().describe("New text for the comment's first message."),
    priority: setPriorityInput,
    status: statusInput,
    assignees: setAssigneesInput("The new assignee"),
    add_assignees: setAssigneesInput("Same as assignees"),
    tags: tagsInput("Replace all tags with these. [] removes every tag."),
    add_tags: tagsInput("Tags to add."),
    remove_tags: z.array(z.string().min(1)).optional().describe("Tags to remove: names or tag_ ids."),
    page_url: z.string().min(1).optional().describe("Move the comment to this page URL."),
    anchor: anchorSchema.optional(),
    rule_key: z
      .string()
      .min(1)
      .max(64)
      .nullable()
      .optional()
      .describe("Attach a person's comment to a check by its rule key, for example link-broken or image-alt, so it lists and resolves with that check's findings. null detaches it."),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const { comment: ref, project, ...changes } = args;
    if (Object.values(changes).every((value) => value === undefined)) {
      return invalidInput(
        "Nothing to change. Give at least one of text, priority, status, assignees, add_assignees, tags, add_tags, remove_tags, page_url, anchor or rule_key.",
      );
    }
    const unassign = refuseUnassign(args.assignees, args.add_assignees);
    if (unassign) return unassign;
    const comment = await api.call<CommentFull>("updateComment", {
      path: { comment: normalizeCommentRef(ref) },
      body: compact({ project, ...changes }),
    });
    const verify = (comment as CommentFull & { verify?: VerifyInfo }).verify;
    return okResult(`Updated. ${commentSummary(comment)}${verify ? ` ${verifyNote(verify)}` : ""}`, asData(comment));
  },
});

/** One sentence on the verify rescan a resolve of an agent finding queued, or why none was. */
function verifyNote(verify: VerifyInfo): string {
  if (verify.no_rescan_reason === "imported_finding") {
    return "No rescan was queued and nothing was charged: it is an imported finding, and Superflow cannot rerun the outside agent that found it.";
  }
  if (verify.already_pending) return "It was already waiting for its verify rescan.";
  return "Its page is rescanned within a minute to verify it; check again with superflow_get_comment, or superflow_get_check_details for the check (a problem that is still there comes back as an open finding).";
}

function resolveTool(kind: "resolve" | "reopen") {
  const resolve = kind === "resolve";
  return defineTool({
    name: resolve ? "superflow_resolve_comment" : "superflow_reopen_comment",
    title: resolve ? "Resolve a comment" : "Reopen a comment",
    description: (resolve
      ? [
          "Mark one comment resolved, optionally posting a note as a reply first (for example what was fixed).",
          "On an agent finding this is a claim the scan checks: its page is rescanned within a minute (verify in the result), and a problem that is still there comes back as an open finding. If the finding is wrong rather than fixed, use superflow_reject_comment.",
          "An imported finding (from superflow_import_findings) with one of Superflow's rule keys is rescanned by Superflow's own agents like any finding. One with an ext- key is only resolved: Superflow cannot rerun the outside agent and none of its agents checks that kind, so no rescan is queued and no credit is spent.",
          "Safe to repeat: if it is already resolved nothing changes and the note is not posted.",
          "To resolve many comments at once use superflow_bulk_update_comments with patch {\"resolve\": true}. To undo use superflow_reopen_comment.",
          'Example: {"comment": "cmt_8f3k2", "note": "Fixed in the latest deploy, please check."}',
        ]
      : [
          "Reopen one resolved comment (back to the default status), optionally posting a note as a reply first.",
          "Safe to repeat: if it is already open nothing changes and the note is not posted.",
          "To reopen many comments use superflow_bulk_update_comments with patch {\"reopen\": true}.",
          'Example: {"comment": "cmt_8f3k2", "note": "Still broken on Safari."}',
        ]
    ).join("\n"),
    inputSchema: {
      comment: commentRefSchema,
      project: commentProjectSchema,
      note: z
        .string()
        .min(1)
        .max(10_000)
        .optional()
        .describe(resolve ? "Reply to post before resolving." : "Reply to post before reopening."),
    },
    annotations: hints(false, false, true, false),
    write: true,
    async run(args, { api }) {
      const result = await api.call<ResolveResponse>(resolve ? "resolveComment" : "reopenComment", {
        path: { comment: normalizeCommentRef(args.comment) },
        body: compact({ project: args.project, note: args.note }),
      });
      const label = result.comment?.id ?? args.comment;
      const link = result.comment?.url ? ` Link: ${result.comment.url}` : "";
      const summary = result.changed
        ? `${resolve ? "Resolved" : "Reopened"} comment ${label}${result.note_reply_id ? " and posted the note as a reply" : ""}.${result.verify ? ` ${verifyNote(result.verify)}` : ""}${link}`
        : `Comment ${label} was already ${resolve ? "resolved" : "open"}. Nothing changed${args.note ? " and the note was not posted" : ""}.${link}`;
      return okResult(summary, asData(result));
    },
  });
}

export const resolveComment = resolveTool("resolve");
export const reopenComment = resolveTool("reopen");

export const addReply = defineTool({
  name: "superflow_add_reply",
  title: "Reply to a comment",
  description: [
    "Post a reply in a comment thread, as the key's member. @Name, @First Last or @email in the text mention and notify people on the project.",
    "Use it to answer a comment or nudge someone. To close the thread with a note use superflow_resolve_comment with note instead.",
    "Ask the user before posting replies they did not ask for.",
    'Example: {"comment": "cmt_8f3k2", "text": "Fixed, please check. @Jen can you confirm on mobile?"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: commentProjectSchema,
    text: z.string().min(1).max(10_000).describe("Reply text. Mentions: @Name, @First Last or @email."),
    attachments: z.array(attachmentInputSchema).max(10).optional().describe("Files to attach, by public URL."),
    idempotency_key: idempotencyInput,
  },
  annotations: hints(false, false, false, false),
  write: true,
  async run(args, { api }) {
    const result = await api.call<CreateReplyResponse>("createReply", {
      path: { comment: normalizeCommentRef(args.comment) },
      body: compact({
        project: args.project,
        text: args.text,
        attachments: args.attachments,
        // Generated once per tool call, so the client's own retries cannot double-post.
        idempotency_key: args.idempotency_key ?? randomUUID(),
      }),
    });
    const unresolved = result.unresolved_mentions ?? [];
    const summary = join(
      `Replied to comment ${args.comment}${result.reply?.id ? ` (reply ${result.reply.id})` : ""}.`,
      unresolved.length > 0 &&
        `These mentions matched nobody and stayed plain text: ${unresolved.join(", ")}. Check names with superflow_list_members.`,
    );
    return okResult(summary, asData(result));
  },
});

export const updateReply = defineTool({
  name: "superflow_update_reply",
  title: "Edit a reply",
  description: [
    "Edit the text of one reply. Only the reply's author or a workspace owner or admin can edit it.",
    "Reply ids look like rpl_<comment>.<reply> and come from superflow_get_comment. To change a comment's first message use superflow_update_comment with text.",
    'Example: {"reply": "rpl_8f3k2.654321", "text": "Fixed in v2.3, please check again."}',
  ].join("\n"),
  inputSchema: {
    reply: z.string().min(1).describe("Reply id (rpl_...), from superflow_get_comment."),
    text: z.string().min(1).max(10_000).describe("New reply text."),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const reply = await api.call<Reply>("updateReply", { path: { reply: args.reply.trim() }, body: { text: args.text } });
    return okResult(`Updated reply ${reply.id ?? args.reply}.`, asData(reply));
  },
});

export const deleteReply = defineTool({
  name: "superflow_delete_reply",
  title: "Delete a reply",
  description: [
    "Delete one reply. Only the reply's author or a workspace owner or admin can delete it, and it cannot be restored.",
    "Without confirm: true nothing is deleted: you get the reply back as a preview to show the user. Call again with confirm: true only after the user says yes.",
    "To delete a whole thread use superflow_delete_comment.",
    'Example: {"reply": "rpl_8f3k2.654321"}',
  ].join("\n"),
  inputSchema: {
    reply: z.string().min(1).describe("Reply id (rpl_...), from superflow_get_comment."),
    confirm: z
      .boolean()
      .default(false)
      .describe("Must be true to delete. Set it only after the user explicitly agreed in this conversation."),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      const result = await api.call<DeleteResponse>("deleteReply", { path: { reply: args.reply.trim() } });
      return okResult(`Deleted reply ${result.id ?? args.reply}.`, asData(result));
    }
    const parsed = parseReplyId(args.reply);
    if (!parsed) {
      return invalidInput(
        `"${args.reply}" is not a reply id.`,
        "Reply ids look like rpl_<comment>.<reply>. Get them from superflow_get_comment.",
      );
    }
    const replies = await api.call<ListEnvelope<Reply>>("listReplies", { path: { comment: parsed.commentId } });
    const reply = (replies.items ?? []).find(
      (item) => item.id === parsed.replyId || item.id === args.reply.trim(),
    );
    if (!reply) {
      return errorResult(
        new SuperflowApiError({
          status: 404,
          code: "not_found",
          message: `No reply ${parsed.replyId} on comment ${parsed.commentId}.`,
          hint: "Get the thread with superflow_get_comment to see its reply ids.",
        }),
      );
    }
    return confirmationResult(
      `Reply ${reply.id} by ${reply.author?.name ?? "unknown"} would be deleted. Nothing was deleted. Ask the user to confirm.`,
      { preview: reply, message: CONFIRM_DELETE_REPLY_MESSAGE },
    );
  },
});

export const deleteComment = defineTool({
  name: "superflow_delete_comment",
  title: "Delete a comment",
  description: [
    "Delete one comment thread with its replies, for good: a deleted comment cannot be restored.",
    "Without confirm: true nothing is deleted: you get the comment back as a preview to show the user. Call again with confirm: true only after the user says yes.",
    "To close a comment without deleting it use superflow_resolve_comment. There is no bulk delete: delete one comment at a time.",
    'Example: {"comment": "cmt_8f3k2"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: commentProjectSchema,
    confirm: z
      .boolean()
      .default(false)
      .describe("Must be true to delete. Set it only after the user explicitly agreed in this conversation."),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    const project = args.project;
    const ref = normalizeCommentRef(args.comment);
    if (isConfirmed(args.confirm)) {
      const result = await api.call<DeleteResponse>("deleteComment", { path: { comment: ref }, query: { project } });
      return okResult(`Deleted comment ${result.id ?? ref} and its replies for good. It cannot be restored.`, asData(result));
    }
    const comment = await api.call<CommentFull>("getComment", {
      path: { comment: ref },
      query: { project, include_replies: false },
    });
    const preview = toCompactComment(comment);
    return confirmationResult(
      `Comment ${comment.id} in ${preview.project} would be deleted for good, with its replies: it cannot be restored. Nothing was deleted. Ask the user to confirm. Link: ${comment.url}`,
      { preview, message: CONFIRM_DELETE_COMMENT_MESSAGE },
    );
  },
});

const bulkPatchSchema = z
  .object({
    status: statusInput,
    priority: setPriorityInput,
    assignees: setAssigneesInput("The new assignee for every selected comment"),
    add_assignees: setAssigneesInput("Same as assignees"),
    add_tags: tagsInput("Tags to add."),
    remove_tags: z.array(z.string().min(1)).optional().describe("Tags to remove: names or tag_ ids."),
    resolve: z.boolean().optional().describe("true: resolve every selected comment. Not with reopen or status."),
    reopen: z.boolean().optional().describe("true: reopen every selected comment. Not with resolve or status."),
    note: z.string().min(1).max(10_000).optional().describe("Reply posted on each comment that resolve or reopen changes."),
  })
  .describe("The change to apply to every selected comment. At least one field.");

/** "3 failed: cmt_1 (why), ..." for the comments a bulk run did not (or would not) write. */
function failedList(failed: ReadonlyArray<{ id: string; error: string }>, lead: string): string {
  if (failed.length === 0) return "";
  const shown = failed
    .slice(0, 3)
    .map((f) => `${f.id} (${f.error.replace(/\.$/, "")})`)
    .join(", ");
  return `${failed.length} ${lead}: ${shown}${failed.length > 3 ? ", ..." : ""}.`;
}

/** "Would change 44 comments in Acme Dental (tags: copy). 3 already match. 2 would not be written: ..." */
function dryRunCounts(preview: BulkDryRunResponse): string {
  const filters = describeFilters(preview.applied_filters);
  const where = filters ? ` ${filters}` : "";
  const would = preview.would_update ?? 0;
  const already = preview.already_in_state ?? 0;
  const head = would === 0 ? `No comments${where} would change.` : `Would change ${plural(would, "comment")}${where}.`;
  return join(head, already > 0 && `${already} already match.`, failedList(preview.failed ?? [], "would not be written (not counted above)"));
}

export const bulkUpdateComments = defineTool({
  name: "superflow_bulk_update_comments",
  title: "Bulk update comments",
  description: [
    "Change many comments at once (up to 200): set status, priority or assignee, add or remove tags, or resolve or reopen with an optional note.",
    `${PRIORITY_NOTE} Clearing the priority or removing the assignee is not supported yet.`,
    "Select comments either by comment_ids or by a filter (the same filters as superflow_list_comments). A filter that matches more comments than the API can scan is refused: narrow it, for example by project or date.",
    "It is a dry run by default: you get how many comments would change, how many already match, the ones it would not write (failed, with why, for example a tag change on a comment whose tags could not be read), and a sample. Nothing is written. Show that to the user. Only after they say yes, call again with dry_run: false and confirm: true.",
    "For one comment use superflow_update_comment or superflow_resolve_comment.",
    'Example: {"filter": {"project": "Acme Dental", "tags": ["copy"], "page_url": "acme.com/", "status": ["open"]}, "patch": {"resolve": true, "note": "Copy updated."}}',
  ].join("\n"),
  inputSchema: {
    comment_ids: z
      .array(z.string().min(1))
      .min(1)
      .max(200)
      .optional()
      .describe("Comments to change: ids (cmt_...) or links, from a list call. Give this or filter, not both."),
    project: commentProjectSchema.describe(
      "Project (name, site URL or id). With comment_ids it narrows the lookup. With filter, it is used as the filter's project when the filter has none.",
    ),
    filter: z
      .object(filterShape)
      .optional()
      .describe("Select comments with the same filters as superflow_list_comments. Give this or comment_ids, not both."),
    patch: bulkPatchSchema,
    dry_run: z.boolean().default(true).describe("Default true: preview only. false writes, and also needs confirm: true."),
    confirm: z
      .boolean()
      .default(false)
      .describe("Must be true (with dry_run false) to write. Set it only after the user explicitly agreed."),
    idempotency_key: idempotencyInput,
  },
  annotations: hints(false, true, false, false),
  write: true,
  async run(args, { api }) {
    const hasIds = Array.isArray(args.comment_ids) && args.comment_ids.length > 0;
    const hasFilter = args.filter !== undefined;
    if (hasIds === hasFilter) {
      return invalidInput("Give exactly one of comment_ids or filter.");
    }
    let select: Data;
    if (hasIds) {
      const ids = args.comment_ids ?? [];
      select = compact({ comment_ids: ids.map(normalizeCommentRef), project: args.project });
    } else {
      const filter = pickFilters(args.filter ?? {});
      if (Object.keys(filter).length === 0) {
        return invalidInput("The filter is empty. Add at least one filter, for example a project or tags.");
      }
      const badDate = findInvalidDate(filter, "filter.");
      if (badDate) return invalidInput(badDate);
      select = compact({ filter, project: args.project });
    }
    const patch = compact(args.patch);
    if (Object.keys(patch).length === 0) {
      return invalidInput("The patch is empty. Give at least one change, for example status, add_tags or resolve.");
    }
    if (patch.resolve && patch.reopen) return invalidInput("Use resolve or reopen, not both.");
    if ((patch.resolve || patch.reopen) && patch.status !== undefined) {
      return invalidInput("Use status or resolve/reopen, not both.");
    }
    const unassign = refuseUnassign(patch.assignees, patch.add_assignees);
    if (unassign) return unassign;

    const mode = bulkMode(args);
    if (mode !== "apply") {
      // Never send the idempotency key on a preview: the real run must be able to use it.
      const preview = await api.call<BulkDryRunResponse>("bulkUpdateComments", {
        body: { select, patch, dry_run: true, confirm: false },
      });
      const counts = dryRunCounts(preview);
      if (preview.would_update === 0) {
        return okResult(`Dry run. ${counts} Nothing was written and there is nothing to apply.`, asData(preview));
      }
      if (mode === "dry_run") {
        return okResult(
          `Dry run. ${counts} Nothing was written. To apply it, ask the user, then call again with dry_run: false and confirm: true.`,
          asData(preview),
        );
      }
      return confirmationResult(
        `${counts} Nothing was written because confirm was not true. Ask the user to confirm.`,
        { preview, message: CONFIRM_BULK_MESSAGE },
      );
    }

    try {
      const result = await api.call<BulkRunResponse>("bulkUpdateComments", {
        body: compact({ select, patch, dry_run: false, confirm: true, idempotency_key: args.idempotency_key }),
      });
      const unchanged = result.unchanged ?? 0;
      const summary = join(
        `Updated ${plural(result.updated ?? 0, "comment")}.`,
        unchanged > 0 && `${unchanged} already matched and were skipped.`,
        failedList(result.failed ?? [], "failed"),
      );
      return okResult(summary, asData(result));
    } catch (error) {
      if (error instanceof SuperflowApiError && error.code === "needs_confirmation") {
        return confirmationResult(`Not applied: ${error.message} Ask the user to confirm.`, {
          preview: error.preview ?? null,
          message: CONFIRM_BULK_MESSAGE,
        });
      }
      throw error;
    }
  },
});

export const addAttachment = defineTool({
  name: "superflow_add_attachment",
  title: "Add an attachment",
  description: [
    "Attach a file to a comment (its first message) or to a reply, by public URL. Superflow downloads the file from the URL.",
    "Give exactly one of comment or reply. Use it when the user shares a screenshot or file link that belongs on a thread.",
    "To post text use superflow_add_reply (it can carry attachments too).",
    'Example: {"comment": "cmt_8f3k2", "url": "https://files.example.com/fix.png", "name": "fix.png"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema.optional(),
    reply: z.string().min(1).optional().describe("Reply id (rpl_...). Give this or comment, not both."),
    project: commentProjectSchema,
    url: z.string().url().describe("Public https URL of an image, video or PDF, at most 25 MB."),
    name: z.string().min(1).optional().describe("File name to show. Defaults to the URL's file name."),
  },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api }) {
    if (Boolean(args.comment) === Boolean(args.reply)) {
      return invalidInput("Give exactly one of comment or reply.");
    }
    let attachment: Attachment;
    let target: string;
    if (args.comment) {
      attachment = await api.call<Attachment>("addCommentAttachment", {
        path: { comment: normalizeCommentRef(args.comment) },
        body: compact({
          project: args.project,
          url: args.url,
          name: args.name,
        }),
      });
      target = `comment ${args.comment}`;
    } else {
      const reply = (args.reply ?? "").trim();
      attachment = await api.call<Attachment>("addReplyAttachment", {
        path: { reply },
        body: compact({ url: args.url, name: args.name }),
      });
      target = `reply ${reply}`;
    }
    return okResult(
      `Attached ${attachment.name ?? args.name ?? "the file"} to ${target}.${attachment.url ? ` File: ${attachment.url}` : ""}`,
      asData(attachment),
    );
  },
});

export const commentTools = [
  listComments,
  getComment,
  commentStats,
  exportComments,
  createComment,
  updateComment,
  resolveComment,
  reopenComment,
  addReply,
  updateReply,
  deleteReply,
  deleteComment,
  bulkUpdateComments,
  addAttachment,
];
