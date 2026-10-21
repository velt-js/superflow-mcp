// Resources (spec 6.3, plus superflow://organization in Phase 2 and superflow://runs/{run} in
// Phase 3). Each returns the same JSON as the matching tool.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { SuperflowApiError } from "../client/api.ts";
import type { ListEnvelope, Page, Project } from "../client/types.ts";
import { getComment, listComments } from "../tools/comments.ts";
import type { ToolContext, ToolDefinition } from "../tools/define.ts";
import { listProjects } from "../tools/lookups.ts";
import { getOrganization } from "../tools/organization.ts";
import { getRun } from "../tools/runs.ts";
import type { z } from "zod";

const JSON_MIME = "application/json";

function decode(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === "") return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function jsonContents(uri: URL, data: unknown): ReadResourceResult {
  return { contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(data, null, 2) }] };
}

/**
 * The SDK's matcher requires every {?a,b,c} query variable, in order. This template accepts
 * the comments URI with any subset of status, page_url and assignee, in any order.
 */
class CommentsUriTemplate extends UriTemplate {
  override match(uri: string): Variables | null {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      return null;
    }
    if (url.protocol !== "superflow:" || url.host !== "projects") return null;
    const match = /^\/([^/]+)\/comments\/?$/.exec(url.pathname);
    if (!match?.[1]) return null;
    const variables: Variables = { project: match[1] };
    for (const key of ["status", "page_url", "assignee"]) {
      const value = url.searchParams.get(key);
      if (value !== null && value !== "") variables[key] = encodeURIComponent(value);
    }
    return variables;
  }
}

/** Runs a tool and returns its structuredContent, or throws its error so the read fails clearly. */
async function runTool<Shape extends z.ZodRawShape>(
  tool: ToolDefinition<Shape>,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const result = await tool.run(args as z.objectOutputType<Shape, z.ZodTypeAny>, ctx);
  const data = (result.structuredContent ?? {}) as Record<string, unknown>;
  if (result.isError) {
    const error = (data.error ?? {}) as { code?: string; message?: string; hint?: string };
    throw new SuperflowApiError({
      status: 400,
      code: error.code ?? "invalid",
      message: error.message ?? "The resource could not be read.",
      hint: error.hint ?? "",
    });
  }
  return data;
}

export function registerResources(server: McpServer, ctx: ToolContext): void {
  server.registerResource(
    "projects",
    "superflow://projects",
    {
      title: "Superflow projects",
      description: "The projects this key can see (first page), same JSON as superflow_list_projects.",
      mimeType: JSON_MIME,
    },
    async (uri) => jsonContents(uri, await runTool(listProjects, { include_archived: false, limit: 25 }, ctx)),
  );

  server.registerResource(
    "organization",
    "superflow://organization",
    {
      title: "Superflow workspace",
      description: "The workspace: plan, owner, seats, projects and AI credits. Same JSON as superflow_get_organization.",
      mimeType: JSON_MIME,
    },
    async (uri) => jsonContents(uri, await runTool(getOrganization, {}, ctx)),
  );

  server.registerResource(
    "project",
    new ResourceTemplate("superflow://projects/{project}", { list: undefined }),
    {
      title: "Superflow project",
      description: "One project with its first page of pages, as { project, pages }.",
      mimeType: JSON_MIME,
    },
    async (uri, variables) => {
      const project = decode(variables.project);
      if (!project) throw new SuperflowApiError({ status: 400, code: "invalid", message: "The URI has no project." });
      const [detail, pages] = await Promise.all([
        ctx.api.call<Project>("getProject", { path: { project } }),
        ctx.api.call<ListEnvelope<Page>>("listProjectPages", {
          path: { project },
          query: { with_counts: true, limit: 25 },
        }),
      ]);
      return jsonContents(uri, { project: detail, pages });
    },
  );

  server.registerResource(
    "project-comments",
    new ResourceTemplate(new CommentsUriTemplate("superflow://projects/{project}/comments{?status,page_url,assignee}"), {
      list: undefined,
    }),
    {
      title: "Superflow project comments",
      description:
        "Comments in a project, same JSON as superflow_list_comments. Optional query: status, page_url, assignee (comma separated lists).",
      mimeType: JSON_MIME,
    },
    async (uri, variables) => {
      const project = decode(variables.project);
      if (!project) throw new SuperflowApiError({ status: 400, code: "invalid", message: "The URI has no project." });
      const args: Record<string, unknown> = {
        project,
        status: splitList(decode(variables.status)),
        page_url: decode(variables.page_url),
        assignee: splitList(decode(variables.assignee)),
        limit: 25,
        fields: "compact",
      };
      return jsonContents(uri, await runTool(listComments, args, ctx));
    },
  );

  server.registerResource(
    "comment",
    new ResourceTemplate("superflow://comments/{comment}", { list: undefined }),
    {
      title: "Superflow comment",
      description: "One comment with replies, same JSON as superflow_get_comment. Numbers use SUPERFLOW_DEFAULT_PROJECT.",
      mimeType: JSON_MIME,
    },
    async (uri, variables) => {
      const comment = decode(variables.comment);
      if (!comment) throw new SuperflowApiError({ status: 400, code: "invalid", message: "The URI has no comment." });
      return jsonContents(uri, await runTool(getComment, { comment, include_replies: true }, ctx));
    },
  );

  server.registerResource(
    "run",
    new ResourceTemplate("superflow://runs/{run}", { list: undefined }),
    {
      title: "Superflow agent run",
      description: "One agent run with its live status per agent, same JSON as superflow_get_run.",
      mimeType: JSON_MIME,
    },
    async (uri, variables) => {
      const run = decode(variables.run);
      if (!run) throw new SuperflowApiError({ status: 400, code: "invalid", message: "The URI has no run." });
      return jsonContents(uri, await runTool(getRun, { run }, ctx));
    },
  );
}
