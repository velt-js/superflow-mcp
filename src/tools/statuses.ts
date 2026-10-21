// Status admin tools: create, update, reorder, delete (with the comments moved).
import { z } from "zod";
import type {
  CustomStatusFlag,
  DeleteStatusResponse,
  ListEnvelope,
  StatsResponse,
  Status,
  StatusOrderResponse,
  StatusWriteResponse,
} from "../client/types.ts";
import { CONFIRM_DELETE_STATUS_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { findOne } from "../lib/match.ts";
import { defineTool, hints } from "./define.ts";
import { asData, compact, join } from "./helpers.ts";
import { confirmSchema, hexColorSchema, projectRefSchema } from "./schemas.ts";

const CUSTOM_STATUSES_OFF = "Custom statuses are turned off for this workspace, so the toolbar does not show them yet.";
const TURN_ON = "Turn them on in Superflow under Settings > Advanced features.";

const VELT_WINDOW_NOTE =
  "Comments are moved through Velt, which can only update the newest 1,000 comments of a project, so on bigger projects some older comments may keep the deleted status.";

const catalogProject = projectRefSchema
  .optional()
  .describe(
    "Project (name, site URL or id) whose own statuses to change: the ones added to that project with superflow_create_status. Omit for the workspace statuses.",
  );

const statusRefSchema = z.string().min(1).describe("Status: its name (\"In review\") or id (sts_...).");

const colorSchema = hexColorSchema.optional().describe("Hex color, for example #7c3aed.");

function scopeLabel(project: string | undefined): string {
  return project ? `project ${project}` : "the workspace";
}

/** The "custom statuses are off" note, with the API's hint, when the workspace switch is off. */
function flagNote(result: Partial<CustomStatusFlag>): string | undefined {
  if (result.custom_statuses_enabled !== false) return undefined;
  const hint = typeof result.hint === "string" && result.hint.trim() !== "" ? result.hint.trim() : TURN_ON;
  return `${CUSTOM_STATUSES_OFF} ${/[.!?]$/.test(hint) ? hint : `${hint}.`}`;
}

export const createStatus = defineTool({
  name: "superflow_create_status",
  title: "Create a status",
  description: [
    'Add a custom comment status (a workflow column, for example "In review") to the workspace, or to one project when project is given. New statuses are in-progress statuses: the default and resolved statuses are fixed.',
    "Needs a plan with custom statuses. If custom statuses are turned off for the workspace, the status is saved but the toolbar shows it only after someone turns them on in Settings > Advanced features.",
    "To rename or recolor use superflow_update_status. To change the order use superflow_reorder_statuses. Ask the user before changing the workflow.",
    'Example: {"name": "In review", "color": "#7c3aed", "project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    name: z.string().min(1).max(20).describe("Status name, 1 to 20 characters."),
    color: colorSchema,
    project: projectRefSchema
      .optional()
      .describe("Project (name, site URL or id) to add the status to. Omit to add it to the workspace list."),
  },
  annotations: hints(false, false, false, false),
  write: true,
  async run(args, { api }) {
    const body = compact({ name: args.name, color: args.color });
    const status = args.project
      ? await api.call<StatusWriteResponse>("createProjectStatus", { path: { project: args.project }, body })
      : await api.call<StatusWriteResponse>("createStatus", { body });
    const summary = join(`Created status ${status.name ?? args.name} (${status.id}) in ${scopeLabel(args.project)}.`, flagNote(status));
    return okResult(summary, asData(status));
  },
});

export const updateStatus = defineTool({
  name: "superflow_update_status",
  title: "Update a status",
  description: [
    "Rename or recolor one status. Its type (in progress, default or resolved) never changes, and comments keep the status.",
    "Give project for a status that was added to that project; leave it out for a workspace status. To add a status use superflow_create_status; to change the order use superflow_reorder_statuses.",
    'Example: {"status": "In review", "project": "Acme Dental", "name": "Client review"}',
  ].join("\n"),
  inputSchema: {
    status: statusRefSchema,
    project: catalogProject,
    name: z.string().min(1).max(20).optional().describe("New name, 1 to 20 characters."),
    color: colorSchema,
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    if (args.name === undefined && args.color === undefined) {
      return invalidInput("Nothing to change. Give name or color.", "A status's type cannot change.");
    }
    const status = await api.call<StatusWriteResponse>("updateStatus", {
      path: { status: args.status },
      query: { project: args.project },
      body: compact({ name: args.name, color: args.color }),
    });
    const summary = join(`Updated status ${status.name ?? args.status} (${status.id}) in ${scopeLabel(args.project)}.`, flagNote(status));
    return okResult(summary, asData(status));
  },
});

export const reorderStatuses = defineTool({
  name: "superflow_reorder_statuses",
  title: "Reorder statuses",
  description: [
    "Set the order of the statuses (the workflow columns). List every status of that list exactly once, in the new order: the workspace statuses, or, when project is given, the statuses added to that project.",
    "Get the current statuses and their ids with superflow_list_statuses first (a project's own statuses are the ones with a project_id).",
    'Example: {"project": "Acme Dental", "status_ids": ["sts_OPEN", "sts_IN_REVIEW", "sts_RESOLVED"]}',
  ].join("\n"),
  inputSchema: {
    status_ids: z
      .array(z.string().min(1))
      .min(1)
      .max(50)
      .describe("Every status of the list, by id or name, in the new order."),
    project: catalogProject,
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const seen = new Set(args.status_ids.map((id) => id.trim().toLowerCase()));
    if (seen.size !== args.status_ids.length) {
      return invalidInput("Each status may appear only once in status_ids.");
    }
    const result = await api.call<StatusOrderResponse>("reorderStatuses", {
      query: { project: args.project },
      body: { status_ids: args.status_ids },
    });
    const items = result.items ?? [];
    const order = items.length > 0 ? items.map((s) => s.name).join(", ") : args.status_ids.join(", ");
    return okResult(join(`New status order in ${scopeLabel(args.project)}: ${order}.`, flagNote(result)), asData(result));
  },
});

export const deleteStatus = defineTool({
  name: "superflow_delete_status",
  title: "Delete a status",
  description: [
    "Delete a custom status. Its comments move to move_comments_to, which is required: another status those comments can have. The default and the resolved status cannot be deleted. Give project to delete a status that was added to that project.",
    VELT_WINDOW_NOTE,
    "Without confirm: true nothing is deleted: you get the status, where its comments go and how many there are. Call again with confirm: true only after the user says yes.",
    'Example: {"status": "In review", "move_comments_to": "Open", "project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    status: statusRefSchema,
    move_comments_to: z
      .string()
      .min(1)
      .describe("Status (name or id) that takes over this status's comments. With project, any status that project uses."),
    project: catalogProject,
    confirm: confirmSchema("delete the status"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      const result = await api.call<DeleteStatusResponse>("deleteStatus", {
        path: { status: args.status },
        query: { project: args.project, move_comments_to: args.move_comments_to },
      });
      const summary = join(
        `Deleted status ${args.status} (${result.id ?? "unknown id"}) from ${scopeLabel(args.project)}.`,
        `Moved ${plural(result.comments_moved ?? 0, "comment")} to ${args.move_comments_to}.`,
        flagNote(result),
      );
      return okResult(summary, asData(result));
    }
    // Preview: reads only. Nothing that could delete is sent without confirm. A project's list
    // is the workspace statuses merged with the project's own (those carry a project_id); only
    // its own can be deleted with project, but its comments may move to any of them.
    const list = args.project
      ? await api.call<ListEnvelope<Status>>("listProjectStatuses", { path: { project: args.project } })
      : await api.call<ListEnvelope<Status>>("listStatuses");
    const statuses = list.items ?? [];
    const lookup = {
      prefix: "sts_",
      noun: "status",
      where: scopeLabel(args.project),
      notFoundHint: `The statuses are: ${statuses.map((s) => s.name).join(", ") || "none"}.`,
    };
    const status = findOne(statuses, args.status, lookup);
    const target = findOne(statuses, args.move_comments_to, lookup);
    if (args.project && status.project_id === null) {
      return invalidInput(
        `${status.name} is a workspace status, not one added to project ${args.project}.`,
        "Call again without project to delete it from the workspace statuses.",
      );
    }
    if (status.is_default || status.is_resolved) {
      return invalidInput(
        `${status.name} is the ${status.is_default ? "default" : "resolved"} status, and the default and resolved statuses cannot be deleted.`,
        "Rename it with superflow_update_status instead.",
      );
    }
    if (status.id === target.id) {
      return invalidInput("move_comments_to must be a different status than the one being deleted.");
    }
    // Best effort: how many comments would move. A failed count does not block the preview.
    let commentCount: number | null = null;
    let countComplete = true;
    try {
      const stats = await api.call<StatsResponse>("getCommentStats", {
        query: { project: args.project, status: [status.id], group_by: "status" },
      });
      commentCount = typeof stats.total === "number" ? stats.total : null;
      countComplete = stats.scan?.complete !== false;
    } catch {
      commentCount = null;
    }
    const comments =
      commentCount === null
        ? "its comments (the count is not available)"
        : `its ${countComplete ? "" : "at least "}${plural(commentCount, "comment")}`;
    return confirmationResult(
      `Status ${status.name} would be deleted from ${scopeLabel(args.project)} and ${comments} moved to ${target.name}. Nothing was deleted. Ask the user to confirm.`,
      {
        preview: {
          status,
          move_comments_to: target,
          comment_count: commentCount,
          ...(countComplete ? {} : { comment_count_is_minimum: true }),
        },
        message: CONFIRM_DELETE_STATUS_MESSAGE,
      },
    );
  },
});

export const statusTools = [createStatus, updateStatus, reorderStatuses, deleteStatus];
