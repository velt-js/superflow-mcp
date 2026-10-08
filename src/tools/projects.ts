// Project admin tools: get, create, update, archive, unarchive, delete, install snippet, verify.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  CreatedProject,
  DeleteProjectResponse,
  InstallSnippet,
  ListEnvelope,
  Page,
  Project,
  ProjectChangeResponse,
  VerifyInstallResponse,
} from "../client/types.ts";
import { CONFIRM_DELETE_PROJECT_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, count, join, nameList } from "./helpers.ts";
import {
  confirmSchema,
  idempotencySchema,
  inviteEmailsSchema,
  platformSchema,
  projectRefSchema,
} from "./schemas.ts";

const INSTALL_LABELS: Record<string, string> = {
  not_installed: "not installed",
  installed: "installed",
  verified: "installed and verified",
};

function installLabel(project: Project): string {
  const status = project.install?.status ?? project.install_status;
  return INSTALL_LABELS[status] ?? status ?? "unknown install status";
}

/** The settings worth a mention: guest comments either way, and anything switched off. */
function settingsNotes(project: Project): string[] {
  const settings = project.settings;
  if (!settings) return [];
  const notes: string[] = [];
  if (typeof settings.guest_comments === "boolean") notes.push(settings.guest_comments ? "guest comments on" : "guest comments off");
  if (settings.comments_disabled === true) notes.push("commenting turned off");
  if (settings.toolbar_enabled === false) notes.push("toolbar hidden");
  return notes;
}

/** One-line project summary for get, create and update. */
export function projectSummary(project: Project, lead = "Project"): string {
  const site = project.site_url ? ` (${project.site_url})` : "";
  const counts =
    typeof project.total_comment_count === "number"
      ? `${count(project.open_comment_count)} open of ${count(project.total_comment_count)} comments`
      : `${count(project.open_comment_count)} open comments`;
  const people =
    typeof project.member_count === "number" || typeof project.guest_count === "number"
      ? `, ${plural(project.member_count ?? 0, "member")} and ${plural(project.guest_count ?? 0, "guest")}`
      : "";
  const settings = settingsNotes(project);
  return join(
    `${lead} ${project.name}${site}: ${installLabel(project)}, ${project.platform ?? "other"}${project.archived ? ", archived" : ""}, ${counts}${people}.`,
    settings.length > 0 && `Settings: ${settings.join(", ")}.`,
    project.url && `Link: ${project.url}`,
  );
}

export const getProject = defineTool({
  name: "superflow_get_project",
  title: "Get a project",
  description: [
    "Get one project with everything about it: site URL, platform, install status and how it was verified, comment counts, member and guest counts, statuses, and its settings (guest comments, guest sign-in, commenting off, toolbar on, query strings as pages).",
    "Use it to check a project's setup or install state, or before changing its settings with superflow_update_project.",
    "To find a project by name or see them all use superflow_list_projects. For its pages use superflow_list_pages.",
    'Example: {"project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: { project: projectRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const project = await api.call<Project>("getProject", { path: { project: args.project } });
    return okResult(projectSummary(project), asData(project));
  },
});

export const createProject = defineTool({
  name: "superflow_create_project",
  title: "Create a project",
  description: [
    "Create a Superflow project for a website. You become a member of it, the same as creating it in the portal. Optionally invite guests (clients, reviewers) in the same call: each guest gets a real invite email, and that needs the users:invite scope.",
    "Use it when the user wants to start collecting feedback on a new site. If a project for that domain already exists, you get an ambiguous error with the existing project as the candidate: use that project instead of creating another.",
    "Next, get the script tag with superflow_get_install_snippet. Ask the user before creating a project or inviting anyone.",
    'Example: {"name": "Acme Dental", "site_url": "https://acme.com", "platform": "webflow", "guests": ["dana@acme.com"]}',
  ].join("\n"),
  inputSchema: {
    name: z.string().min(1).describe("Project name, usually the client or the site's name."),
    site_url: z
      .string()
      .min(1)
      .describe("The site's URL or domain, for example https://acme.com. One project per domain, and it cannot change later."),
    platform: platformSchema.describe(
      "What the site is built with, for the install steps: webflow, shopify, wordpress, framer, html, netlify, nextjs, vercel or other. Default other.",
    ),
    guests: inviteEmailsSchema("Guests to invite to the new project").optional(),
    copy_settings_from: projectRefSchema
      .optional()
      .describe("An existing project (name, site URL or id) whose settings, access and project statuses to copy."),
    idempotency_key: idempotencySchema,
  },
  annotations: hints(false, false, false, false),
  write: true,
  async run(args, { api }) {
    const project = await api.call<CreatedProject>("createProject", {
      body: compact({
        name: args.name,
        site_url: args.site_url,
        platform: args.platform,
        guests: args.guests,
        copy_settings_from: args.copy_settings_from,
        // Generated once per tool call, so the client's own retries cannot create two projects.
        idempotency_key: args.idempotency_key ?? randomUUID(),
      }),
    });
    const invites = project.guest_invites ?? [];
    const failed = invites.filter((invite) => !invite.sent).map((invite) => invite.email);
    const sent = invites.length - failed.length;
    const summary = join(
      `Created project ${project.name ?? args.name} for ${project.site_url ?? args.site_url} (${project.id}).`,
      invites.length > 0 && `Invited ${plural(sent, "guest")}.`,
      failed.length > 0 && `The invite email could not be sent to ${nameList(failed)}. Tell the user so they can let those people know.`,
      "Next: get the script tag with superflow_get_install_snippet.",
      project.url && `Link: ${project.url}`,
    );
    return okResult(summary, asData(project));
  },
});

const settingsSchema = z
  .object({
    guest_comments: z
      .boolean()
      .optional()
      .describe("true: guests can see and add comments (the project is public). false: login required, only your team. Needs a plan with guest mode."),
    guest_sign_in: z
      .boolean()
      .optional()
      .describe("true: guests can comment without signing in. Only matters when guest_comments is true."),
    comments_disabled: z.boolean().optional().describe("true: nobody can add comments on the site. false: commenting is on."),
    toolbar_enabled: z.boolean().optional().describe("false: hide the Superflow toolbar on the site. true: show it."),
    query_params_as_pages: z
      .boolean()
      .optional()
      .describe("true: URLs that differ only by query string (?plan=pro) count as different pages."),
  })
  .describe("Settings to change. Only the fields you give change.");

export const updateProject = defineTool({
  name: "superflow_update_project",
  title: "Update a project",
  description: [
    "Change a project: rename it, change its settings (guest comments, guest sign-in, turn commenting off, show or hide the toolbar, query strings as pages), or add extra domains.",
    "The site URL cannot change because a project is tied to its domain: create a new project for a different domain, or add hosts like a staging site with add_domains.",
    "Guest comments need a plan with guest mode. Projects still in preview cannot be changed. To archive use superflow_archive_project. Ask the user before changing settings.",
    'Example: {"project": "Acme Dental", "settings": {"guest_comments": true, "guest_sign_in": false}, "add_domains": ["staging.acme.com"]}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    name: z.string().min(1).optional().describe("New project name."),
    settings: settingsSchema.optional(),
    add_domains: z
      .array(z.string().min(1))
      .min(1)
      .max(10)
      .optional()
      .describe("Extra domains or URLs where the project's toolbar may run, for example staging.acme.com. Added to the existing ones."),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const settings = args.settings ? compact(args.settings) : {};
    const hasSettings = Object.keys(settings).length > 0;
    if (args.name === undefined && !hasSettings && args.add_domains === undefined) {
      return invalidInput(
        "Nothing to change. Give name, settings or add_domains.",
        "The site URL cannot change: create a new project for a different domain, or use add_domains.",
      );
    }
    const project = await api.call<Project>("updateProject", {
      path: { project: args.project },
      body: compact({ name: args.name, settings: hasSettings ? settings : undefined, add_domains: args.add_domains }),
    });
    return okResult(projectSummary(project, "Updated. Project"), asData(project));
  },
});

function archiveTool(kind: "archive" | "unarchive") {
  const archive = kind === "archive";
  return defineTool({
    name: archive ? "superflow_archive_project" : "superflow_unarchive_project",
    title: archive ? "Archive a project" : "Unarchive a project",
    description: (archive
      ? [
          "Archive a project to take it out of the active project list. Nothing is deleted: pages, comments, members and guests stay.",
          "Safe to repeat: an archived project is left as it is. Projects still in preview cannot be archived.",
          "Undo with superflow_unarchive_project. To remove a project for good use superflow_delete_project. Ask the user before archiving.",
          'Example: {"project": "Acme Dental"}',
        ]
      : [
          "Bring an archived project back. Its install status comes back too: installed if the snippet was verified before, else not installed.",
          "Safe to repeat: an active project is left as it is. Projects still in preview cannot be changed.",
          "To archive use superflow_archive_project.",
          'Example: {"project": "Acme Dental"}',
        ]
    ).join("\n"),
    inputSchema: { project: projectRefSchema },
    annotations: hints(false, false, true, false),
    write: true,
    async run(args, { api }) {
      const result = await api.call<ProjectChangeResponse>(archive ? "archiveProject" : "unarchiveProject", {
        path: { project: args.project },
        body: {},
      });
      const name = result.project?.name ?? args.project;
      const link = result.project?.url ? ` Link: ${result.project.url}` : "";
      const summary = result.changed
        ? `${archive ? "Archived" : "Unarchived"} project ${name}.${archive ? "" : ` Install status: ${result.project ? installLabel(result.project) : "unknown"}.`}${link}`
        : `Project ${name} was already ${archive ? "archived" : "active"}. Nothing changed.${link}`;
      return okResult(summary, asData(result));
    },
  });
}

export const archiveProject = archiveTool("archive");
export const unarchiveProject = archiveTool("unarchive");

export const deleteProject = defineTool({
  name: "superflow_delete_project",
  title: "Delete a project",
  description: [
    "Permanently delete a project with all its pages and comments. This cannot be undone: unlike a deleted comment, nothing here can be restored.",
    "Without confirm: true nothing is deleted: you get the project with its comment and page counts as a preview to show the user. Call again with confirm: true only after the user says yes.",
    "To hide a project without losing anything use superflow_archive_project instead.",
    'Example: {"project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    confirm: confirmSchema("delete the project"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      const result = await api.call<DeleteProjectResponse>("deleteProject", {
        path: { project: args.project },
        query: { confirm: true },
      });
      return okResult(`Deleted project ${args.project} (${result.id ?? "unknown id"}) permanently.`, asData(result));
    }
    // Preview: reads only. Nothing that could delete is sent without confirm.
    const [project, pages] = await Promise.all([
      api.call<Project>("getProject", { path: { project: args.project } }),
      api.call<ListEnvelope<Page>>("listProjectPages", {
        path: { project: args.project },
        query: { with_counts: false, limit: 100 },
      }),
    ]);
    const listed = pages.items?.length ?? 0;
    const morePages = typeof pages.total !== "number" && Boolean(pages.next_cursor);
    const pageCount = typeof pages.total === "number" ? pages.total : listed;
    const preview = {
      project,
      comment_count: project.total_comment_count ?? null,
      page_count: pageCount,
      ...(morePages ? { page_count_is_minimum: true } : {}),
    };
    const comments = typeof preview.comment_count === "number" ? plural(preview.comment_count, "comment") : "all its comments";
    const pagesText = morePages ? `at least ${plural(pageCount, "page")}` : plural(pageCount, "page");
    return confirmationResult(
      `Project ${project.name ?? args.project}${project.site_url ? ` (${project.site_url})` : ""} would be deleted permanently with ${comments} and ${pagesText}. Nothing was deleted. Ask the user to confirm.${project.url ? ` Link: ${project.url}` : ""}`,
      { preview, message: CONFIRM_DELETE_PROJECT_MESSAGE },
    );
  },
});

export const getInstallSnippet = defineTool({
  name: "superflow_get_install_snippet",
  title: "Get the install snippet",
  description: [
    "Get the script tag that loads the Superflow toolbar on a site, with step-by-step instructions for the site's platform (Webflow, Shopify, WordPress, Framer, plain HTML, Netlify, Next.js, Vercel).",
    "Use it right after creating a project, or when someone asks how to install Superflow. Pass platform for the steps of a different platform than the project's.",
    "To check whether the snippet is live use superflow_verify_install.",
    'Example: {"project": "Acme Dental", "platform": "webflow"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    platform: platformSchema.describe("Platform for the steps. Defaults to the project's platform."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const snippet = await api.call<InstallSnippet>("getInstallSnippet", {
      path: { project: args.project },
      query: { platform: args.platform },
    });
    const steps = snippet.steps ?? [];
    const summary = join(
      `Install snippet for ${args.project} on ${snippet.platform ?? args.platform ?? "its platform"}: ${plural(steps.length, "step")}.`,
      "Paste script_tag as the steps say, then check it with superflow_verify_install.",
      snippet.docs_url && `Docs: ${snippet.docs_url}`,
    );
    return okResult(summary, asData(snippet));
  },
});

const VERDICTS: Record<string, string> = {
  installed: "The Superflow snippet is live on the site. The project is now marked installed.",
  different_project_installed: "The site has a Superflow snippet, but for a different project.",
  not_installed: "No Superflow snippet was found on the site.",
  inconclusive: "Superflow could not tell whether the snippet is installed.",
};

export const verifyInstall = defineTool({
  name: "superflow_verify_install",
  title: "Verify the install",
  description: [
    "Check whether the Superflow snippet is live on the project's site. Superflow fetches the site once and answers installed, different_project_installed (a snippet for another project is there), not_installed or inconclusive, with the reason.",
    "When the verdict is installed, the project is marked installed. Safe to repeat. Use it after the user says they added the snippet.",
    "To get the snippet use superflow_get_install_snippet.",
    'Example: {"project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: { project: projectRefSchema },
  annotations: hints(false, false, true, true),
  write: true,
  async run(args, { api }) {
    const result = await api.call<VerifyInstallResponse>("verifyInstall", { path: { project: args.project }, body: {} });
    const verdict = VERDICTS[result.verdict] ?? `Verdict: ${result.verdict}.`;
    return okResult(join(verdict, result.reason && `Reason: ${result.reason}`), asData(result));
  },
});

export const projectTools = [
  getProject,
  createProject,
  updateProject,
  archiveProject,
  unarchiveProject,
  deleteProject,
  getInstallSnippet,
  verifyInstall,
];
