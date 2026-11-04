// Tag admin tools: rename or recolor, delete, merge. Tags are workspace-wide and live on the
// comments themselves: a tag exists while some comment carries it, and putting a new name on a
// comment creates it (superflow_create_comment, superflow_update_comment, bulk).
//
// A rewrite is a job of one or more calls. Each call rewrites at most 500 comments and returns
// next_cursor while more may carry the tag; the next call passes it back as cursor (a rename
// too: the cursor carries the tag the job started with). A null next_cursor ends the pass.
// Comments a call could not rewrite while it changed others (a refused batch) may be tried once
// more: ONE retry pass, the same call without a cursor and with retry: true. A retry pass never
// offers another, so a job ends after at most two passes. Comments outside Velt's 1,000-comment
// update window never change.
//
// The delete and merge previews come from the API itself: without confirm it answers 409 with the
// tag and how many comments of one window (up to 10,000) carry it, plus next_cursor when it
// stopped before the last; a window without the tag is not_found with next_cursor. Paging adds
// the window counts up in `counted`. A confirm WITH a cursor rewrites only from that point on, so
// after a paged preview the job is confirmed without one.
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type { DeleteTagResponse, MergeTagsResponse, Scan, Tag, TagWrite } from "../client/types.ts";
import {
  CONFIRM_DELETE_TAG_MESSAGE,
  CONFIRM_MERGE_TAGS_MESSAGE,
  TAG_REWRITE_STEPS,
  TAG_REWRITE_UPDATED_NOTE,
  TAG_REWRITE_WINDOW_REASON,
  isConfirmed,
} from "../lib/confirm.ts";
import { confirmationResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { defineTool, hints } from "./define.ts";
import { asData, compact, count, join } from "./helpers.ts";
import { TAG_PRIVACY_NOTE, confirmSchema, hexColorSchema } from "./schemas.ts";

/** Most comments one rename, delete or merge rewrites; the rest wait for the next call (cursor). */
export const TAG_REWRITE_CAP = 500;

const tagRefSchema = z.string().min(1).describe("Tag: its name (\"copy\") or id (tag_...), as superflow_list_tags shows it.");
const colorSchema = hexColorSchema.optional().describe("Hex color, for example #b3261e.");
const rewriteCursorSchema = z
  .string()
  .min(1)
  .optional()
  .describe("The next_cursor of the previous call of this same change (or of a not_found that said to look further). Leave it out on the first call.");
const countedSchema = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Preview paging only: the count so far from earlier preview pages, as the last preview said to send. Leave it out on the first call.");
const retrySchema = z
  .boolean()
  .optional()
  .describe("true only on the one retry pass, when a finished pass said to make it. Never set it otherwise; a retry pass is never followed by another.");

/** One JSON call for a summary, without the fields left out. */
const callJson = (args: Record<string, unknown>) => JSON.stringify(compact(args));

/** How a call goes on and how the job may retry, for one rewrite. */
interface RewriteSteps {
  /** The next call of this pass, with the cursor. */
  goOn: (cursor: string) => string;
  /** The one retry pass, or undefined on the retry pass itself (it never offers another). */
  retry: string | undefined;
}

/**
 * What a call of a rewrite left undone, and what to do next. While there is a next_cursor the
 * pass goes on, even after a call that changed nothing (its stretch did not carry the tag, or
 * could not change). When a pass ends it says so in one line. A retry pass is offered only by
 * the first pass and only for comments a call could not rewrite while it changed others; the
 * retry pass ends the job.
 */
function rewriteNote(result: { failed?: number; next_cursor?: string | null }, changed: number, steps: RewriteSteps): string {
  const failed = result.failed ?? 0;
  const next = result.next_cursor ?? null;
  const onRetryPass = steps.retry === undefined;
  // A call that changed nothing while some comments failed met comments that cannot change.
  const retriable = failed > 0 && changed > 0 && !onRetryPass;
  const failedLine =
    failed === 0
      ? ""
      : retriable
        ? `${plural(failed, "comment")} could not be rewritten in this call (a refused batch, or ${TAG_REWRITE_WINDOW_REASON}).`
        : `${plural(failed, "comment")} could not be rewritten and cannot change: ${TAG_REWRITE_WINDOW_REASON}.`;
  if (next) {
    return join(
      failedLine,
      retriable && "When this pass ends, one retry pass can try them again.",
      `More comments may carry the tag (one call rewrites at most ${TAG_REWRITE_CAP}): ${steps.goOn(next)}`,
    );
  }
  if (onRetryPass) {
    return join(
      failedLine,
      failed > 0
        ? "Done: the retry pass is over. Tell the user how many comments could not be changed, and stop: do not call again."
        : "Done: the retry pass is over. Do not call again.",
    );
  }
  if (retriable) {
    return join(failedLine, `This pass is done. Make the one retry pass now: ${steps.retry} After it, stop.`);
  }
  return join(
    failedLine,
    `Done: this pass reached the last comment. If an earlier call of this job said a retry pass can try comments again, make it now, once: ${steps.retry} Otherwise the job is finished.`,
  );
}

/**
 * When the API did not find the tag because its own scan stopped early, its not_found carries how
 * far it read and a cursor to look further: the error says how to go on with it.
 */
function lookFurther(error: unknown, again: (cursor: string) => string): unknown {
  if (!(error instanceof SuperflowApiError) || error.code !== "not_found" || error.scan?.complete !== false || !error.nextCursor) return error;
  return new SuperflowApiError({
    status: error.status,
    code: error.code,
    message: error.message,
    hint: `The API read ${count(error.scan.scanned)} comments without finding the tag and stopped before the last, so it may be on later ones: ${again(error.nextCursor)}`,
    candidates: error.candidates,
    scan: error.scan,
    nextCursor: error.nextCursor,
  });
}

/** Runs one call; a not_found past the API's scan comes back with how to look further. */
async function lookingFurther<T>(call: () => Promise<T>, again: (cursor: string) => string): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw lookFurther(error, again);
  }
}

/** One page of a delete or merge preview: the API's own answer to the unconfirmed call. */
interface PreviewPage {
  /** The API's preview object (tag or from and into, comment_count, scan), or null on a page past the tag. */
  preview: Record<string, unknown> | null;
  /** This page's count. */
  here: number;
  /** The count over every page so far (the windows never overlap). */
  total: number;
  scan: Scan | undefined;
  /** Where the next page starts, or null after the last comment. */
  next: string | null;
}

/**
 * Reads one preview page: the unconfirmed call answers 409 with the count for the comments its
 * window read, plus scan and next_cursor when it stopped before the last. A page that does not
 * carry the tag answers not_found: after earlier pages counted it, that is a page of 0.
 * Anything else is thrown (a not_found on the first page says how to look further).
 */
async function previewPage(call: () => Promise<unknown>, counted: number, again: (cursor: string) => string): Promise<PreviewPage | { done: unknown }> {
  try {
    return { done: await call() };
  } catch (error) {
    if (!(error instanceof SuperflowApiError)) throw error;
    const next = error.nextCursor ?? null;
    if (error.code === "needs_confirmation") {
      const preview = (error.preview ?? {}) as Record<string, unknown>;
      const here = typeof preview.comment_count === "number" ? preview.comment_count : 0;
      const scan = (preview.scan as Scan | undefined) ?? error.scan;
      return { preview, here, total: counted + here, scan, next };
    }
    if (error.code === "not_found" && counted > 0) return { preview: null, here: 0, total: counted, scan: error.scan, next };
    throw lookFurther(error, again);
  }
}

/**
 * The lines of a preview page after the head: how to page on (the full count), or the count is
 * whole; and how to confirm, from the first comment unless the user wants only the rest.
 */
function previewTail(page: PreviewPage, tool: string, pageCall: (cursor: string, total: number) => string, paged: boolean, verb: string): string {
  return join(
    page.next
      ? `The API stopped before the last comment, so more may carry it. For the full count, call ${tool} again with ${pageCall(page.next, page.total)} (still without confirm), or ask the user now and say the count is so far.`
      : page.scan?.complete === false && `The API read ${count(page.scan.scanned)} comments and stopped before the last, so more may carry it.`,
    paged && `When the user agrees, confirm without a cursor: the job then ${verb} from the first comment (a cursor with confirm ${verb} only from that point on).`,
  );
}

export const updateTag = defineTool({
  name: "superflow_update_tag",
  title: "Update a tag",
  description: [
    "Rename or recolor a tag on every comment that carries it, in every project. Tags are workspace-wide. A rename gives the tag the new name's id (one id per name); a new color, or the same name in other letter case, keeps the id.",
    "A name another tag already has is refused: fold the tag into that one with superflow_merge_tags instead.",
    `${TAG_REWRITE_STEPS} A rename goes on with the cursor like a recolor (the cursor keeps the tag the job started with). Its retry pass is superflow_merge_tags from the old name into the new one, since a new rename without a cursor is refused once the new name is in use.`,
    `${TAG_REWRITE_UPDATED_NOTE} ${TAG_PRIVACY_NOTE}`,
    "To find tag names and ids use superflow_list_tags.",
    'Example: {"tag": "copy", "name": "copywriting"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema,
    name: z.string().min(1).max(64).optional().describe("New name, up to 64 characters."),
    color: colorSchema,
    cursor: rewriteCursorSchema,
    retry: retrySchema,
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    if (args.name === undefined && args.color === undefined) return invalidInput("Nothing to change. Give name or color.");
    const ref = args.tag.trim();
    const call = (cursor: string | undefined) => callJson({ tag: ref, name: args.name, color: args.color, cursor, retry: args.retry || undefined });
    const tag = await lookingFurther(
      () => api.call<TagWrite>("updateTag", { path: { tag: ref }, body: compact({ name: args.name, color: args.color, cursor: args.cursor }) }),
      (cursor) => `call superflow_update_tag again with ${call(cursor)} to look further.`,
    );
    // A new color, or the same name in other letter case, keeps the tag and its id. A real
    // rename moved the comments to the new name's id: comments it could not rewrite still carry
    // the old name, and a merge from the old name (not a second rename) moves them.
    const sameTag =
      args.name === undefined ||
      args.name.trim().toLowerCase() === ref.toLowerCase() ||
      (typeof tag.id === "string" && tag.id.replace(/^tag_/, "") === ref.replace(/^tag_/, ""));
    const retry = sameTag
      ? `superflow_update_tag with ${callJson({ tag: ref, name: args.name, color: args.color, retry: true })}.`
      : `superflow_merge_tags with ${callJson({ tag: ref, into: tag.name ?? args.name, confirm: true, retry: true })} (part of the rename the user agreed to).`;
    const changed = tag.comments_updated ?? 0;
    return okResult(
      join(
        `Updated tag ${tag.name ?? ref} (${tag.id}) on ${plural(changed, "comment")}.`,
        rewriteNote(tag, changed, {
          goOn: (cursor) => `call superflow_update_tag again with ${call(cursor)}. Stop when next_cursor is null.`,
          retry: args.retry ? undefined : retry,
        }),
      ),
      asData(tag),
    );
  },
});

export const deleteTag = defineTool({
  name: "superflow_delete_tag",
  title: "Delete a tag",
  description: [
    "Take a tag off every comment that carries it, in every project. The comments stay; the tag is gone once no comment carries it.",
    "Without confirm: true nothing changes: the API answers with the tag and how many comments carry it, as a preview, reading up to 10,000 comments a page. When it stops before the last comment, the preview says how to page on with cursor and counted for the full count (still without confirm). Call again with confirm: true only after the user says yes, and without a cursor: a cursor with confirm deletes only from that point on.",
    `${TAG_REWRITE_STEPS} Keep confirm: true on every call of the job.`,
    TAG_REWRITE_UPDATED_NOTE,
    "To fold a tag into another one instead use superflow_merge_tags.",
    'Example: {"tag": "old-copy"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema,
    confirm: confirmSchema("delete the tag"),
    cursor: rewriteCursorSchema,
    counted: countedSchema,
    retry: retrySchema,
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    const ref = args.tag.trim();
    if (isConfirmed(args.confirm)) {
      const call = (cursor: string | undefined) => callJson({ tag: ref, confirm: true, cursor, retry: args.retry || undefined });
      const result = await lookingFurther(
        () => api.call<DeleteTagResponse>("deleteTag", { path: { tag: ref }, query: { confirm: true, cursor: args.cursor } }),
        (cursor) => `call superflow_delete_tag again with ${call(cursor)} to look further.`,
      );
      const changed = result.removed_from ?? 0;
      return okResult(
        join(
          `Took tag ${ref} (${result.id}) off ${plural(changed, "comment")}.`,
          rewriteNote(result, changed, {
            goOn: (cursor) => `call superflow_delete_tag again with ${call(cursor)}. Stop when next_cursor is null.`,
            retry: args.retry ? undefined : `superflow_delete_tag with ${callJson({ tag: ref, confirm: true, retry: true })}.`,
          }),
        ),
        asData(result),
      );
    }
    // Preview: the unconfirmed call, one window a page (see previewPage). Nothing that could
    // delete is sent without confirm.
    const counted = args.counted ?? 0;
    const pageCall = (cursor: string, total: number) => callJson({ tag: ref, cursor, counted: total || undefined });
    const page = await previewPage(
      () => api.call<DeleteTagResponse>("deleteTag", { path: { tag: ref }, query: { cursor: args.cursor } }),
      counted,
      (cursor) => `call superflow_delete_tag again with ${pageCall(cursor, counted)} (still without confirm) to look further.`,
    );
    if ("done" in page) {
      const result = page.done as DeleteTagResponse;
      return okResult(`The API took tag ${ref} off ${plural(result.removed_from ?? 0, "comment")} without asking for confirmation. Tell the user it is done.`, asData(result));
    }
    const tag = (page.preview?.tag ?? {}) as Partial<Tag>;
    const label = `${tag.name ?? ref}${tag.id ? ` (${tag.id})` : ""}`;
    const head = page.next
      ? `Tag ${label} is on ${count(page.total)} comments so far${counted > 0 ? ` (${count(page.here)} on this page)` : ""}, in every project.`
      : `Tag ${label} would be taken off ${count(page.total)} comments, in every project.`;
    return confirmationResult(
      join(head, previewTail(page, "superflow_delete_tag", pageCall, args.cursor !== undefined || page.next !== null, "deletes"), "Nothing was deleted. Ask the user to confirm."),
      {
        preview: { tag: page.preview?.tag ?? null, comment_count: page.total, this_page: page.here, scan: page.scan ?? null, next_cursor: page.next },
        message: CONFIRM_DELETE_TAG_MESSAGE,
      },
    );
  },
});

export const mergeTags = defineTool({
  name: "superflow_merge_tags",
  title: "Merge tags",
  description: [
    "Merge one tag into another: every comment that carries tag gets into instead, in every project, and tag is gone. into is a tag some comment carries, or a new name (the new tag keeps tag's color). Use it to clean up near-duplicates such as \"Copy text\" and \"copy\", or as the retry pass of a rename.",
    "Without confirm: true nothing changes: the API answers with both tags and how many comments would change, as a preview, reading up to 10,000 comments a page. When it stops before the last comment, the preview says how to page on with cursor and counted for the full count (still without confirm). Call again with confirm: true only after the user says yes, and without a cursor: a cursor with confirm merges only from that point on.",
    `${TAG_REWRITE_STEPS} Keep confirm: true on every call of the job.`,
    `${TAG_REWRITE_UPDATED_NOTE} ${TAG_PRIVACY_NOTE}`,
    "To just rename or recolor a tag use superflow_update_tag.",
    'Example: {"tag": "Copy text", "into": "copy"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema.describe("The tag to merge away (name or tag_ id). It is gone after the merge."),
    into: z.string().min(1).max(64).describe("The tag to keep (name or tag_ id), or a new name."),
    confirm: confirmSchema("merge the tags"),
    cursor: rewriteCursorSchema,
    counted: countedSchema,
    retry: retrySchema,
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (args.tag.trim().toLowerCase() === args.into.trim().toLowerCase()) {
      return invalidInput("tag and into are the same tag. Pick two different tags.");
    }
    const from = args.tag.trim();
    const into = args.into.trim();
    if (isConfirmed(args.confirm)) {
      // The API finds both among the workspace's tags the same way the preview did; a new name
      // for into becomes a tag.
      const call = (cursor: string | undefined) => callJson({ tag: from, into, confirm: true, cursor, retry: args.retry || undefined });
      const result = await lookingFurther(
        () => api.call<MergeTagsResponse>("mergeTags", { path: { tag: from }, body: compact({ into, confirm: true, cursor: args.cursor }) }),
        (cursor) => `call superflow_merge_tags again with ${call(cursor)} to look further.`,
      );
      const changed = result.comments_updated ?? 0;
      return okResult(
        join(
          `Merged tag ${from} into ${into}: ${plural(changed, "comment")} updated.`,
          rewriteNote(result, changed, {
            goOn: (cursor) => `call superflow_merge_tags again with ${call(cursor)}. Stop when next_cursor is null.`,
            retry: args.retry ? undefined : `superflow_merge_tags with ${callJson({ tag: from, into, confirm: true, retry: true })}.`,
          }),
        ),
        asData(result),
      );
    }
    // Preview: the unconfirmed call, one window a page (see previewPage). Nothing that could
    // merge is sent without confirm.
    const counted = args.counted ?? 0;
    const pageCall = (cursor: string, total: number) => callJson({ tag: from, into, cursor, counted: total || undefined });
    const page = await previewPage(
      () => api.call<MergeTagsResponse>("mergeTags", { path: { tag: from }, body: compact({ into, cursor: args.cursor }) }),
      counted,
      (cursor) => `call superflow_merge_tags again with ${pageCall(cursor, counted)} (still without confirm) to look further.`,
    );
    if ("done" in page) {
      return okResult(`The API merged tag ${from} into ${into} without asking for confirmation. Tell the user it is done.`, asData(page.done as MergeTagsResponse));
    }
    const fromName = ((page.preview?.from ?? {}) as Partial<Tag>).name ?? from;
    const intoTag = (page.preview?.into ?? {}) as Partial<Tag>;
    const intoName = intoTag.name ?? into;
    // "New" only when one whole read saw no comment with it: a paged read may have missed it.
    const whole = args.cursor === undefined && page.next === null && page.scan?.complete !== false;
    const target = whole && intoTag.usage_count === 0 ? `a new tag ${intoName}` : intoName;
    const head = page.next
      ? `Tag ${fromName} is on ${count(page.total)} comments so far${counted > 0 ? ` (${count(page.here)} on this page)` : ""}; merged into ${target}, they would get ${intoName} instead, in every project, and ${fromName} would be gone.`
      : `Tag ${fromName} would be merged into ${target}, in every project: ${count(page.total)} comments would get ${intoName} instead, and ${fromName} would be gone.`;
    return confirmationResult(
      join(head, previewTail(page, "superflow_merge_tags", pageCall, args.cursor !== undefined || page.next !== null, "merges"), "Nothing was merged. Ask the user to confirm."),
      {
        preview: { from: page.preview?.from ?? null, into: page.preview?.into ?? null, comment_count: page.total, this_page: page.here, scan: page.scan ?? null, next_cursor: page.next },
        message: CONFIRM_MERGE_TAGS_MESSAGE,
      },
    );
  },
});

export const tagTools = [updateTag, deleteTag, mergeTags];
