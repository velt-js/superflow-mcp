// Tag admin tools: rename or recolor, delete, merge. Tags are workspace-wide and live on the
// comments themselves: a tag exists while some comment carries it, and putting a new name on a
// comment creates it (superflow_create_comment, superflow_update_comment, bulk). Every rewrite
// changes at most 500 comments a call and says complete: false when some still carry the tag.
import { z } from "zod";
import type { ApiClient } from "../client/api.ts";
import type { DeleteTagResponse, ListEnvelope, MergeTagsResponse, Scan, Tag, TagWrite } from "../client/types.ts";
import { CONFIRM_DELETE_TAG_MESSAGE, CONFIRM_MERGE_TAGS_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { findOne, matchRef } from "../lib/match.ts";
import { defineTool, hints } from "./define.ts";
import { asData, compact, count, join } from "./helpers.ts";
import { confirmSchema, hexColorSchema } from "./schemas.ts";

/** Most comments one rename, delete or merge rewrites; the rest wait for another call. */
export const TAG_REWRITE_CAP = 500;

const tagRefSchema = z.string().min(1).describe("Tag: its name (\"copy\") or id (tag_...), as superflow_list_tags shows it.");
const colorSchema = hexColorSchema.optional().describe("Hex color, for example #b3261e.");

const LOOKUP = {
  prefix: "tag_",
  noun: "tag",
  where: "the tags on the workspace's comments",
  notFoundHint: "List the tags with superflow_list_tags. A tag exists only while some comment carries it.",
};

/** The workspace's tags (every project's), and the scan they were read from. */
async function workspaceTags(api: ApiClient): Promise<{ tags: Tag[]; scan: Scan | undefined }> {
  const list = await api.call<ListEnvelope<Tag>>("listTags");
  return { tags: list.items ?? [], scan: list.scan };
}

/** The count in a preview may be low when the tag scan stopped early. */
function partialScanNote(scan: Scan | undefined): string {
  return scan?.complete === false
    ? `The count may be low: the tag scan stopped after ${count(scan.scanned)} comments, so it may take more than one call.`
    : "";
}

/** What a rewrite left undone, and how to finish it. */
function rewriteNote(result: { failed?: number; complete?: boolean }, finish: string): string {
  const failed = result.failed ?? 0;
  return join(
    failed > 0 && `${plural(failed, "comment")} could not be changed.`,
    result.complete === false && `Not every comment was changed (one call changes at most ${TAG_REWRITE_CAP}): ${finish}`,
  );
}

export const updateTag = defineTool({
  name: "superflow_update_tag",
  title: "Update a tag",
  description: [
    "Rename or recolor a tag on every comment that carries it, in every project. Tags are workspace-wide. A rename gives the tag the new name's id (one id per name); a new color, or the same name in other letter case, keeps the id.",
    "A name another tag already has is refused: fold the tag into that one with superflow_merge_tags instead.",
    `One call changes at most ${TAG_REWRITE_CAP} comments. When a rename comes back with complete: false, finish it with superflow_merge_tags from the old name into the new one (a second rename is refused, since the new name is now in use).`,
    "To find tag names and ids use superflow_list_tags.",
    'Example: {"tag": "copy", "name": "copywriting"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema,
    name: z.string().min(1).max(64).optional().describe("New name, up to 64 characters."),
    color: colorSchema,
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    if (args.name === undefined && args.color === undefined) return invalidInput("Nothing to change. Give name or color.");
    const tag = await api.call<TagWrite>("updateTag", { path: { tag: args.tag }, body: compact({ name: args.name, color: args.color }) });
    return okResult(
      join(
        `Updated tag ${tag.name ?? args.tag} (${tag.id}) on ${plural(tag.comments_updated ?? 0, "comment")}.`,
        rewriteNote(
          tag,
          args.name !== undefined
            ? `finish with superflow_merge_tags from "${args.tag}" into "${tag.name ?? args.name}".`
            : "tell the user the rest keep the old color for now.",
        ),
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
    "Without confirm: true nothing changes: you get the tag and how many comments carry it as a preview. Call again with confirm: true only after the user says yes.",
    `One call changes at most ${TAG_REWRITE_CAP} comments: when the result says complete: false, call again with the same arguments to finish.`,
    "To fold a tag into another one instead use superflow_merge_tags.",
    'Example: {"tag": "old-copy"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema,
    confirm: confirmSchema("delete the tag"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      // The API finds the tag among the workspace's tags the same way the preview did.
      const result = await api.call<DeleteTagResponse>("deleteTag", { path: { tag: args.tag.trim() }, query: { confirm: true } });
      return okResult(
        join(
          `Took tag ${args.tag.trim()} (${result.id}) off ${plural(result.removed_from ?? 0, "comment")}.`,
          rewriteNote(result, "call superflow_delete_tag again with the same arguments to finish."),
        ),
        asData(result),
      );
    }
    // Preview: one read. Nothing that could delete is sent without confirm.
    const { tags, scan } = await workspaceTags(api);
    const tag = findOne(tags, args.tag, LOOKUP);
    return confirmationResult(
      join(
        `Tag ${tag.name} (${tag.id}) would be taken off ${count(tag.usage_count)} comments.`,
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
    `One call changes at most ${TAG_REWRITE_CAP} comments: when the result says complete: false, call again with the same arguments to finish.`,
    "To just rename or recolor a tag use superflow_update_tag.",
    'Example: {"tag": "Copy text", "into": "copy"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema.describe("The tag to merge away (name or tag_ id). It is gone after the merge."),
    into: z.string().min(1).max(64).describe("The tag to keep (name or tag_ id), or a new name."),
    confirm: confirmSchema("merge the tags"),
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
      const result = await api.call<MergeTagsResponse>("mergeTags", {
        path: { tag: args.tag.trim() },
        body: { into: args.into.trim(), confirm: true },
      });
      return okResult(
        join(
          `Merged tag ${args.tag.trim()} into ${args.into.trim()}: ${plural(result.comments_updated ?? 0, "comment")} updated.`,
          rewriteNote(result, "call superflow_merge_tags again with the same arguments to finish."),
        ),
        asData(result),
      );
    }
    // Preview: one read. Nothing that could merge is sent without confirm.
    const { tags, scan } = await workspaceTags(api);
    const from = findOne(tags, args.tag, LOOKUP);
    const intoName = args.into.trim();
    // A name no comment carries yet becomes a new tag; an id must exist, and an ambiguous name fails.
    const isNew = matchRef(tags, intoName, { prefix: "tag_" }).kind === "none" && !intoName.startsWith("tag_");
    const into = isNew
      ? { id: null, name: intoName, color: from.color, usage_count: 0, new: true }
      : findOne(tags, intoName, LOOKUP);
    if (into.id === from.id) return invalidInput("tag and into are the same tag. Pick two different tags.");
    const target = isNew ? `a new tag ${into.name}` : into.name;
    return confirmationResult(
      join(
        `Tag ${from.name} would be merged into ${target}: ${count(from.usage_count)} comments would get ${into.name} instead, and ${from.name} would be gone.`,
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
