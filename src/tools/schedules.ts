// Schedule tools: create or change a scheduled agent run, list schedules, delete one.
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type { DeleteScheduleResponse, ListEnvelope, Schedule } from "../client/types.ts";
import { CONFIRM_DELETE_SCHEDULE_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, errorResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, join, nameList } from "./helpers.ts";
import { agentListSchema, confirmSchema, packRefSchema, projectRefSchema, runPagesSchema, runScopeSchema } from "./schemas.ts";

const scheduleRefSchema = z.string().min(1).describe("Schedule id (sch_...), from superflow_list_schedules.");

/** Five whitespace-separated cron fields. The API checks the values and the one hour minimum. */
const CRON_FIELDS = /^\S+(\s+\S+){4}$/;

function label(value: Schedule["project"] | Schedule["pack"]): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.name ?? value.id;
}

/** "sch_1 on Acme Dental: 0 9 * * 1 (Europe/Berlin), pack Pre-Launch, on, next run 2026-10-12T07:00:00Z, last run done." */
export function scheduleLine(schedule: Schedule): string {
  const project = label(schedule.project);
  const pack = label(schedule.pack);
  const agents = (schedule.agents ?? []).map((agent) => (typeof agent === "string" ? agent : agent.name ?? agent.id));
  const what = pack ? `pack ${pack}` : agents.length > 0 ? plural(agents.length, "agent") : "the default agents";
  return join(
    `${schedule.id}${project ? ` on ${project}` : ""}: ${schedule.cron} (${schedule.timezone ?? "UTC"}), ${what}, ${schedule.scope ?? "site"} scope, ${schedule.enabled ? "on" : "paused"}${schedule.next_run_at && schedule.enabled ? `, next run ${schedule.next_run_at}` : ""}${schedule.last_run ? `, last run ${schedule.last_run.status}` : ""}.`,
    agents.length > 0 && !pack && `Agents: ${nameList(agents)}.`,
  );
}

export const setSchedule = defineTool({
  name: "superflow_set_schedule",
  title: "Create or change a schedule",
  description: [
    "Schedule AI agent runs on a project with a cron expression, for example every Monday at 9:00. Without schedule this creates a new schedule; with schedule (a sch_ id) it changes only the fields you give.",
    "Every scheduled run spends AI credits, like superflow_run_agents. Price one run first with superflow_estimate_run (same project, scope and agents) and tell the user the cost per run before creating. When the balance is too low at run time, that run is skipped and last_run shows skipped_insufficient_credits.",
    "Runs at most once an hour: more frequent crons are refused. Pause with enabled: false; delete with superflow_delete_schedule. Ask the user before creating or changing a schedule.",
    'Example: {"project": "Acme Dental", "cron": "0 9 * * 1", "timezone": "Europe/Berlin", "pack": "Pre-Launch"}',
  ].join("\n"),
  inputSchema: {
    schedule: scheduleRefSchema
      .optional()
      .describe("The schedule to change (sch_...). Leave it out to create a new schedule."),
    project: projectRefSchema.optional().describe("Project to review (name, site URL or id). Required to create."),
    cron: z
      .string()
      .min(1)
      .optional()
      .describe("When to run: a five-field cron (minute hour day-of-month month day-of-week), for example \"0 9 * * 1\" for Mondays at 9:00. At most once an hour. Required to create."),
    timezone: z
      .string()
      .min(1)
      .optional()
      .describe("IANA time zone for the cron, for example Europe/Berlin or America/New_York. Default UTC."),
    agents: agentListSchema("Agents to run"),
    pack: packRefSchema.optional().describe("Run every agent in this pack (name or pck_ id). Give agents or pack, not both."),
    scope: runScopeSchema,
    pages: runPagesSchema,
    enabled: z.boolean().optional().describe("false pauses the schedule, true turns it back on. New schedules start on."),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    if (args.agents && args.pack) return invalidInput("Give agents or pack, not both.");
    if (args.cron !== undefined && !CRON_FIELDS.test(args.cron.trim())) {
      return invalidInput(
        `cron "${args.cron}" is not a five-field cron expression.`,
        "Use minute hour day-of-month month day-of-week, for example \"0 9 * * 1\" for Mondays at 9:00.",
      );
    }
    const fields = compact({
      project: args.project,
      cron: args.cron?.trim(),
      timezone: args.timezone,
      agents: args.agents,
      pack: args.pack,
      scope: args.scope,
      pages: args.pages,
      enabled: args.enabled,
    });
    if (!args.schedule) {
      if (!args.project || !args.cron) {
        return invalidInput("A new schedule needs project and cron.", "To change an existing schedule, pass its id as schedule.");
      }
      if (args.scope === "list" && !args.pages) return invalidInput("scope list needs pages: the page URLs to review.");
      const created = await api.call<Schedule>("createSchedule", { body: fields });
      return okResult(join(`Created schedule ${scheduleLine(created)}`, "Each run spends AI credits."), asData(created));
    }
    if (Object.keys(fields).length === 0) {
      return invalidInput("Nothing to change. Give cron, timezone, agents, pack, scope, pages, enabled or project.");
    }
    const updated = await api.call<Schedule>("updateSchedule", { path: { schedule: args.schedule }, body: fields });
    return okResult(`Updated schedule ${scheduleLine(updated)}`, asData(updated));
  },
});

export const listSchedules = defineTool({
  name: "superflow_list_schedules",
  title: "List schedules",
  description: [
    "List scheduled agent runs: project, cron and time zone, agents or pack, whether each is on, the next run time and how the last run went (including runs skipped for lack of credits).",
    "Use it before creating, changing or deleting a schedule. For runs that already happened use superflow_list_runs.",
    'Example: {"project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema.optional().describe("Only this project's schedules (name, site URL or id)."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = await api.call<ListEnvelope<Schedule>>("listSchedules", { query: { project: args.project } });
    const items = list.items ?? [];
    const lines = items.slice(0, 3).map(scheduleLine).join(" ");
    return okResult(join(`Found ${plural(items.length, "schedule")}${args.project ? ` on ${args.project}` : ""}.`, lines, items.length > 3 && "More in the list below."), asData(list));
  },
});

export const deleteSchedule = defineTool({
  name: "superflow_delete_schedule",
  title: "Delete a schedule",
  description: [
    "Delete a scheduled agent run so no more runs start from it. Past runs and their findings stay. Safe to repeat.",
    "Without confirm: true nothing is deleted: you get the schedule as a preview to show the user. Call again with confirm: true only after the user says yes.",
    "To pause instead, use superflow_set_schedule with enabled: false.",
    'Example: {"schedule": "sch_4d5e6f"}',
  ].join("\n"),
  inputSchema: {
    schedule: scheduleRefSchema,
    confirm: confirmSchema("delete the schedule"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    const ref = args.schedule.trim();
    if (isConfirmed(args.confirm)) {
      const result = await api.call<DeleteScheduleResponse>("deleteSchedule", { path: { schedule: ref } });
      return okResult(`Deleted schedule ${result.id ?? ref}. No more runs start from it.`, asData(result));
    }
    // Preview: one read. Nothing that could delete is sent without confirm.
    const list = await api.call<ListEnvelope<Schedule>>("listSchedules");
    const raw = ref.replace(/^sch_/, "");
    const schedule = (list.items ?? []).find((item) => item.id === ref || item.id.replace(/^sch_/, "") === raw);
    if (!schedule) {
      return errorResult(
        new SuperflowApiError({
          status: 404,
          code: "not_found",
          message: `No schedule ${ref}.`,
          hint: "List the schedules with superflow_list_schedules. A deleted schedule is already gone.",
        }),
      );
    }
    return confirmationResult(
      `Schedule ${scheduleLine(schedule)} It would be deleted. Nothing was deleted. Ask the user to confirm.`,
      { preview: schedule, message: CONFIRM_DELETE_SCHEDULE_MESSAGE },
    );
  },
});

export const scheduleTools = [setSchedule, listSchedules, deleteSchedule];
