// Lookup tools: who am I, projects, pages, people, statuses, tags.
import { z } from "zod";
import type { ListEnvelope, Me, Member, Page, Project, Status, Tag } from "../client/types.ts";
import { okResult, paginationNote, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool } from "./define.ts";
import { cursorSchema, limitSchema, projectRefSchema } from "./schemas.ts";

const optionalProject = projectRefSchema.optional();

export const getMe = defineTool({
  name: "superflow_get_me",
  title: "Who am I",
  description: [
    "Show who this Superflow API key belongs to: the member, the workspace, its plan, and the key's scopes.",
    "Use it when the user asks which account is connected, or after a forbidden error to check the scopes.",
    "It does not list teammates. For that use superflow_list_members.",
    "Example: {}",
  ].join("\n"),
  inputSchema: {},
  annotations: READ_HINTS,
  write: false,
  async run(_args, { api }) {
    const me = await api.call<Me>("getMe");
    const plan = me.organization?.plan ? `, ${me.organization.plan} plan` : "";
    const summary =
      `Connected as ${me.member?.name ?? "unknown"}${me.member?.email ? ` (${me.member.email})` : ""}, ` +
      `${me.member?.role ?? "member"} of ${me.organization?.name ?? "the workspace"}${plan}. ` +
      `Scopes: ${(me.scopes ?? []).join(", ") || "none"}.`;
    return okResult(summary, me as unknown as Record<string, unknown>);
  },
});

export const listProjects = defineTool({
  name: "superflow_list_projects",
  title: "List projects",
  description: [
    "List the Superflow projects (websites) this key can see, with site URL, install status and open comment count.",
    "Use it to find a project's exact name or id, or to answer questions like which sites have the most open comments.",
    "For the pages inside one project use superflow_list_pages. For comment counts by any other dimension use superflow_comment_stats.",
    'Example: {"query": "acme"}',
  ].join("\n"),
  inputSchema: {
    query: z.string().min(1).optional().describe("Filter by project name or site URL (substring, case-insensitive)."),
    include_archived: z.boolean().default(false).describe("Include archived projects. Default false."),
    limit: limitSchema,
    cursor: cursorSchema,
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = await api.call<ListEnvelope<Project>>("listProjects", {
      query: { query: args.query, include_archived: args.include_archived, limit: args.limit, cursor: args.cursor },
    });
    const items = list.items ?? [];
    const names = items.slice(0, 5).map((p) => p.name);
    const summary = [
      `Found ${plural(items.length, "project")}${names.length ? `: ${names.join(", ")}${items.length > 5 ? ", ..." : ""}` : ""}.`,
      paginationNote(list),
    ]
      .filter(Boolean)
      .join(" ");
    return okResult(summary, list as unknown as Record<string, unknown>);
  },
});

export const listPages = defineTool({
  name: "superflow_list_pages",
  title: "List pages",
  description: [
    "List the pages of one project with their open and total comment counts.",
    "Use it to see which pages have feedback, to find pages with zero comments, or to get exact page URLs before filtering comments.",
    "For the comments themselves use superflow_list_comments. For counts per page under other filters use superflow_comment_stats with group_by page.",
    'Example: {"project": "Acme Dental", "with_counts": true}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    query: z.string().min(1).optional().describe("Filter by page URL or title (substring)."),
    with_counts: z.boolean().default(true).describe("Include comment counts per page. Default true."),
    limit: limitSchema,
    cursor: cursorSchema,
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = await api.call<ListEnvelope<Page>>("listProjectPages", {
      path: { project: args.project },
      query: { query: args.query, with_counts: args.with_counts, limit: args.limit, cursor: args.cursor },
    });
    const items = list.items ?? [];
    let summary = `Found ${plural(items.length, "page")} in project "${args.project}".`;
    if (args.with_counts) {
      const withoutComments = items.filter((p) => p.total_comment_count === 0).length;
      const open = items.reduce((sum, p) => sum + (p.open_comment_count ?? 0), 0);
      summary += ` ${plural(open, "open comment")} across them; ${plural(withoutComments, "page")} with no comments.`;
    }
    const more = paginationNote(list);
    return okResult(more ? `${summary} ${more}` : summary, list as unknown as Record<string, unknown>);
  },
});

export const listMembers = defineTool({
  name: "superflow_list_members",
  title: "List members and guests",
  description: [
    "List workspace members (your team) and, when a project is given, that project's guests (clients and reviewers).",
    "Use it to find the exact name or email to use for assignee, author or an @mention, or to see who has access to a project.",
    "Not for the key's own identity: use superflow_get_me.",
    'Example: {"project": "Acme Dental", "query": "jen"}',
  ].join("\n"),
  inputSchema: {
    project: optionalProject.describe(
      "Project (name, site URL or id). When given, the project's guests are included after the members.",
    ),
    query: z.string().min(1).optional().describe("Filter by name or email (substring)."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = args.project
      ? await api.call<ListEnvelope<Member>>("listProjectMembers", {
          path: { project: args.project },
          query: { query: args.query },
        })
      : await api.call<ListEnvelope<Member>>("listMembers", { query: { query: args.query } });
    const items = list.items ?? [];
    const members = items.filter((m) => m.type !== "guest").length;
    const guests = items.length - members;
    const where = args.project ? ` for project "${args.project}"` : "";
    const summary = `Found ${plural(members, "member")} and ${plural(guests, "guest")}${where}.`;
    return okResult(summary, list as unknown as Record<string, unknown>);
  },
});

export const listStatuses = defineTool({
  name: "superflow_list_statuses",
  title: "List statuses",
  description: [
    "List the comment statuses (workflow columns) in order, with which ones count as resolved.",
    "Use it before filtering or updating by status, to get the exact status names. Give a project to include its custom statuses.",
    "To count comments per status use superflow_comment_stats with group_by status.",
    'Example: {"project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    project: optionalProject.describe("Project (name, site URL or id). Omit for the workspace defaults."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = args.project
      ? await api.call<ListEnvelope<Status>>("listProjectStatuses", { path: { project: args.project } })
      : await api.call<ListEnvelope<Status>>("listStatuses");
    const items = list.items ?? [];
    const names = items.map((s) => (s.is_resolved ? `${s.name} (resolved)` : s.name));
    const summary = `${plural(items.length, "status", "statuses")}${names.length ? `: ${names.join(", ")}` : ""}.`;
    return okResult(summary, list as unknown as Record<string, unknown>);
  },
});

export const listTags = defineTool({
  name: "superflow_list_tags",
  title: "List tags",
  description: [
    "List comment tags with how often each is used. Give a project to include its project tags.",
    "Use it to find exact tag names before filtering, tagging or bulk updating by tag.",
    "To count comments per tag under other filters use superflow_comment_stats with group_by tag.",
    'Example: {"project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    project: optionalProject.describe("Project (name, site URL or id). Omit for workspace-wide tags."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = args.project
      ? await api.call<ListEnvelope<Tag>>("listProjectTags", { path: { project: args.project } })
      : await api.call<ListEnvelope<Tag>>("listTags");
    const items = list.items ?? [];
    const top = [...items]
      .sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0))
      .slice(0, 8)
      .map((t) => (typeof t.usage_count === "number" ? `${t.name} (${t.usage_count})` : t.name));
    const summary = `${plural(items.length, "tag")}${top.length ? `: ${top.join(", ")}${items.length > 8 ? ", ..." : ""}` : ""}.`;
    return okResult(summary, list as unknown as Record<string, unknown>);
  },
});

export const lookupTools = [getMe, listProjects, listPages, listMembers, listStatuses, listTags];
