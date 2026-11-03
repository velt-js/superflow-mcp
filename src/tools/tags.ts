// Tag admin tools: rename or recolor, delete, merge. Tags are workspace-wide and live on the
// comments themselves: a tag exists while some comment carries it, and putting a new name on a
// comment creates it (superflow_create_comment, superflow_update_comment, bulk). Every rewrite
// changes at most 500 comments a call and returns next_cursor while more may carry the tag: the
// next call passes it as cursor. A null next_cursor ends the job. Comments counted in failed stay
// behind: one more call without a cursor retries them, and those outside Velt's 1,000-comment
// update window never change, so a retry that changes nothing ends it.
import { z } from "zod";
import { type ApiClient, SuperflowApiError } from "../client/api.ts";
import type { DeleteTagResponse, ListEnvelope, MergeTagsResponse, Scan, Tag, TagWrite } from "../client/types.ts";
import {
  CONFIRM_DELETE_TAG_MESSAGE,
  CONFIRM_MERGE_TAGS_MESSAGE,
  TAG_REWRITE_UPDATED_NOTE,
  TAG_REWRITE_WINDOW_REASON,
  isConfirmed,
} from "../lib/confirm.ts";
import { confirmationResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { findOne, matchRef } from "../lib/match.ts";
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
  .describe("The next_cursor of the previous call of this same change, to go on where it stopped. Leave it out on the first call.");

const LOOKUP = {
  prefix: "tag_",
  noun: "tag",
  where: "the tags on the workspace's comments",
  notFoundHint: "List the tags with superflow_list_tags. A tag exists only while some comment carries it.",
};

/** When a rewrite is done, and what to do about comments it could not rewrite (shared by the descriptions). */
const STOP_RULE = `When next_cursor is null the job is done. Comments counted in failed were not rewritten: one more call without a cursor retries them, but those it cannot change stay as they are (${TAG_REWRITE_WINDOW_REASON}); when a call changes nothing, tell the user and stop.`;

/** The workspace's tags (every project's), and the scan they were read from. */
async function workspaceTags(api: ApiClient): Promise<{ tags: Tag[]; scan: Scan | undefined }> {
  const list = await api.call<ListEnvelope<Tag>>("listTags");
  return { tags: list.items ?? [], scan: list.scan };
}

/** A preview read from a tag scan that stopped early: its counts may be low, and the tag may be on comments it did not read. */
function partialScanNote(scan: Scan | undefined): string {
  return scan?.complete === false
    ? `The tag scan stopped after ${count(scan.scanned)} comments, so the count may be low and the tag may also be on comments it did not read.`
    : "";
}

/** Finds a tag among the scanned ones; a miss after a scan that stopped early says the tag may be on comments it did not read. */
function findTag(tags: readonly Tag[], ref: string, scan: Scan | undefined): Tag {
  if (scan?.complete !== false) return findOne(tags, ref, LOOKUP);
  return findOne(tags, ref, {
    ...LOOKUP,
    notFoundHint: `The tag scan stopped after ${count(scan.scanned)} comments, so the tag may be on comments it did not read. ${LOOKUP.notFoundHint}`,
  });
}

/**
 * What a rewrite left undone, and what to do next. While there is a next_cursor, go on with it.
 * Once it is null, comments in failed stay behind: a call that changed some comments may be
 * followed by one retry without a cursor (`retry`); a call that changed nothing ends it, so a
 * retry can never loop.
 */
function rewriteNote(
  result: { failed?: number; next_cursor?: string | null },
  changed: number,
  goOn: (cursor: string) => string,
  retry: string,
): string {
  const failed = result.failed ?? 0;
  const next = result.next_cursor ?? null;
  if (next) {
    return join(
      failed > 0 && `${plural(failed, "comment")} could not be rewritten in this call; once next_cursor is null, one more call without a cursor retries them.`,
      `More comments may carry the tag (one call rewrites at most ${TAG_REWRITE_CAP}): ${goOn(next)}`,
    );
  }
  if (failed === 0) return "";
  return join(
    `${plural(failed, "comment")} could not be rewritten: ${TAG_REWRITE_WINDOW_REASON}.`,
    changed > 0
      ? `One more call without a cursor retries them: ${retry} If that changes nothing, tell the user and stop.`
      : "This call changed nothing, so calling again will not help: tell the user and stop.",
  );
}

/**
 * Runs a confirmed rewrite. When the API did not find the tag because its scan stopped early, the
 * error says how far it read and how to look further with the cursor the API returned.
 */
async function lookingFurther<T>(call: () => Promise<T>, again: (cursor: string) => string): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof SuperflowApiError) || error.code !== "not_found" || error.scan?.complete !== false || !error.nextCursor) throw error;
    throw new SuperflowApiError({
      status: error.status,
      code: error.code,
      message: error.message,
      hint: `The tag scan stopped after ${count(error.scan.scanned)} comments, so the tag may be on later ones: ${again(error.nextCursor)}`,
      candidates: error.candidates,
      scan: error.scan,
      nextCursor: error.nextCursor,
    });
  }
}

const withoutPrefix = (value: string) => value.trim().replace(/^tag_/, "");

export const updateTag = defineTool({
  name: "superflow_update_tag",
  title: "Update a tag",
  description: [
    "Rename or recolor a tag on every comment that carries it, in every project. Tags are workspace-wide. A rename gives the tag the new name's id (one id per name); a new color, or the same name in other letter case, keeps the id.",
    "A name another tag already has is refused: fold the tag into that one with superflow_merge_tags instead.",
    `One call rewrites at most ${TAG_REWRITE_CAP} comments and returns next_cursor while more may carry the tag (complete: false). For a new color or a change of letter case, call again with the same arguments and cursor set to next_cursor. A real rename that stopped early is finished with superflow_merge_tags from the old name into the new one (a second rename is refused, since the new name is now in use). ${STOP_RULE}`,
    `${TAG_REWRITE_UPDATED_NOTE} ${TAG_PRIVACY_NOTE}`,
    "To find tag names and ids use superflow_list_tags.",
    'Example: {"tag": "copy", "name": "copywriting"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema,
    name: z.string().min(1).max(64).optional().describe("New name, up to 64 characters."),
    color: colorSchema,
    cursor: rewriteCursorSchema,
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    if (args.name === undefined && args.color === undefined) return invalidInput("Nothing to change. Give name or color.");
    const ref = args.tag.trim();
    const call = (cursor: string | undefined) => JSON.stringify(compact({ tag: ref, name: args.name, color: args.color, cursor }));
    const tag = await lookingFurther(
      () => api.call<TagWrite>("updateTag", { path: { tag: ref }, body: compact({ name: args.name, color: args.color, cursor: args.cursor }) }),
      (cursor) => `call superflow_update_tag again with ${call(cursor)} to look further.`,
    );
    // A new color, or the same name in other letter case, keeps the tag (and its id): the same
    // call goes on with the cursor. A real rename moved the comments to the new name's id, so a
    // second rename is refused and a merge from the old name finishes it.
    const sameTag =
      args.name === undefined ||
      args.name.trim().toLowerCase() === ref.toLowerCase() ||
      (typeof tag.id === "string" && withoutPrefix(tag.id) === withoutPrefix(ref));
    const merge = `superflow_merge_tags from "${ref}" into "${tag.name ?? args.name}"`;
    const goOn = sameTag
      ? (cursor: string) => `call superflow_update_tag again with ${call(cursor)}. Stop when next_cursor is null.`
      : () => `finish with ${merge} (a second rename is refused, since the new name is now in use).`;
    // The comments a real rename could not rewrite still carry the old name: a merge moves them.
    const retry = sameTag ? `superflow_update_tag with ${call(undefined)}.` : `${merge}.`;
    const changed = tag.comments_updated ?? 0;
    return okResult(
      join(`Updated tag ${tag.name ?? ref} (${tag.id}) on ${plural(changed, "comment")}.`, rewriteNote(tag, changed, goOn, retry)),
      asData(tag),
    );
  },
});

export const deleteTag = defineTool({
  name: "superflow_delete_tag",
  title: "Delete a tag",
  description: [
    "Take a tag off every comment that carries it, in every project. The comments stay; the tag is gone once no comment carries it.",
    "Without confirm: true nothing changes: you get the tag and how many comments carry it as a preview. Call again with confirm: true only after the user says yes.",
    `One call rewrites at most ${TAG_REWRITE_CAP} comments and returns next_cursor while more may carry the tag (complete: false): call again with the same tag, confirm: true and cursor set to next_cursor. ${STOP_RULE}`,
    TAG_REWRITE_UPDATED_NOTE,
    "To fold a tag into another one instead use superflow_merge_tags.",
    'Example: {"tag": "old-copy"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema,
    confirm: confirmSchema("delete the tag"),
    cursor: rewriteCursorSchema,
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      // The API finds the tag among the workspace's tags the same way the preview did.
      const ref = args.tag.trim();
      const call = (cursor: string | undefined) => JSON.stringify(compact({ tag: ref, confirm: true, cursor }));
      const result = await lookingFurther(
        () => api.call<DeleteTagResponse>("deleteTag", { path: { tag: ref }, query: { confirm: true, cursor: args.cursor } }),
        (cursor) => `call superflow_delete_tag again with ${call(cursor)} to look further.`,
      );
      const changed = result.removed_from ?? 0;
      return okResult(
        join(
          `Took tag ${ref} (${result.id}) off ${plural(changed, "comment")}.`,
          rewriteNote(
            result,
            changed,
            (cursor) => `call superflow_delete_tag again with ${call(cursor)}. Stop when next_cursor is null.`,
            `superflow_delete_tag with ${call(undefined)}.`,
          ),
        ),
        asData(result),
      );
    }
    // Preview: one read. Nothing that could delete is sent without confirm.
    const { tags, scan } = await workspaceTags(api);
    const tag = findTag(tags, args.tag, scan);
    return confirmationResult(
      join(
        `Tag ${tag.name} (${tag.id}) would be taken off ${count(tag.usage_count)} comments, in every project.`,
        partialScanNote(scan),
        "Nothing was deleted. Ask the user to confirm.",
      ),
      { preview: { tag, comment_count: tag.usage_count ?? null, scan: scan ?? null }, message: CONFIRM_DELETE_TAG_MESSAGE },
    );
  },
});

export const mergeTags = defineTool({
  name: "superflow_merge_tags",
  title: "Merge tags",
  description: [
    "Merge one tag into another: every comment that carries tag gets into instead, in every project, and tag is gone. into is a tag some comment carries, or a new name (the new tag keeps tag's color). Use it to clean up near-duplicates such as \"Copy text\" and \"copy\", or to finish a rename that stopped early.",
    "Without confirm: true nothing changes: you get both tags and how many comments would change as a preview. Call again with confirm: true only after the user says yes.",
    `One call rewrites at most ${TAG_REWRITE_CAP} comments and returns next_cursor while more may carry tag (complete: false): call again with the same tag, into, confirm: true and cursor set to next_cursor. ${STOP_RULE}`,
    `${TAG_REWRITE_UPDATED_NOTE} ${TAG_PRIVACY_NOTE}`,
    "To just rename or recolor a tag use superflow_update_tag.",
    'Example: {"tag": "Copy text", "into": "copy"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema.describe("The tag to merge away (name or tag_ id). It is gone after the merge."),
    into: z.string().min(1).max(64).describe("The tag to keep (name or tag_ id), or a new name."),
    confirm: confirmSchema("merge the tags"),
    cursor: rewriteCursorSchema,
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (args.tag.trim().toLowerCase() === args.into.trim().toLowerCase()) {
      return invalidInput("tag and into are the same tag. Pick two different tags.");
    }
    if (isConfirmed(args.confirm)) {
      // The API finds both among the workspace's tags the same way the preview did; a new name
      // for into becomes a tag.
      const from = args.tag.trim();
      const into = args.into.trim();
      const call = (cursor: string | undefined) => JSON.stringify(compact({ tag: from, into, confirm: true, cursor }));
      const result = await lookingFurther(
        () => api.call<MergeTagsResponse>("mergeTags", { path: { tag: from }, body: compact({ into, confirm: true, cursor: args.cursor }) }),
        (cursor) => `call superflow_merge_tags again with ${call(cursor)} to look further.`,
      );
      const changed = result.comments_updated ?? 0;
      return okResult(
        join(
          `Merged tag ${from} into ${into}: ${plural(changed, "comment")} updated.`,
          rewriteNote(
            result,
            changed,
            (cursor) => `call superflow_merge_tags again with ${call(cursor)}. Stop when next_cursor is null.`,
            `superflow_merge_tags with ${call(undefined)}.`,
          ),
        ),
        asData(result),
      );
    }
    // Preview: one read. Nothing that could merge is sent without confirm.
    const { tags, scan } = await workspaceTags(api);
    const from = findTag(tags, args.tag, scan);
    const intoName = args.into.trim();
    // A name no comment carries yet becomes a new tag; an id must exist, and an ambiguous name fails.
    const isNew = matchRef(tags, intoName, { prefix: "tag_" }).kind === "none" && !intoName.startsWith("tag_");
    const into = isNew
      ? { id: null, name: intoName, color: from.color, usage_count: 0, new: true }
      : findTag(tags, intoName, scan);
    if (into.id === from.id) return invalidInput("tag and into are the same tag. Pick two different tags.");
    const target = isNew ? `a new tag ${into.name}` : into.name;
    return confirmationResult(
      join(
        `Tag ${from.name} would be merged into ${target}, in every project: ${count(from.usage_count)} comments would get ${into.name} instead, and ${from.name} would be gone.`,
        partialScanNote(scan),
        "Nothing was merged. Ask the user to confirm.",
      ),
      {
        preview: { from, into, comments_to_update: from.usage_count ?? null, scan: scan ?? null },
        message: CONFIRM_MERGE_TAGS_MESSAGE,
      },
    );
  },
});

export const tagTools = [updateTag, deleteTag, mergeTags];
