// Schedule tools: create or change a scheduled agent run, list schedules, delete one.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type { ApiClient } from "../client/api.ts";
import type { DeleteScheduleResponse, ListEnvelope, RunEstimate, Schedule } from "../client/types.ts";
import { CONFIRM_DELETE_SCHEDULE_MESSAGE, CONFIRM_SET_SCHEDULE_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, errorResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, join, nameList } from "./helpers.ts";
import { estimateLine } from "./runs.ts";
import {
  agentListSchema,
  confirmSchema,
  idempotencySchema,
  packRefSchema,
  projectRefSchema,
  runPagesSchema,
  runScopeSchema,
} from "./schemas.ts";

const scheduleRefSchema = z.string().min(1).describe("Schedule id (sch_...), from superflow_list_schedules.");

/** Five whitespace-separated cron fields. The API checks the values and the one hour minimum. */
const CRON_FIELDS = /^\S+(\s+\S+){4}$/;

function label(value: Schedule["project"] | Schedule["pack"]): string | undefined {
  return value ? (value.name ?? value.id) : undefined;
}

const LAST_RUN_LABELS: Record<string, string> = {
  skipped_insufficient_credits: "skipped (not enough AI credits)",
  failed_to_start: "failed to start",
};

/** "sch_1 on Acme Dental: 0 9 * * 1 (Europe/Berlin), pack Pre-Launch, on, next run 2026-10-12T07:00:00Z, last run done." */
export function scheduleLine(schedule: Schedule): string {
  const project = label(schedule.project);
  const pack = label(schedule.pack);
  const agents = (schedule.agents ?? []).map((agent) => agent.name ?? agent.id);
  const what = pack ? `pack ${pack}` : agents.length > 0 ? plural(agents.length, "agent") : "the default agents";
  return join(
    `${schedule.id}${project ? ` on ${project}` : ""}: ${schedule.cron} (${schedule.timezone ?? "UTC"}), ${what}, ${schedule.scope ?? "site"} scope, ${schedule.enabled ? "on" : "paused"}${schedule.next_run_at && schedule.enabled ? `, next run ${schedule.next_run_at}` : ""}${schedule.last_run ? `, last run ${LAST_RUN_LABELS[schedule.last_run.status] ?? schedule.last_run.status}` : ""}.`,
    agents.length > 0 && !pack && `Agents: ${nameList(agents)}.`,
  );
}

/** Finds a schedule by id (sch_ prefix optional) in the list, or null. */
async function findSchedule(api: ApiClient, ref: string): Promise<Schedule | null> {
  const list = await api.call<ListEnvelope<Schedule>>("listSchedules");
  const raw = ref.replace(/^sch_/, "");
  return (list.items ?? []).find((item) => item.id === ref || item.id.replace(/^sch_/, "") === raw) ?? null;
}

function scheduleNotFound(ref: string) {
  return errorResult(
    new SuperflowApiError({
      status: 404,
      code: "not_found",
      message: `No schedule ${ref}.`,
      hint: "List the schedules with superflow_list_schedules. A deleted schedule is already gone.",
    }),
  );
}

/**
 * The price of one run of a schedule, as one sentence. Never fails the preview: a price that
 * cannot be read (no agents:read scope, a pricing outage) says so instead.
 */
async function pricePerRun(api: ApiClient, target: { project: string; scope?: string | undefined; pages?: string[] | undefined; agents?: string[] | undefined; pack?: string | undefined }): Promise<{ line: string; estimate: RunEstimate | null }> {
  try {
    const estimate = await api.call<RunEstimate>("estimateRun", { body: compact({ ...target, pages: target.pages?.length ? target.pages : undefined }) });
    return { line: `One run now: ${estimateLine(estimate)}`, estimate };
  } catch (error) {
    const why = error instanceof SuperflowApiError ? error.message : "the estimate failed";
    return { line: `One run could not be priced (${why}); price it with superflow_estimate_run.`, estimate: null };
  }
}

export const setSchedule = defineTool({
  name: "superflow_set_schedule",
  title: "Create or change a schedule",
  description: [
    "Schedule AI agent runs on a project with a cron expression, for example every Monday at 9:00. Without schedule this creates a new schedule; with schedule (a sch_ id) it changes only the fields you give.",
    "Every scheduled run spends AI credits, like superflow_run_agents. Without confirm: true nothing is created or changed: you get when it would run, which agents, and the price of one run (from the estimate) as a preview to show the user. Call again with confirm: true only after the user says yes. Pausing (enabled: false) and moving the time zone need no confirm. When the balance is too low at run time, that run is skipped and last_run shows skipped_insufficient_credits (failed_to_start when the run could not start).",
    "Runs at most once an hour: more frequent crons are refused. Delete with superflow_delete_schedule. For one run now use superflow_run_agents.",
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
    agents: agentListSchema("Agents to run")
      .nullable()
      .describe("Agents to run: names or ids (agt_...), at most 25. Give agents or pack, not both. On a change, null clears them (then the pack or the default agents run)."),
    pack: packRefSchema
      .nullable()
      .optional()
      .describe("Run every agent in this pack (name or pck_ id). Give agents or pack, not both. On a change, null clears it."),
    scope: runScopeSchema,
    pages: runPagesSchema.nullable().describe("Page URLs to review, at most 500, for scope list. On a change, null clears them."),
    enabled: z.boolean().optional().describe("false pauses the schedule, true turns it back on. New schedules start on."),
    confirm: confirmSchema("create the schedule or change what or when it runs; every run spends AI credits"),
    idempotency_key: idempotencySchema.describe(
      "Only when creating: a key so a retried call does not create two schedules. Generated when you leave it out. After a timeout, pass the idempotency_key the error returned.",
    ),
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
    // null clears agents, pack or pages on a change; compact keeps it, and drops only what was not given.
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
      // A new schedule has nothing to clear, so null means "not given".
      const body = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
      if (!isConfirmed(args.confirm)) {
        // Preview: the estimate only. Nothing that could create a schedule is sent without confirm.
        const price = await pricePerRun(api, {
          project: args.project,
          scope: args.scope,
          pages: args.pages ?? undefined,
          agents: args.agents ?? undefined,
          pack: args.pack ?? undefined,
        });
        const what = args.pack ? `pack ${args.pack}` : args.agents ? plural(args.agents.length, "agent") : "the default agents";
        return confirmationResult(
          join(
            `A schedule on ${args.project} would run ${what} at "${args.cron.trim()}" (${args.timezone ?? "UTC"}), ${args.scope ?? "site"} scope, and every run spends AI credits.`,
            price.line,
            "Nothing was created. Ask the user to confirm.",
          ),
          { preview: { schedule: body, estimate: price.estimate }, message: CONFIRM_SET_SCHEDULE_MESSAGE },
        );
      }
      const created = await api.call<Schedule>("createSchedule", {
        // Generated once per tool call, so the client's own retries cannot create two schedules.
        body: { ...body, idempotency_key: args.idempotency_key ?? randomUUID() },
      });
      return okResult(join(`Created schedule ${scheduleLine(created)}`, "Each run spends AI credits."), asData(created));
    }
    if (Object.keys(fields).length === 0) {
      return invalidInput("Nothing to change. Give cron, timezone, agents, pack, scope, pages, enabled or project.");
    }
    // Pausing and moving the time zone cannot raise what the schedule spends: no confirm.
    const spendsMore = Object.keys(fields).some((key) => key !== "timezone" && !(key === "enabled" && fields.enabled === false));
    if (spendsMore && !isConfirmed(args.confirm)) {
      const current = await findSchedule(api, args.schedule.trim());
      if (!current) return scheduleNotFound(args.schedule.trim());
      // The schedule as it would be after the change: given fields win, null clears.
      const agents = args.agents === null ? undefined : (args.agents ?? (args.pack ? undefined : current.agents?.map((agent) => agent.id)));
      const pack = args.pack === null ? undefined : (args.pack ?? (args.agents ? undefined : current.pack?.id));
      const price = await pricePerRun(api, {
        project: args.project ?? current.project.id,
        scope: args.scope ?? current.scope,
        pages: args.pages === null ? undefined : (args.pages ?? current.pages),
        agents: agents?.length ? agents : undefined,
        pack,
      });
      return confirmationResult(
        join(
          `Schedule ${scheduleLine(current)}`,
          `The change (${Object.keys(fields).join(", ")}) changes what or when it runs, and every run spends AI credits.`,
          price.line,
          "Nothing was changed. Ask the user to confirm.",
        ),
        { preview: { schedule: current, changes: fields, estimate: price.estimate }, message: CONFIRM_SET_SCHEDULE_MESSAGE },
      );
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
    const schedule = await findSchedule(api, ref);
    if (!schedule) return scheduleNotFound(ref);
    return confirmationResult(
      `Schedule ${scheduleLine(schedule)} It would be deleted. Nothing was deleted. Ask the user to confirm.`,
      { preview: schedule, message: CONFIRM_DELETE_SCHEDULE_MESSAGE },
    );
  },
});

export const scheduleTools = [setSchedule, listSchedules, deleteSchedule];
