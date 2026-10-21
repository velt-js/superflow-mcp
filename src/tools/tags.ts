// Tag admin tools: create, rename or recolor, delete, merge.
import { z } from "zod";
import type { DeleteTagResponse, ListEnvelope, MergeTagsResponse, Tag } from "../client/types.ts";
import type { ApiClient } from "../client/api.ts";
import { CONFIRM_DELETE_TAG_MESSAGE, CONFIRM_MERGE_TAGS_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { findOne } from "../lib/match.ts";
import { defineTool, hints } from "./define.ts";
import { asData, compact, count } from "./helpers.ts";
import { confirmSchema, hexColorSchema, projectRefSchema } from "./schemas.ts";

const tagRefSchema = z.string().min(1).describe("Tag: its name (\"copy\") or id (tag_...).");
const colorSchema = hexColorSchema.optional().describe("Hex color, for example #b3261e.");
const lookupProject = projectRefSchema
  .optional()
  .describe("Project the tag belongs to (name, site URL or id). Needed to find a project tag by name; omit for workspace tags.");

/** Lists the tags a preview can look in: the workspace's, plus the project's when given. */
async function tagsFor(api: ApiClient, project: string | undefined): Promise<Tag[]> {
  const list = project
    ? await api.call<ListEnvelope<Tag>>("listProjectTags", { path: { project } })
    : await api.call<ListEnvelope<Tag>>("listTags");
  return list.items ?? [];
}

function lookup(project: string | undefined) {
  return {
    prefix: "tag_",
    noun: "tag",
    where: project ? `project "${project}"` : "the workspace tags",
    notFoundHint: project
      ? "List the tags with superflow_list_tags and the same project."
      : "If it is a project tag, pass project. List tags with superflow_list_tags.",
  };
}

export const createTag = defineTool({
  name: "superflow_create_tag",
  title: "Create a tag",
  description: [
    "Create a comment tag for the workspace, or for one project when project is given. Names are unique per workspace or project, ignoring case, and a project tag cannot reuse the name of a workspace tag: a clash comes back as an error with the existing tag as the candidate.",
    "You rarely need this: tagging a comment with a new name creates the tag. Use it to set tags up before a review, or to pick a color.",
    "To rename or recolor use superflow_update_tag.",
    'Example: {"name": "copy", "color": "#b3261e", "project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    name: z.string().min(1).max(64).describe("Tag name, up to 64 characters."),
    color: colorSchema,
    project: projectRefSchema
      .optional()
      .describe("Project (name, site URL or id) for a project tag. Omit for a workspace tag."),
  },
  annotations: hints(false, false, false, false),
  write: true,
  async run(args, { api }) {
    const tag = await api.call<Tag>("createTag", { body: compact({ name: args.name, color: args.color, project: args.project }) });
    return okResult(
      `Created tag ${tag.name ?? args.name} (${tag.id}) ${args.project ? `in project ${args.project}` : "for the workspace"}.`,
      asData(tag),
    );
  },
});

export const updateTag = defineTool({
  name: "superflow_update_tag",
  title: "Update a tag",
  description: [
    "Rename or recolor a tag. The id stays the same and every comment keeps the tag.",
    "To fold one tag into another use superflow_merge_tags. To find tag names and ids use superflow_list_tags.",
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
    const tag = await api.call<Tag>("updateTag", { path: { tag: args.tag }, body: compact({ name: args.name, color: args.color }) });
    return okResult(`Updated tag ${tag.name ?? args.tag} (${tag.id}).`, asData(tag));
  },
});

export const deleteTag = defineTool({
  name: "superflow_delete_tag",
  title: "Delete a tag",
  description: [
    "Delete a tag and remove it from every comment that has it. The comments stay; only the tag goes.",
    "Without confirm: true nothing is deleted: you get the tag and how many comments use it as a preview. Call again with confirm: true only after the user says yes.",
    "To fold a tag into another one instead use superflow_merge_tags.",
    'Example: {"tag": "old-copy", "project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema,
    project: lookupProject,
    confirm: confirmSchema("delete the tag"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      const result = await api.call<DeleteTagResponse>("deleteTag", { path: { tag: args.tag }, query: { confirm: true } });
      return okResult(
        `Deleted tag ${args.tag} (${result.id ?? "unknown id"}) and removed it from ${plural(result.removed_from ?? 0, "comment")}.`,
        asData(result),
      );
    }
    // Preview: one read. Nothing that could delete is sent without confirm.
    const tag = findOne(await tagsFor(api, args.project), args.tag, lookup(args.project));
    return confirmationResult(
      `Tag ${tag.name} (${tag.id}) would be deleted and removed from ${count(tag.usage_count)} comments. Nothing was deleted. Ask the user to confirm.`,
      { preview: { tag, comment_count: tag.usage_count ?? null }, message: CONFIRM_DELETE_TAG_MESSAGE },
    );
  },
});

export const mergeTags = defineTool({
  name: "superflow_merge_tags",
  title: "Merge tags",
  description: [
    "Merge one tag into another: every comment tagged tag gets into instead, then tag is deleted. Use it to clean up near-duplicates such as \"Copy text\" and \"copy\". into must be a workspace tag or a tag of the same project.",
    "Without confirm: true nothing changes: you get both tags and how many comments would change as a preview. Call again with confirm: true only after the user says yes.",
    "To just rename a tag use superflow_update_tag.",
    'Example: {"tag": "Copy text", "into": "copy", "project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    tag: tagRefSchema.describe("The tag to merge away (name or tag_ id). It is deleted after the merge."),
    into: tagRefSchema.describe("The tag to keep (name or tag_ id)."),
    project: lookupProject,
    confirm: confirmSchema("merge the tags"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      const result = await api.call<MergeTagsResponse>("mergeTags", {
        path: { tag: args.tag },
        body: { into: args.into, confirm: true },
      });
      return okResult(
        `Merged tag ${args.tag} into ${args.into}: ${plural(result.comments_updated ?? 0, "comment")} updated, and ${args.tag} was deleted.`,
        asData(result),
      );
    }
    // Preview: one read. Nothing that could merge is sent without confirm.
    const tags = await tagsFor(api, args.project);
    const from = findOne(tags, args.tag, lookup(args.project));
    const into = findOne(tags, args.into, lookup(args.project));
    if (from.id === into.id) return invalidInput("tag and into are the same tag. Pick two different tags.");
    return confirmationResult(
      `Tag ${from.name} would be merged into ${into.name}: ${count(from.usage_count)} comments would get ${into.name}, and ${from.name} would be deleted. Nothing was merged. Ask the user to confirm.`,
      { preview: { from, into, comments_to_update: from.usage_count ?? null }, message: CONFIRM_MERGE_TAGS_MESSAGE },
    );
  },
});

export const tagTools = [createTag, updateTag, deleteTag, mergeTags];
