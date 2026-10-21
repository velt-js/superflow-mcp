// Run tools: estimate a run, start it, follow it, list runs, and read a run's findings.
import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type { Finding, ListEnvelope, Ref, Run, RunEstimate } from "../client/types.ts";
import { ADD_CREDITS_HINT, CONFIRM_RUN_AGENTS_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { DATE_HELP, isValidDateFilter } from "../lib/dates.ts";
import { confirmationResult, errorResult, invalidInput, okResult, paginationNote, plural, scanNote } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, count, join, nameList } from "./helpers.ts";
import {
  FINDING_SEVERITIES,
  RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  agentListSchema,
  confirmSchema,
  cursorSchema,
  dateSchema,
  idempotencySchema,
  limitSchema,
  packRefSchema,
  projectRefSchema,
  runPagesSchema,
  runRefSchema,
  runScopeSchema,
} from "./schemas.ts";

/** How often a model may poll a run, in seconds. */
export const POLL_SECONDS = 20;

const POLL_NOTE = `Check again with superflow_get_run in ${POLL_SECONDS} seconds or more; it is finished when the status is done, failed or partial.`;

const TOKEN_NOTE = "This workspace is billed by model usage, so runs cannot be priced in advance.";

/** The input shared by superflow_estimate_run and superflow_run_agents (CONTRACT-P3 section 4). */
const runShape = {
  project: projectRefSchema,
  scope: runScopeSchema,
  pages: runPagesSchema,
  agents: agentListSchema("Agents to run"),
  pack: packRefSchema.optional().describe("Run every agent in this pack (name or pck_ id) instead of naming agents. Give agents or pack, not both."),
};

interface RunInput {
  project: string;
  scope?: string | undefined;
  pages?: string[] | undefined;
  agents?: string[] | undefined;
  pack?: string | undefined;
}

/** Local checks before any request: agents or pack, and pages for a list scope. */
function checkRunInput(args: RunInput): CallToolResult | undefined {
  if (args.agents && args.pack) return invalidInput("Give agents or pack, not both.");
  if (args.scope === "list" && !args.pages) return invalidInput("scope list needs pages: the page URLs to review.");
  return undefined;
}

function runBody(args: RunInput): Record<string, unknown> {
  return compact({ project: args.project, scope: args.scope, pages: args.pages, agents: args.agents, pack: args.pack });
}

function agentNames(agents: readonly Ref[] | undefined): string {
  const names = (agents ?? []).map((agent) => agent.name ?? agent.id);
  return names.length > 0 ? `${plural(names.length, "agent")} (${nameList(names)})` : "the default agents";
}

/** One line on the price and the balance of an estimate. */
function estimateLine(estimate: RunEstimate): string {
  if (estimate.pricing_mode === "token" || estimate.credits === null || estimate.credits === undefined) {
    return join(
      `A run with ${agentNames(estimate.agents)} on ${estimate.page_count === null || estimate.page_count === undefined ? "the site" : plural(estimate.page_count, "page")}.`,
      estimate.note || TOKEN_NOTE,
      estimate.balance !== null && estimate.balance !== undefined && `Balance: ${count(estimate.balance)} credits.`,
    );
  }
  const pages = estimate.page_count === null || estimate.page_count === undefined ? "the site" : plural(estimate.page_count, "page");
  return join(
    `This run would cost ${estimate.credits_display ?? `${count(estimate.credits)} credits`} (${estimate.pricing_mode} pricing${estimate.band ? `, ${estimate.band} band` : ""}${estimate.is_rescan ? ", rescan" : ""}): ${pages} with ${agentNames(estimate.agents)}.`,
    `Balance: ${count(estimate.balance)} credits${estimate.auto_refill_enabled ? ", auto refill on" : ""}.`,
    estimate.note,
  );
}

/** The estimate says the balance cannot cover the run. */
function insufficient(estimate: RunEstimate): boolean {
  return estimate.sufficient === false;
}

function insufficientSummary(estimate: RunEstimate): string {
  return join(
    `Not enough AI credits for this run: it needs ${estimate.credits_display ?? `${count(estimate.credits)} credits`} and the balance is ${count(estimate.balance)}.`,
    estimate.auto_refill_enabled ? "Auto refill is on but has not covered it." : "",
    ADD_CREDITS_HINT,
  );
}

export const estimateRun = defineTool({
  name: "superflow_estimate_run",
  title: "Estimate a run",
  description: [
    "Price an AI agent run before starting it: the credits it would spend, how many pages, which agents, the current balance and whether it is enough. It charges nothing and starts nothing.",
    "Always call it before superflow_run_agents and show the user the credits. Use the same project, scope, pages and agents or pack you will run. With no agents and no pack it uses the default agents (or the pack set as default for runs).",
    "Exact in scan pricing; an estimate in flat pricing; workspaces billed by model usage cannot be priced in advance (credits is null).",
    'Example: {"project": "Acme Dental", "scope": "site", "pack": "Pre-Launch"}',
  ].join("\n"),
  inputSchema: runShape,
  annotations: hints(true, false, true, true),
  write: false,
  async run(args, { api }) {
    const problem = checkRunInput(args);
    if (problem) return problem;
    const estimate = await api.call<RunEstimate>("estimateRun", { body: runBody(args) });
    if (insufficient(estimate)) return okResult(insufficientSummary(estimate), asData(estimate));
    return okResult(
      join(estimateLine(estimate), "Show the user the credits and ask before starting it with superflow_run_agents and confirm: true."),
      asData(estimate),
    );
  },
});

/** The API's refusal when the balance cannot cover a run (409 invalid, "Not enough AI credits"). */
function isCreditsRefusal(error: unknown): error is SuperflowApiError {
  return error instanceof SuperflowApiError && error.code === "invalid" && /credit/i.test(`${error.message} ${error.hint}`);
}

export function runSummary(run: Run, lead = "Run"): string {
  const project = run.project?.name ?? run.project?.id;
  const executions = run.executions ?? [];
  const finished = executions.filter((e) => e.status !== "running").length;
  const terminal = (TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status);
  const head = `${lead} ${run.id}${project ? ` on ${project}` : ""}: ${run.status}`;
  if (!terminal) {
    return join(
      `${head}${executions.length > 0 ? ` (${finished} of ${plural(executions.length, "agent")} finished)` : ""}.`,
      typeof run.credits_charged === "number" && `Credits charged: ${count(run.credits_charged)}.`,
      POLL_NOTE,
    );
  }
  return join(
    `${head}. ${plural(run.findings_count ?? 0, "finding")} from ${agentNames(run.agents)}.`,
    typeof run.credits_charged === "number" && `Credits charged: ${count(run.credits_charged)}.`,
    run.status === "partial" && "Some agents did not finish; their status is in executions.",
    run.status === "failed" && "No agent finished; see executions for each agent's status.",
    (run.findings_count ?? 0) > 0 && "Read them with superflow_list_findings.",
  );
}

export const runAgents = defineTool({
  name: "superflow_run_agents",
  title: "Run agents",
  description: [
    "Start an AI agent run: one scan of the project's site (or one page, or a list of pages) by the agents you pick, a pack, or the default agents. It spends AI credits and the agents leave their findings as comments on the pages.",
    "Always call superflow_estimate_run first and show the user the credits. Without confirm: true nothing is started: this tool returns the estimate as a preview so you can ask. Call again with confirm: true only after the user says yes.",
    `When the balance is too low the run is refused: tell the user the balance and to add credits in Superflow under Settings > Billing. Do not retry. After starting, follow it with superflow_get_run no more often than every ${POLL_SECONDS} seconds. At most 25 agents per run. A run cannot be cancelled.`,
    'Example: {"project": "Acme Dental", "scope": "site", "pack": "Pre-Launch"}',
  ].join("\n"),
  inputSchema: {
    ...runShape,
    confirm: confirmSchema("start the run and spend the credits"),
    idempotency_key: idempotencySchema,
  },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api }) {
    const problem = checkRunInput(args);
    if (problem) return problem;
    if (!isConfirmed(args.confirm)) {
      // Preview: the estimate only. Nothing that could start a run is sent without confirm.
      const estimate = await api.call<RunEstimate>("estimateRun", { body: runBody(args) });
      if (insufficient(estimate)) {
        return okResult(insufficientSummary(estimate), {
          needs_confirmation: false,
          insufficient_credits: true,
          estimate,
          message: `Nothing was started. Tell the user the run needs more AI credits than the balance. ${ADD_CREDITS_HINT}`,
        });
      }
      return confirmationResult(join(estimateLine(estimate), "Nothing was started. Ask the user to confirm."), {
        preview: estimate,
        message: CONFIRM_RUN_AGENTS_MESSAGE,
      });
    }
    try {
      const run = await api.call<Run>("runAgents", {
        body: {
          ...runBody(args),
          confirm: true,
          // Generated once per tool call, so the client's own retries cannot start (and charge) twice.
          idempotency_key: args.idempotency_key ?? randomUUID(),
        },
      });
      return okResult(runSummary(run, "Started run"), asData(run));
    } catch (error) {
      if (isCreditsRefusal(error)) {
        return errorResult({
          code: error.code,
          message: error.message,
          hint: join(error.hint, ADD_CREDITS_HINT),
          candidates: error.candidates,
        });
      }
      throw error;
    }
  },
});

export const getRun = defineTool({
  name: "superflow_get_run",
  title: "Get a run",
  description: [
    "Get an agent run's live status: overall status, each agent's status and findings count, credits charged, and start and finish times. It reads the run live. It also takes the run_ id on an agent comment (one agent's execution), which covers runs started in the Superflow portal.",
    `The run is finished when status is done, failed or partial (partial: some agents did not finish). While it is queued or running, call again no more often than every ${POLL_SECONDS} seconds; a full site run can take several minutes.`,
    "To read what the agents found use superflow_list_findings. To find a run use superflow_list_runs.",
    'Example: {"run": "run_8f3k2"}',
  ].join("\n"),
  inputSchema: { run: runRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const run = await api.call<Run>("getRun", { path: { run: args.run } });
    return okResult(runSummary(run), asData(run));
  },
});

export const listRuns = defineTool({
  name: "superflow_list_runs",
  title: "List runs",
  description: [
    "List agent runs started through the API, this server or a schedule, newest first, with status, findings count and credits. Filter by project, status or start date.",
    'Use it for "the last run" or "runs this week", then read one with superflow_get_run or superflow_list_findings. Statuses here are as last recorded: superflow_get_run reads a run live. Runs started in the Superflow portal are not in this list: their findings carry a run_ id that superflow_get_run reads.',
    'Example: {"project": "Acme Dental", "status": ["done", "partial"], "limit": 5}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema.optional().describe("Only this project's runs (name, site URL or id)."),
    status: z
      .array(z.enum(RUN_STATUSES))
      .min(1)
      .optional()
      .describe("Only runs with these statuses: queued, running, done, failed or partial. done, failed and partial are finished."),
    since: dateSchema("Only runs started at or after."),
    limit: limitSchema,
    cursor: cursorSchema,
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    if (args.since !== undefined && !isValidDateFilter(args.since)) {
      return invalidInput(`since "${args.since}" is not a date Superflow understands. ${DATE_HELP}`);
    }
    const list = await api.call<ListEnvelope<Run>>("listRuns", {
      query: { project: args.project, status: args.status, since: args.since, limit: args.limit, cursor: args.cursor },
    });
    const items = list.items ?? [];
    const latest = items[0];
    return okResult(
      join(
        `Found ${plural(items.length, "run")}.`,
        latest && `Latest: ${runSummary(latest)}`,
        paginationNote(list),
      ),
      asData(list),
    );
  },
});

/** "critical 2, high 5, none 1" from the findings on this page. */
function severityCounts(items: readonly Finding[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.severity ?? "none";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `${key} ${n}`)
    .join(", ");
}

export const listFindings = defineTool({
  name: "superflow_list_findings",
  title: "List a run's findings",
  description: [
    "List what an agent run found: the comments its agents left, with each finding's severity and confidence, page and link. Filter by severity. Pages with cursor.",
    "Use it after superflow_get_run says the run is done or partial, to summarize, triage or push findings to a tracker. Findings are comments: resolve, reply or bulk update them with the comment tools.",
    'Example: {"run": "run_8f3k2", "severity": ["critical", "high"]}',
  ].join("\n"),
  inputSchema: {
    run: runRefSchema,
    severity: z
      .array(z.enum(FINDING_SEVERITIES))
      .min(1)
      .optional()
      .describe("Only these severities: critical, high, medium, low or info."),
    limit: limitSchema,
    cursor: cursorSchema,
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = await api.call<ListEnvelope<Finding>>("listRunFindings", {
      path: { run: args.run },
      query: { severity: args.severity, limit: args.limit, cursor: args.cursor },
    });
    const items = list.items ?? [];
    const head =
      typeof list.total === "number"
        ? `Run ${args.run} has ${plural(list.total, "finding")}${args.severity ? ` with severity ${args.severity.join(", ")}` : ""}.`
        : `Found ${plural(items.length, "finding")} from run ${args.run}${args.severity ? ` with severity ${args.severity.join(", ")}` : ""}.`;
    return okResult(
      join(head, items.length > 0 && `By severity: ${severityCounts(items)}.`, paginationNote(list), scanNote(list.scan)),
      asData(list),
    );
  },
});

export const runTools = [estimateRun, runAgents, getRun, listRuns, listFindings];
