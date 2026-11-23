// Site settings (spec addendum "Settings tools"): the monitoring mode (care or watch), the time
// zone scheduled checks run in, and the Forms agent's tests. Each goes through the same service
// the portal's settings screens call, so the two never disagree.
// Site Care runs (plans/care-check-api.md flow 7): start a check now, read a run's fix-ready
// result, and set the webhook the same result is POSTed to.
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type { ApiClient } from "../client/api.ts";
import type { FormList, SiteCareFailingCheck, SiteCareRun, SiteCareRunStarted, SiteForm, SiteMonitoring, UpdatedForm } from "../client/types.ts";
import {
  CONFIRM_FORM_TEST_CHANGE_MESSAGE,
  CONFIRM_FORM_TEST_MESSAGE,
  CONFIRM_SITE_CARE_CHANGE_MESSAGE,
  CONFIRM_SITE_CARE_MESSAGE,
  isConfirmed,
} from "../lib/confirm.ts";
import { MAX_TEXT_CHARS, confirmationResult, errorResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { findOne } from "../lib/match.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, join } from "./helpers.ts";
import { POLL_SECONDS } from "./runs.ts";
import { confirmSchema, projectRefSchema } from "./schemas.ts";

export const SITE_MODES = ["care", "watch"] as const;
export const SITE_CADENCES = ["daily", "weekly", "off"] as const;

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe("An IANA time zone name, for example America/Los_Angeles or Europe/London. Not an abbreviation like PST.");

const cadenceSchema = z
  .enum(SITE_CADENCES)
  .describe("How often monitoring runs the agents: daily, weekly, or off (no scheduled runs; deploys and manual checks still run).");

/** The host of a webhook address, for summaries (the full address stays in the JSON). */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "its address";
  }
}

/** Where a site's finished runs go and what starts one besides the schedule. "" when none is set. */
function reportsLine(site: SiteMonitoring): string {
  const channel = site.slack_report?.channel?.replace(/^#/, "");
  const hook = site.check_hook;
  return join(
    site.deploy_link && `Deploys of the ${site.deploy_link.provider === "vercel" ? "Vercel project" : "GitHub repository"} ${site.deploy_link.project} start a check.`,
    hook?.on && `A check trigger URL is set${hook.last_used_at ? `, last used ${hook.last_used_at.slice(0, 10)}` : ", not used yet"}.`,
    site.webhook_report && `Each finished run is POSTed to ${hostOf(site.webhook_report.url)} (${site.webhook_report.version === 2 ? "the detailed result" : "the summary"}).`,
    channel && `Each finished run is posted to Slack #${channel}.`,
  );
}

function monitoringLine(site: SiteMonitoring): string {
  const name = site.project?.name ?? site.project?.id ?? "The site";
  if (site.mode === "care") {
    return join(
      `${name} is in care: Superflow runs ${plural(site.agents?.length ?? 0, "agent")} ${site.cadence === "off" ? "on deploys and manual checks only" : site.cadence ?? "on a schedule"}${site.timezone ? ` (${site.timezone})` : ""}.`,
      site.active_run && `A check is running (version ${site.active_run.version}, ${site.active_run.status}).`,
      site.score !== null && site.score !== undefined && `Score ${site.score}.`,
      site.last_run_at && `Last run ${site.last_run_at.slice(0, 10)}${site.last_run_status ? ` (${site.last_run_status})` : ""}.`,
      reportsLine(site),
    );
  }
  const history = site.version_history?.enabled
    ? `Version history captures the site ${site.version_history.frequency ?? "on a schedule"}${site.version_history.timezone ? ` (${site.version_history.timezone})` : ""}.`
    : "Version history is off.";
  return join(`${name} is in watch: no agents run on a schedule. ${history}`, reportsLine(site));
}

function formLabel(form: SiteForm): string {
  return `${form.selector || form.id} on ${form.page_url}`;
}

function formLine(form: SiteForm): string {
  const state = form.test_enabled ? `testing ${form.daily_test ? "daily" : "on each scan"}` : "not tested";
  const result = form.missing_since ? "missing from its page, tests paused" : form.last_result ?? form.delivery_note ?? "no result yet";
  return `${formLabel(form)} (${form.id}): ${state}, ${result}.`;
}

async function findForm(api: ApiClient, project: string, ref: string): Promise<{ list: FormList; form: SiteForm }> {
  const list = await api.call<FormList>("listForms", { path: { project } });
  const form = findOne(list.data.map((item) => ({ ...item, name: item.page_url })), ref, {
    prefix: "",
    noun: "form",
    where: `project "${list.project?.name ?? project}"`,
    notFoundHint: "List the site's forms with superflow_list_forms and pass a form id.",
  });
  return { list, form };
}

export const getSiteMonitoring = defineTool({
  name: "superflow_get_site_monitoring",
  title: "Get a site's monitoring mode",
  description: [
    "Whether a site is in care (Superflow runs the agents on a schedule) or watch (Version history only, no agent runs), with the cadence, the time zone, the agents, the last run and the Version history schedule.",
    "It also says where each finished Site Care run goes and what starts one: webhook_report (the address and format, 2 is the detailed result), slack_report (the channel), deploy_link (the Vercel project or GitHub repository whose deploys start a check) and check_hook (whether a check trigger URL exists and when it was last used; the URL itself is shown once in Superflow and never here).",
    "Use it before changing the mode, cadence or time zone. To change them use superflow_set_site_mode or superflow_set_site_timezone; to set the webhook use superflow_set_site_webhook; to start a check now use superflow_run_site_care.",
    'Example: {"project": "dental-smiles.com"}',
  ].join("\n"),
  inputSchema: { project: projectRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const site = await api.call<SiteMonitoring>("getSiteMonitoring", { path: { project: args.project } });
    return okResult(monitoringLine(site), asData(site), { untrusted: false });
  },
});

export const setSiteMode = defineTool({
  name: "superflow_set_site_mode",
  title: "Set a site's monitoring mode",
  description: [
    "Move a site between care and watch. care: Superflow runs the agents on a schedule (daily unless cadence says otherwise), and each run spends AI credits; on a site never monitored it also starts a full check now. watch: no agent runs, Version history keeps capturing.",
    "Without confirm: true nothing changes when mode is care: a site not in care shows its current settings as a preview, a site already in care shows a new cadence or time zone as a preview, and the same settings again change nothing and say so. Call again with confirm: true only after the user says yes. watch needs no confirm. Turning care on needs a key with the agents:run scope.",
    "To change only the cadence of a site in care, pass mode: care with cadence. For the time zone use superflow_set_site_timezone.",
    'Example: {"project": "dental-smiles.com", "mode": "care", "cadence": "weekly"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    mode: z.enum(SITE_MODES).describe("care (agents run on a schedule, spending credits) or watch (Version history only)."),
    cadence: cadenceSchema.optional(),
    timezone: timezoneSchema.optional(),
    confirm: confirmSchema("turn care on, which runs agents and spends AI credits"),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const { project, mode } = args;
    if (mode === "care" && !isConfirmed(args.confirm)) {
      const current = await api.call<SiteMonitoring>("getSiteMonitoring", { path: { project } });
      if (current.mode !== "care") {
        return confirmationResult(
          `${monitoringLine(current)} Turning care on runs the agents ${args.cadence ?? (current.cadence && current.cadence !== "off" ? current.cadence : "daily")} and spends AI credits${current.monitored ? "" : ", starting with a full check now"}. Nothing was changed. Ask the user to confirm.`,
          { preview: current, message: CONFIRM_SITE_CARE_MESSAGE },
        );
      }
      // Already in care. The API's care write needs confirm: true, and only the user gives it:
      // a new cadence or time zone is a preview, the same settings are a no-op.
      const changes = [
        args.cadence !== undefined && args.cadence !== current.cadence && `cadence (${current.cadence ?? "none"} to ${args.cadence})`,
        args.timezone !== undefined && args.timezone !== current.timezone && `time zone (${current.timezone ?? "none"} to ${args.timezone})`,
      ].filter((change): change is string => typeof change === "string");
      if (changes.length === 0) {
        return okResult(`${monitoringLine(current)} It is already in care, so nothing changed.`, { changed: false, site: current }, { untrusted: false });
      }
      return confirmationResult(
        `${monitoringLine(current)} Changing the ${changes.join(" and the ")} changes when or how often the agents run and spend AI credits. Nothing was changed. Ask the user to confirm.`,
        { preview: current, message: CONFIRM_SITE_CARE_CHANGE_MESSAGE },
      );
    }
    // The API gates care server-side too (409 needs_confirmation without it): by here mode is
    // watch, or the user confirmed care, so only a confirmed care call carries confirm: true.
    const site = await api.call<SiteMonitoring>("updateSiteMonitoring", {
      path: { project },
      body: compact({ mode, cadence: args.cadence, timezone: args.timezone, confirm: mode === "care" ? true : undefined }),
    });
    return okResult(
      join(monitoringLine(site), site.first_run && `First full check started (version ${site.first_run.version}). Follow it with superflow_get_site_score.`),
      asData(site),
      { untrusted: false },
    );
  },
});

export const setSiteTimezone = defineTool({
  name: "superflow_set_site_timezone",
  title: "Set a site's time zone",
  description: [
    "Set the time zone a site's scheduled checks and Version history captures run in (they run at the same local hour). Works in care and in watch; a site with neither monitoring nor Version history has no schedule to move.",
    "Use it when the user says when their day starts or where the client is. For care or watch use superflow_set_site_mode.",
    'Example: {"project": "dental-smiles.com", "timezone": "America/Chicago"}',
  ].join("\n"),
  inputSchema: { project: projectRefSchema, timezone: timezoneSchema },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const site = await api.call<SiteMonitoring>("updateSiteMonitoring", { path: { project: args.project }, body: { timezone: args.timezone } });
    return okResult(`Time zone of ${site.project?.name ?? args.project} set to ${args.timezone}. ${monitoringLine(site)}`, asData(site), { untrusted: false });
  },
});

export const listForms = defineTool({
  name: "superflow_list_forms",
  title: "List a site's forms",
  description: [
    "The forms the Forms agent found on a site, with whether each is tested, how often, and the last result.",
    "Use it before superflow_set_form_testing, or when the user asks whether a site's forms work.",
    'Example: {"project": "dental-smiles.com"}',
  ].join("\n"),
  inputSchema: { project: projectRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = await api.call<FormList>("listForms", { path: { project: args.project } });
    const name = list.project?.name ?? args.project;
    return okResult(
      join(list.data.length ? `${plural(list.data.length, "form")} on ${name}.` : `No forms found on ${name} yet.`, ...list.data.map(formLine)),
      asData(list),
      { untrusted: false },
    );
  },
});

export const setFormTesting = defineTool({
  name: "superflow_set_form_testing",
  title: "Turn a form's test on or off",
  description: [
    "Turn the Forms agent's test of one form on or off. A test submits the form for real, so each one lands in the client's inbox as a lead.",
    "Without confirm: true nothing changes while enabled is true: a form not tested yet, or a new daily_test, comes back as a preview to show the user, and a form already tested that way changes nothing and says so. Call again with confirm: true only after the user says yes to the test leads. Turning it off needs no confirm.",
    "Find the form with superflow_list_forms.",
    'Example: {"project": "dental-smiles.com", "form": "frm_contact", "enabled": true}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    form: z.string().min(1).max(500).describe("The form id from superflow_list_forms, or the page URL when the page has one form."),
    enabled: z.boolean().describe("true to test the form, false to stop."),
    daily_test: z.boolean().optional().describe("Test every day, not only on each scan."),
    confirm: confirmSchema("turn the test on, accepting that each test lands in the client's inbox as a lead"),
  },
  annotations: hints(false, false, true, true),
  write: true,
  async run(args, { api }) {
    const { project } = args;
    const { form } = await findForm(api, project, args.form);
    if (args.enabled && !isConfirmed(args.confirm)) {
      if (!form.test_enabled) {
        return confirmationResult(
          `${formLabel(form)} is not tested. Testing it submits the form ${args.daily_test ? "every day" : "on each scan"}, and each test lands in the client's inbox as a lead. Nothing was changed. Ask the user to confirm.`,
          { preview: form, message: CONFIRM_FORM_TEST_MESSAGE },
        );
      }
      // Already tested. Turning it on sends accept_test_leads, which only the user's confirm gives:
      // a new daily_test is a preview, the same settings are a no-op.
      const now = form.daily_test ? "daily" : "on each scan";
      if (args.daily_test === undefined || args.daily_test === form.daily_test) {
        return okResult(`${formLabel(form)} is already tested ${now}, so nothing changed.`, { changed: false, form }, { untrusted: false });
      }
      return confirmationResult(
        `${formLabel(form)} is tested ${now}. Testing it ${args.daily_test ? "daily" : "on each scan"} instead changes how often a test lead lands in the client's inbox. Nothing was changed. Ask the user to confirm.`,
        { preview: form, message: CONFIRM_FORM_TEST_CHANGE_MESSAGE },
      );
    }
    // By here the test is being turned off, or the user confirmed turning it on.
    const body = compact({ test_enabled: args.enabled, daily_test: args.daily_test, accept_test_leads: args.enabled ? true : undefined });
    const result = await api.call<UpdatedForm>("updateFormTest", { path: { project, form: form.id }, body });
    return okResult(
      args.enabled ? `Testing ${formLabel(result.form)}${result.form.daily_test ? " daily" : " on each scan"}.` : `Stopped testing ${formLabel(result.form)}.`,
      asData(result),
      { untrusted: false },
    );
  },
});

/** A Site Care run is finished in one of these statuses; queued and running are not. */
export const FINISHED_SITE_RUN_STATUSES = ["done", "partial", "failed", "skipped", "auth_failed"] as const;

/** At most this many Site Care checks start per site in a UTC hour, shared with superflow_run_agents. */
export const SITE_CARE_RUNS_PER_HOUR = 10;

const SITE_RUN_POLL_NOTE = `Read it again with superflow_get_site_care_run in ${POLL_SECONDS} seconds or more; it is finished when the status is ${FINISHED_SITE_RUN_STATUSES.join(", ")}.`;

const FIX_LOOP_NOTE =
  "To fix them: each finding's problem and detail say what is wrong, page_url, element_text and snippet say where, suggested_fix and the check's fix_guide say how. Fix them in the site's code, deploy, start a check with superflow_run_site_care, then read the new run here.";

const labelSchema = (what: string) => z.string().trim().min(1).max(200).optional().describe(what);

const siteRunSchema = z
  .union([z.string().trim().min(1).max(200), z.number().int().positive()])
  .default("latest")
  .describe("Which Site Care run: latest (the default), its number as History shows it, or the run_id superflow_run_site_care returned.");

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function findingCount(checks: readonly SiteCareFailingCheck[]): number {
  return checks.reduce((sum, check) => sum + (check.findings?.length ?? 0), 0);
}

function checkLine(check: SiteCareFailingCheck): string {
  return `${check.severity} ${check.title} (${check.rule_key ?? "no rule key"}, ${plural(check.findings?.length ?? 0, "finding")})`;
}

/** One summary of a Site Care run result, for a model to act on. */
export function siteRunSummary(result: SiteCareRun, onlyRule?: string): string {
  const run = result.run ?? ({} as Partial<SiteCareRun["run"]>);
  const name = result.site?.name ?? result.site?.project_id ?? "the site";
  const status = run.status ?? "unknown";
  const head = `Site Care run ${run.number ?? "?"}${run.id ? ` (${run.id})` : ""} on ${name}${run.trigger ? `, trigger ${run.trigger}` : ""}${run.source?.ref ? `, ref ${run.source.ref}` : ""}: ${status}${run.reason ? ` (${run.reason})` : ""}.`;
  if (!(FINISHED_SITE_RUN_STATUSES as readonly string[]).includes(status)) return join(head, "No findings yet.", SITE_RUN_POLL_NOTE);
  const checks = result.failing_checks ?? [];
  const findings = findingCount(checks);
  const total = onlyRule ? checks.length : result.failing_check_count ?? checks.length;
  return join(
    head,
    run.reason === "no_changes" && "No page changed since the last check, so nothing was checked.",
    typeof run.pages_checked === "number" && run.reason !== "no_changes" && `Checked ${plural(run.pages_checked, "page")}${typeof run.pages_tracked === "number" ? ` of ${run.pages_tracked}` : ""}.`,
    typeof result.score === "number" && `Score ${result.score}.`,
    total === 0
      ? onlyRule
        ? `Check ${onlyRule} is not failing in this run.`
        : status === "done" || status === "partial"
          ? "No failing checks."
          : "No findings."
      : `${plural(total, "failing check")}, ${plural(findings, "finding")} listed: ${checks.slice(0, 5).map(checkLine).join("; ")}${checks.length > 5 ? "; and more in failing_checks" : ""}.`,
    result.checks_state !== undefined && result.checks_state !== "listed" && "These checks are grouped from the run's findings and not settled yet: read the run again later for the listed form.",
    result.findings_state === "capped" && "More findings exist than listed (at most 10 a check, 100 in all): fix these first, or read a check's full list with superflow_get_check_details and its rule_key.",
    findings > 0 && FIX_LOOP_NOTE,
  );
}

/**
 * Keeps the result under the text cap: snippet and box are the bulk of a finding, so they go first,
 * and the summary says how to see them (one check at a time).
 */
function fitSiteRun(result: SiteCareRun): { result: SiteCareRun; trimmed: boolean } {
  if (JSON.stringify(result, null, 2).length <= MAX_TEXT_CHARS - 2_000) return { result, trimmed: false };
  const failing_checks = (result.failing_checks ?? []).map((check) => ({
    ...check,
    findings: (check.findings ?? []).map(({ snippet: _snippet, box: _box, ...finding }) => finding),
  }));
  return { result: { ...result, failing_checks }, trimmed: true };
}

export const runSiteCare = defineTool({
  name: "superflow_run_site_care",
  title: "Start a Site Care check",
  description: [
    "Start a Site Care check of a site now: the pages changed since the last check go to the site's agents, exactly like a deploy run, and the run's result lists each failing check with what is wrong, where and how to fix it. The site must be in care (see superflow_set_site_mode). It spends AI credits on the changed pages only, none when nothing changed.",
    `The fix loop: read the result with superflow_get_site_care_run, fix the findings in the site's code, deploy, call this tool, then read the new run with superflow_get_site_care_run no more often than every ${POLL_SECONDS} seconds until it is finished. Repeat until no check fails.`,
    `One check at a time: while a run is still going this refuses with run_active and the run's active_run_id; read that run instead of starting another. At most ${SITE_CARE_RUNS_PER_HOUR} checks an hour per site, shared with superflow_run_agents; past that it refuses with rate_limited and reset_at, so do not retry before then.`,
    "ref and url are your own labels (a commit, a deploy address), echoed in the result and never fetched. To run chosen agents on chosen pages use superflow_run_agents instead.",
    'Example: {"project": "dental-smiles.com", "ref": "a1b2c3d"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    ref: labelSchema("Your label for what changed, such as a commit or deploy id, at most 200 characters. Stored on the run and echoed in its result, never read."),
    url: labelSchema("An https label, such as the deploy's address, at most 200 characters. Echoed in the result, never fetched."),
  },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api }) {
    if (args.url !== undefined && !isHttps(args.url)) return invalidInput(`url must be an https address, got "${args.url}".`, "Leave url out, or pass the deploy's https address.");
    try {
      const started = await api.call<SiteCareRunStarted>("runSiteCare", { path: { project: args.project }, body: compact({ ref: args.ref, url: args.url }) });
      const name = started.project?.name ?? started.project?.id ?? args.project;
      return okResult(
        join(
          `Started Site Care run ${started.number ?? "?"} (${started.run_id}) on ${name}: ${started.status ?? "queued"}. The pages changed since the last check go to its agents.`,
          `Read the result with superflow_get_site_care_run (site_run "${started.run_id}") in ${POLL_SECONDS} seconds or more.`,
        ),
        asData(started),
        { untrusted: false },
      );
    } catch (error) {
      if (error instanceof SuperflowApiError && error.code === "run_active") {
        return errorResult(
          new SuperflowApiError({
            status: error.status,
            code: error.code,
            message: error.message,
            hint: error.activeRunId
              ? `Nothing was started. Read the running check with superflow_get_site_care_run (site_run "${error.activeRunId}") no more often than every ${POLL_SECONDS} seconds, and start a new one once it is finished if you still need it.`
              : `Nothing was started. Read the running check with superflow_get_site_care_run (site_run "latest"), and start a new one once it is finished if you still need it.`,
            candidates: error.candidates,
            ...(error.activeRunId ? { activeRunId: error.activeRunId } : {}),
          }),
        );
      }
      if (error instanceof SuperflowApiError && error.code === "rate_limited" && error.resetAt) {
        return errorResult(
          new SuperflowApiError({
            status: error.status,
            code: error.code,
            message: error.message,
            hint: join(`A site starts at most ${SITE_CARE_RUNS_PER_HOUR} checks an hour, shared with superflow_run_agents.`, error.hint),
            candidates: error.candidates,
            resetAt: error.resetAt,
          }),
        );
      }
      throw error;
    }
  },
});

export const getSiteCareRun = defineTool({
  name: "superflow_get_site_care_run",
  title: "Get a Site Care run's result",
  description: [
    "Read one Site Care run's result: its status, score and pages checked, then each failing check (rule_key, title, severity, fix_guide) with up to 10 findings. Each finding says what is wrong (problem, detail), where (page_url, path, element_text, snippet, box) and how to fix it (suggested_fix). It is the same body the detailed (version 2) webhook sends.",
    `Use it after superflow_run_site_care, and on a run a deploy or the schedule started (site_run latest). A run still queued or running has no findings yet: read again no more often than every ${POLL_SECONDS} seconds until the status is done, partial, failed, skipped or auth_failed. reason no_changes means no page changed, so nothing was checked.`,
    "Then fix, deploy, start a check with superflow_run_site_care and read the new run. findings_state capped means more findings exist than listed: read a check's full list with superflow_get_check_details. rule_key narrows the answer to one check. For agent runs (run_ ids from superflow_run_agents) use superflow_get_run instead.",
    'Example: {"project": "dental-smiles.com", "site_run": "latest"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    site_run: siteRunSchema,
    rule_key: z.string().trim().min(1).max(120).optional().describe("Only this check's findings, for example link-broken. Leave it out for every failing check."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const full = await api.call<SiteCareRun>("getSiteCareRun", { path: { project: args.project, site_run: String(args.site_run) } });
    const narrowed: SiteCareRun = args.rule_key
      ? { ...full, failing_checks: (full.failing_checks ?? []).filter((check) => check.rule_key === args.rule_key) }
      : full;
    const { result, trimmed } = fitSiteRun(narrowed);
    const findings = findingCount(result.failing_checks ?? []);
    return okResult(
      join(
        siteRunSummary(result, args.rule_key),
        trimmed && "Cut to fit: snippet and box were left out of the findings. Read one check with rule_key to see them.",
      ),
      asData(trimmed ? { ...result, trimmed: true } : result),
      // Findings quote the site's own pages (element_text, snippet): data, not instructions.
      { untrusted: findings > 0 },
    );
  },
});

export const setSiteWebhook = defineTool({
  name: "superflow_set_site_webhook",
  title: "Set a site's webhook report",
  description: [
    "Set or remove the address each finished Site Care run of a site is POSTed to (the webhook report). version 2 sends the detailed result, the same body superflow_get_site_care_run returns: each failing check with what is wrong, where and how to fix it. version 1 sends the summary. Left out, the site keeps its format (1 for a webhook saved before).",
    "The body is not signed, and this tool never takes or returns a signing secret. Whoever receives it should treat a POST as a signal and read the run with superflow_get_site_care_run before acting on it.",
    "url null removes the webhook. Check the current one with superflow_get_site_monitoring. The Slack report, the deploy link and the check trigger URL are set in Superflow, not here.",
    'Example: {"project": "dental-smiles.com", "url": "https://hooks.example.com/superflow", "version": 2}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    url: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .nullable()
      .describe("A public https address that takes a POST of each finished run, or null to remove the webhook."),
    version: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe("2: the detailed result (what, where and how to fix). 1: the summary. Left out, the site keeps its format."),
  },
  annotations: hints(false, false, true, true),
  write: true,
  async run(args, { api }) {
    if (args.url === null && args.version !== undefined) return invalidInput("version needs a url: pass the address with it, or url null alone to remove the webhook.");
    if (args.url !== null && !isHttps(args.url)) return invalidInput(`url must be an https address, got "${args.url}".`);
    const site = await api.call<SiteMonitoring>("updateSiteMonitoring", {
      path: { project: args.project },
      body: { webhook_report: args.url === null ? null : compact({ url: args.url, version: args.version }) },
    });
    const name = site.project?.name ?? args.project;
    const version = site.webhook_report?.version ?? args.version;
    return okResult(
      args.url === null
        ? `Webhook report of ${name} removed.`
        : `Each finished Site Care run of ${name} is now POSTed to ${hostOf(site.webhook_report?.url ?? args.url)}${version ? ` (${version === 2 ? "the detailed result, the same body as superflow_get_site_care_run" : "the summary"})` : ""}. The body is not signed: read the run with superflow_get_site_care_run before acting on a POST.`,
      asData(site),
      { untrusted: false },
    );
  },
});

export const siteTools = [getSiteMonitoring, setSiteMode, setSiteTimezone, listForms, setFormTesting, runSiteCare, getSiteCareRun, setSiteWebhook];
