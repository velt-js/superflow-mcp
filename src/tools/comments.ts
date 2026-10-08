// The 15 comment tools: read, filter, count, export, write, reply, delete, restore, bulk.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type {
  Attachment,
  BulkDryRunResponse,
  BulkRunResponse,
  CommentCompact,
  CommentFull,
  CreateReplyResponse,
  DeleteCommentResponse,
  DeleteResponse,
  ExportResponse,
  ListEnvelope,
  Reply,
  ResolveResponse,
  StatsResponse,
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
  commentLabel,
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
import { anyCommentNumber, normalizeCommentRef, parseReplyId, projectForComment } from "../lib/resolve.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import {
  EXPORT_FORMATS,
  GROUP_BY,
  METRICS,
  PRIORITIES,
  anchorSchema,
  attachmentInputSchema,
  commentRefSchema,
  cursorSchema,
  fieldsSchema,
  filterShape,
  limitSchema,
  pickFilters,
  projectForNumberSchema,
  projectRefSchema,
  sortSchema,
} from "./schemas.ts";

type Data = Record<string, unknown>;
const asData = (value: unknown): Data => value as Data;

/** Drops undefined values so request bodies only carry what the caller set. */
function compact<T extends Data>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function join(...parts: Array<string | undefined | false>): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" ");
}

function commentSummary(comment: CommentFull): string {
  const assignee = comment.assignees?.[0]?.name;
  const page = comment.page?.url ? ` on ${comment.page.url}` : "";
  return (
    `Comment ${commentLabel(comment)} in ${comment.project?.name ?? "its project"}${page}: ` +
    `${comment.status?.name ?? "unknown status"}, ${comment.priority ?? "no"} priority, ` +
    `${assignee ? `assigned to ${assignee}` : "unassigned"}, ${plural(comment.reply_count ?? 0, "reply", "replies")}. ` +
    `Link: ${comment.url}`
  );
}

const statusInput = z
  .string()
  .min(1)
  .optional()
  .describe('Status name or id. "open" means the default status and "resolved" the resolved status.');
const priorityInput = z.enum(PRIORITIES).optional().describe('Priority. "none" clears it.');
const assigneesInput = z
  .array(z.string().min(1))
  .max(1)
  .optional()
  .describe('Replace the assignee: one name, email or id, or "me". A comment has one assignee. [] or ["unassigned"] clears it.');
const tagsInput = (what: string) =>
  z.array(z.string().min(1)).optional().describe(`${what} Unknown tag names are created in the comment's project.`);
const idempotencyInput = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe("Optional key so a retried call is not applied twice. Same key within 24 hours returns the first result.");

// ---------------------------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------------------------

export const listComments = defineTool({
  name: "superflow_list_comments",
  title: "List comments",
  description: [
    "List comments in Superflow with filters. Use this to find, review or read specific comments: by project, page, status, assignee, author, tags, dates, text, device, source or agent run.",
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
    'Use it when the user names a comment ("comment 4821", "#4821", or a cmt_ id) or after a list call to read a thread in full.',
    "A comment number needs a project unless SUPERFLOW_DEFAULT_PROJECT is set. To search or list many comments use superflow_list_comments.",
    'Example: {"comment": "4821", "project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: projectForNumberSchema,
    include_replies: z.boolean().default(true).describe("Include the thread's replies. Default true."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api, config }) {
    const comment = await api.call<CommentFull>("getComment", {
      path: { comment: normalizeCommentRef(args.comment) },
      query: {
        project: projectForComment(args.comment, args.project, config.defaultProject),
        include_replies: args.include_replies,
      },
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
    "Use it when the user asks to leave or log feedback on a page. To answer an existing thread use superflow_add_reply instead.",
    "Ask the user before creating comments they did not ask for.",
    'Example: {"project": "Acme Dental", "page_url": "https://acme.com/pricing", "text": "The CTA button overlaps the nav on mobile.", "priority": "high", "tags": ["mobile"]}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    page_url: z.string().min(1).describe("Full URL of the page the comment is about."),
    text: z.string().min(1).max(10_000).describe("The comment text. @Name or @email mentions notify those people."),
    anchor: anchorSchema.optional(),
    priority: priorityInput,
    status: statusInput,
    assignees: assigneesInput,
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
      `Created comment ${commentLabel(comment)} on ${page} in ${comment.project?.name ?? args.project}. Link: ${comment.url}`,
      asData(comment),
    );
  },
});

export const updateComment = defineTool({
  name: "superflow_update_comment",
  title: "Update a comment",
  description: [
    "Change one comment: text, priority, status, assignee, tags (replace, add or remove), page URL or pin position.",
    "Use it for a single comment. To resolve or reopen prefer superflow_resolve_comment and superflow_reopen_comment (they can post a note). For many comments use superflow_bulk_update_comments.",
    "Ask the user before changing comments they did not ask about.",
    'Example: {"comment": "4821", "project": "Acme Dental", "priority": "high", "assignees": ["Jen"], "add_tags": ["mobile"]}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: projectForNumberSchema,
    text: z.string().min(1).max(10_000).optional().describe("New text for the comment's first message."),
    priority: priorityInput,
    status: statusInput,
    assignees: assigneesInput,
    add_assignees: z
      .array(z.string().min(1))
      .max(1)
      .optional()
      .describe("Set the assignee (replaces any existing one, since a comment has one assignee)."),
    remove_assignees: z.array(z.string().min(1)).optional().describe("Remove this assignee if set."),
    tags: tagsInput("Replace all tags with these. [] removes every tag."),
    add_tags: tagsInput("Tags to add."),
    remove_tags: z.array(z.string().min(1)).optional().describe("Tags to remove."),
    page_url: z.string().min(1).optional().describe("Move the comment to this page URL."),
    anchor: anchorSchema.optional(),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api, config }) {
    const { comment: ref, project: _project, ...changes } = args;
    if (Object.values(changes).every((value) => value === undefined)) {
      return invalidInput(
        "Nothing to change. Give at least one of text, priority, status, assignees, add_assignees, remove_assignees, tags, add_tags, remove_tags, page_url or anchor.",
      );
    }
    const comment = await api.call<CommentFull>("updateComment", {
      path: { comment: normalizeCommentRef(ref) },
      body: compact({ project: projectForComment(ref, args.project, config.defaultProject), ...changes }),
    });
    return okResult(`Updated. ${commentSummary(comment)}`, asData(comment));
  },
});

function resolveTool(kind: "resolve" | "reopen") {
  const resolve = kind === "resolve";
  return defineTool({
    name: resolve ? "superflow_resolve_comment" : "superflow_reopen_comment",
    title: resolve ? "Resolve a comment" : "Reopen a comment",
    description: (resolve
      ? [
          "Mark one comment resolved, optionally posting a note as a reply first (for example what was fixed).",
          "Safe to repeat: if it is already resolved nothing changes and the note is not posted.",
          "To resolve many comments at once use superflow_bulk_update_comments with patch {\"resolve\": true}. To undo use superflow_reopen_comment.",
          'Example: {"comment": "4821", "project": "Acme Dental", "note": "Fixed in the latest deploy, please check."}',
        ]
      : [
          "Reopen one resolved comment (back to the default status), optionally posting a note as a reply first.",
          "Safe to repeat: if it is already open nothing changes and the note is not posted.",
          "To reopen many comments use superflow_bulk_update_comments with patch {\"reopen\": true}.",
          'Example: {"comment": "4821", "project": "Acme Dental", "note": "Still broken on Safari."}',
        ]
    ).join("\n"),
    inputSchema: {
      comment: commentRefSchema,
      project: projectForNumberSchema,
      note: z
        .string()
        .min(1)
        .max(10_000)
        .optional()
        .describe(resolve ? "Reply to post before resolving." : "Reply to post before reopening."),
    },
    annotations: hints(false, false, true, false),
    write: true,
    async run(args, { api, config }) {
      const result = await api.call<ResolveResponse>(resolve ? "resolveComment" : "reopenComment", {
        path: { comment: normalizeCommentRef(args.comment) },
        body: compact({ project: projectForComment(args.comment, args.project, config.defaultProject), note: args.note }),
      });
      const label = result.comment ? commentLabel(result.comment) : args.comment;
      const link = result.comment?.url ? ` Link: ${result.comment.url}` : "";
      const summary = result.changed
        ? `${resolve ? "Resolved" : "Reopened"} comment ${label}${result.note_reply_id ? " and posted the note as a reply" : ""}.${link}`
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
    'Example: {"comment": "4821", "project": "Acme Dental", "text": "Fixed, please check. @Jen can you confirm on mobile?"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: projectForNumberSchema,
    text: z.string().min(1).max(10_000).describe("Reply text. Mentions: @Name, @First Last or @email."),
    attachments: z.array(attachmentInputSchema).max(10).optional().describe("Files to attach, by public URL."),
    idempotency_key: idempotencyInput,
  },
  annotations: hints(false, false, false, false),
  write: true,
  async run(args, { api, config }) {
    const result = await api.call<CreateReplyResponse>("createReply", {
      path: { comment: normalizeCommentRef(args.comment) },
      body: compact({
        project: projectForComment(args.comment, args.project, config.defaultProject),
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
    "Delete one comment thread with its replies. It can be restored with superflow_restore_comment until restore_until.",
    "Without confirm: true nothing is deleted: you get the comment back as a preview to show the user. Call again with confirm: true only after the user says yes.",
    "To close a comment without deleting it use superflow_resolve_comment. There is no bulk delete: delete one comment at a time.",
    'Example: {"comment": "4821", "project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: projectForNumberSchema,
    confirm: z
      .boolean()
      .default(false)
      .describe("Must be true to delete. Set it only after the user explicitly agreed in this conversation."),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api, config }) {
    const project = projectForComment(args.comment, args.project, config.defaultProject);
    const ref = normalizeCommentRef(args.comment);
    if (isConfirmed(args.confirm)) {
      const result = await api.call<DeleteCommentResponse>("deleteComment", { path: { comment: ref }, query: { project } });
      const label = typeof result.number === "number" ? `#${result.number}` : (result.id ?? args.comment);
      const until = result.restore_until ? ` until ${result.restore_until}` : "";
      return okResult(
        `Deleted comment ${label}. It can be restored with superflow_restore_comment${until}.`,
        asData(result),
      );
    }
    const comment = await api.call<CommentFull>("getComment", {
      path: { comment: ref },
      query: { project, include_replies: false },
    });
    const preview = toCompactComment(comment);
    return confirmationResult(
      `Comment ${commentLabel(comment)} in ${preview.project} would be deleted. Nothing was deleted. Ask the user to confirm. Link: ${comment.url}`,
      { preview, message: CONFIRM_DELETE_COMMENT_MESSAGE },
    );
  },
});

export const restoreComment = defineTool({
  name: "superflow_restore_comment",
  title: "Restore a comment",
  description: [
    "Restore a deleted comment thread, with its replies, before its restore window ends.",
    "Use it when the user wants a deleted comment back. It does not reopen resolved comments: use superflow_reopen_comment for that.",
    'Example: {"comment": "cmt_8f3k2"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: projectForNumberSchema,
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api, config }) {
    const comment = await api.call<CommentFull>("restoreComment", {
      path: { comment: normalizeCommentRef(args.comment) },
      body: compact({ project: projectForComment(args.comment, args.project, config.defaultProject) }),
    });
    return okResult(`Restored. ${commentSummary(comment)}`, asData(comment));
  },
});

const bulkPatchSchema = z
  .object({
    status: statusInput,
    priority: priorityInput,
    assignees: assigneesInput,
    add_assignees: z.array(z.string().min(1)).max(1).optional().describe("Set the assignee (replaces any existing one)."),
    remove_assignees: z.array(z.string().min(1)).optional().describe("Remove this assignee where set."),
    add_tags: z.array(z.string().min(1)).optional().describe("Tags to add. Unknown names are created."),
    remove_tags: z.array(z.string().min(1)).optional().describe("Tags to remove."),
    resolve: z.boolean().optional().describe("true: resolve every selected comment. Not with reopen or status."),
    reopen: z.boolean().optional().describe("true: reopen every selected comment. Not with resolve or status."),
    note: z.string().min(1).max(10_000).optional().describe("Reply posted on each comment that resolve or reopen changes."),
  })
  .describe("The change to apply to every selected comment. At least one field.");

export const bulkUpdateComments = defineTool({
  name: "superflow_bulk_update_comments",
  title: "Bulk update comments",
  description: [
    "Change many comments at once (up to 200): set status, priority or assignee, add or remove tags, or resolve or reopen with an optional note.",
    "Select comments either by comment_ids or by a filter (the same filters as superflow_list_comments).",
    "It is a dry run by default: you get how many would change and a sample, and nothing is written. Show that to the user. Only after they say yes, call again with dry_run: false and confirm: true.",
    "For one comment use superflow_update_comment or superflow_resolve_comment.",
    'Example: {"filter": {"project": "Acme Dental", "tags": ["copy"], "page_url": "acme.com/", "status": ["open"]}, "patch": {"resolve": true, "note": "Copy updated."}}',
  ].join("\n"),
  inputSchema: {
    comment_ids: z
      .array(z.string().min(1))
      .min(1)
      .max(200)
      .optional()
      .describe("Comments to change: numbers (\"4821\") or ids (cmt_...). Give this or filter, not both."),
    project: projectForNumberSchema.describe(
      "Project for comment numbers in comment_ids. Defaults to SUPERFLOW_DEFAULT_PROJECT when set.",
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
  async run(args, { api, config }) {
    const hasIds = Array.isArray(args.comment_ids) && args.comment_ids.length > 0;
    const hasFilter = args.filter !== undefined;
    if (hasIds === hasFilter) {
      return invalidInput("Give exactly one of comment_ids or filter.");
    }
    let select: Data;
    if (hasIds) {
      const ids = args.comment_ids ?? [];
      const project = args.project ?? (anyCommentNumber(ids) ? config.defaultProject : undefined);
      select = compact({ comment_ids: ids.map(normalizeCommentRef), project });
    } else {
      const filter = pickFilters(args.filter ?? {});
      if (Object.keys(filter).length === 0) {
        return invalidInput("The filter is empty. Add at least one filter, for example a project or tags.");
      }
      const badDate = findInvalidDate(filter, "filter.");
      if (badDate) return invalidInput(badDate);
      select = { filter };
    }
    const patch = compact(args.patch);
    if (Object.keys(patch).length === 0) {
      return invalidInput("The patch is empty. Give at least one change, for example status, add_tags or resolve.");
    }
    if (patch.resolve && patch.reopen) return invalidInput("Use resolve or reopen, not both.");
    if ((patch.resolve || patch.reopen) && patch.status !== undefined) {
      return invalidInput("Use status or resolve/reopen, not both.");
    }

    const mode = bulkMode(args);
    if (mode !== "apply") {
      // Never send the idempotency key on a preview: the real run must be able to use it.
      const preview = await api.call<BulkDryRunResponse>("bulkUpdateComments", {
        body: { select, patch, dry_run: true, confirm: false },
      });
      const filters = describeFilters(preview.applied_filters);
      const count = plural(preview.would_update ?? 0, "comment");
      if (mode === "dry_run") {
        return okResult(
          `Dry run: ${count}${filters ? ` ${filters}` : ""} would change. Nothing was written. To apply it, ask the user, then call again with dry_run: false and confirm: true.`,
          asData(preview),
        );
      }
      return confirmationResult(
        `${count}${filters ? ` ${filters}` : ""} would change. Nothing was written because confirm was not true. Ask the user to confirm.`,
        { preview, message: CONFIRM_BULK_MESSAGE },
      );
    }

    try {
      const result = await api.call<BulkRunResponse>("bulkUpdateComments", {
        body: compact({ select, patch, dry_run: false, confirm: true, idempotency_key: args.idempotency_key }),
      });
      const failed = result.failed ?? [];
      const summary = join(
        `Updated ${plural(result.updated ?? 0, "comment")}.`,
        failed.length > 0 &&
          `${failed.length} failed: ${failed
            .slice(0, 3)
            .map((f) => `${f.id} (${f.error})`)
            .join(", ")}${failed.length > 3 ? ", ..." : ""}.`,
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
    'Example: {"comment": "4821", "project": "Acme Dental", "url": "https://files.example.com/fix.png", "name": "fix.png"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema.optional(),
    reply: z.string().min(1).optional().describe("Reply id (rpl_...). Give this or comment, not both."),
    project: projectForNumberSchema,
    url: z.string().url().describe("Public https URL of the file."),
    name: z.string().min(1).optional().describe("File name to show. Defaults to the URL's file name."),
  },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api, config }) {
    if (Boolean(args.comment) === Boolean(args.reply)) {
      return invalidInput("Give exactly one of comment or reply.");
    }
    let attachment: Attachment;
    let target: string;
    if (args.comment) {
      attachment = await api.call<Attachment>("addCommentAttachment", {
        path: { comment: normalizeCommentRef(args.comment) },
        body: compact({
          project: projectForComment(args.comment, args.project, config.defaultProject),
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
  restoreComment,
  bulkUpdateComments,
  addAttachment,
];
