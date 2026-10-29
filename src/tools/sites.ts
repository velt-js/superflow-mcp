// Site settings (spec addendum "Settings tools"): the monitoring mode (care or watch), the time
// zone scheduled checks run in, and the Forms agent's tests. Each goes through the same service
// the portal's settings screens call, so the two never disagree.
import { z } from "zod";
import type { ApiClient } from "../client/api.ts";
import type { FormList, SiteForm, SiteMonitoring, UpdatedForm } from "../client/types.ts";
import { CONFIRM_FORM_TEST_MESSAGE, CONFIRM_SITE_CARE_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, okResult, plural } from "../lib/format.ts";
import { findOne } from "../lib/match.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, join } from "./helpers.ts";
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

function monitoringLine(site: SiteMonitoring): string {
  const name = site.project?.name ?? site.project?.id ?? "The site";
  if (site.mode === "care") {
    return join(
      `${name} is in care: Superflow runs ${plural(site.agents.length, "agent")} ${site.cadence === "off" ? "on deploys and manual checks only" : site.cadence ?? "on a schedule"}${site.timezone ? ` (${site.timezone})` : ""}.`,
      site.active_run && `A check is running (version ${site.active_run.version}, ${site.active_run.status}).`,
      site.score !== null && `Score ${site.score}.`,
      site.last_run_at && `Last run ${site.last_run_at.slice(0, 10)}${site.last_run_status ? ` (${site.last_run_status})` : ""}.`,
    );
  }
  const history = site.version_history.enabled
    ? `Version history captures the site ${site.version_history.frequency ?? "on a schedule"}${site.version_history.timezone ? ` (${site.version_history.timezone})` : ""}.`
    : "Version history is off.";
  return `${name} is in watch: no agents run on a schedule. ${history}`;
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
    "Use it before changing the mode, cadence or time zone. To change them use superflow_set_site_mode or superflow_set_site_timezone.",
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
    "Turning care on: Without confirm: true nothing changes and you get the current settings to show the user. Call again with confirm: true only after the user says yes. watch, and a site already in care, need no confirm. Turning care on needs a key with the agents:run scope.",
    "To change only the cadence of a site in care, pass mode: care with cadence. For the time zone use superflow_set_site_timezone.",
    'Example: {"project": "dental-smiles.com", "mode": "care", "cadence": "weekly", "confirm": true}',
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
    }
    const site = await api.call<SiteMonitoring>("updateSiteMonitoring", { path: { project }, body: compact({ mode, cadence: args.cadence, timezone: args.timezone }) });
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
    "Turning it on: Without confirm: true nothing changes and you get the form to show the user. Call again with confirm: true only after the user says yes to the test leads. Turning it off needs no confirm.",
    "Find the form with superflow_list_forms.",
    'Example: {"project": "dental-smiles.com", "form": "frm_contact", "enabled": true, "confirm": true}',
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
    if (args.enabled && !form.test_enabled && !isConfirmed(args.confirm)) {
      return confirmationResult(
        `${formLabel(form)} is not tested. Testing it submits the form ${args.daily_test ? "every day" : "on each scan"}, and each test lands in the client's inbox as a lead. Nothing was changed. Ask the user to confirm.`,
        { preview: form, message: CONFIRM_FORM_TEST_MESSAGE },
      );
    }
    const body = compact({ test_enabled: args.enabled, daily_test: args.daily_test, accept_test_leads: args.enabled ? true : undefined });
    const result = await api.call<UpdatedForm>("updateFormTest", { path: { project, form: form.id }, body });
    return okResult(
      args.enabled ? `Testing ${formLabel(result.form)}${result.form.daily_test ? " daily" : " on each scan"}.` : `Stopped testing ${formLabel(result.form)}.`,
      asData(result),
      { untrusted: false },
    );
  },
});

export const siteTools = [getSiteMonitoring, setSiteMode, setSiteTimezone, listForms, setFormTesting];
