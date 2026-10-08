// Integration tools: connected tools (Slack, Jira, Asana, ClickUp, Monday), connecting one,
// its settings, pushing a comment to a tracker, and posting to Slack.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type {
  CommentCompact,
  CommentFull,
  ConnectLink,
  Integration,
  ListEnvelope,
  PushCommentResponse,
  SlackPostResponse,
} from "../client/types.ts";
import { CONFIRM_POST_TO_SLACK_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { findInvalidDate } from "../lib/dates.ts";
import { commentLabel, confirmationResult, errorResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { isCommentNumber, normalizeCommentRef, projectForComment } from "../lib/resolve.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, join } from "./helpers.ts";
import {
  INTEGRATION_TYPES,
  SLACK_TEMPLATES,
  commentRefSchema,
  confirmSchema,
  filterShape,
  idempotencySchema,
  integrationRefSchema,
  pickFilters,
  projectForNumberSchema,
} from "./schemas.ts";

const TYPE_LABELS: Record<string, string> = {
  slack: "Slack",
  jira: "Jira",
  asana: "Asana",
  clickup: "ClickUp",
  monday: "Monday",
};

function typeLabel(type: string | undefined): string {
  return (type && TYPE_LABELS[type]) ?? type ?? "the tool";
}

/** "Slack: Acme workspace, #design-feedback (int_1, connected)". */
export function integrationLine(integration: Integration): string {
  const status = integration.status === "needs_reauth" ? "needs reconnecting" : integration.status ?? "connected";
  return `${typeLabel(integration.type)}: ${integration.name}${integration.detail ? `, ${integration.detail}` : ""} (${integration.id}, ${status})`;
}

export const listIntegrations = defineTool({
  name: "superflow_list_integrations",
  title: "List integrations",
  description: [
    "List the tools connected to the workspace (Slack, Jira, Asana, ClickUp, Monday): each connection's id, the Slack channel or the tool's site, whether it still works or needs reconnecting, and its default project.",
    "Use it to find the integration id for superflow_push_comment or superflow_post_to_slack. To connect a new tool use superflow_connect_integration.",
    "Example: {}",
  ].join("\n"),
  inputSchema: {},
  annotations: READ_HINTS,
  write: false,
  async run(_args, { api }) {
    const list = await api.call<ListEnvelope<Integration>>("listIntegrations");
    const items = list.items ?? [];
    const stale = items.filter((item) => item.status === "needs_reauth");
    const summary = join(
      items.length === 0
        ? "No tools are connected. Connect one with superflow_connect_integration."
        : `${plural(items.length, "connected tool")}: ${items
            .slice(0, 6)
            .map(integrationLine)
            .join("; ")}${items.length > 6 ? "; ..." : ""}.`,
      stale.length > 0 &&
        `${plural(stale.length, "connection")} ${stale.length === 1 ? "needs" : "need"} reconnecting: get a link with superflow_connect_integration.`,
    );
    return okResult(summary, asData(list));
  },
});

export const getIntegration = defineTool({
  name: "superflow_get_integration",
  title: "Get an integration",
  description: [
    "Get one connected tool: its type, name, Slack channel or site, whether it still works, and its settings (the default Jira project key, or Asana, ClickUp or Monday project or list).",
    "To list them all use superflow_list_integrations. To change the default project use superflow_update_integration.",
    'Example: {"integration": "int_7g8h9i"}',
  ].join("\n"),
  inputSchema: { integration: integrationRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const integration = await api.call<Integration>("getIntegration", { path: { integration: args.integration } });
    const project = integration.settings?.default_project;
    return okResult(
      join(`${integrationLine(integration)}.`, project ? `Default project: ${project}.` : "No default project set."),
      asData(integration),
    );
  },
});

export const connectIntegration = defineTool({
  name: "superflow_connect_integration",
  title: "Connect a tool",
  description: [
    "Get a link to the Superflow page that connects Slack, Jira, Asana, ClickUp or Monday to the workspace. The user opens it in a browser where they are signed in to Superflow and signs in to the tool there. This server cannot finish the sign-in itself, and nothing is connected until the user does.",
    "Use it when superflow_push_comment or superflow_post_to_slack needs a tool that is not connected, or when a connection needs reconnecting. Afterwards check with superflow_list_integrations.",
    "Disconnecting is done in the Superflow portal, not here.",
    'Example: {"type": "jira"}',
  ].join("\n"),
  inputSchema: {
    type: z.enum(INTEGRATION_TYPES).describe("The tool to connect: slack, jira, asana, clickup or monday."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const link = await api.call<ConnectLink>("connectIntegration", { body: { type: args.type } });
    return okResult(
      join(
        `Give the user this link to connect ${typeLabel(args.type)}: ${link.url}.`,
        "They sign in to the tool in their browser; this server cannot finish it. Then check with superflow_list_integrations.",
        link.note,
      ),
      asData(link),
    );
  },
});

/** Where a push goes, per tool, as the API expects it in project_key and default_project. */
const TARGET_FORMATS =
  "Jira: KEY:12345, the project key plus its numeric project id (for example WEB:10001). Asana: <workspace gid>:<project gid>. ClickUp: <team id>:<space id>:<list id>. Monday: <board id>.";

const targetSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\s]+$/, "must have no spaces, for example WEB:10001");

export const updateIntegration = defineTool({
  name: "superflow_update_integration",
  title: "Update an integration",
  description: [
    "Set or clear a connected tool's default project: where superflow_push_comment creates issues or tasks when it gets no project_key.",
    `The value uses ids, not names. ${TARGET_FORMATS} Ask the user for the ids if you do not have them; null clears the default.`,
    "Disconnecting a tool is not offered here: the user does it in the Superflow portal.",
    'Example: {"integration": "int_7g8h9i", "default_project": "WEB:10001"}',
  ].join("\n"),
  inputSchema: {
    integration: integrationRefSchema,
    default_project: targetSchema
      .nullable()
      .describe(`Where pushes go by default. ${TARGET_FORMATS} null clears it.`),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const integration = await api.call<Integration>("updateIntegration", {
      path: { integration: args.integration },
      body: { default_project: args.default_project },
    });
    const target = integration.settings?.default_project;
    return okResult(
      `Updated ${integrationLine(integration)}. ${target ? `Default project: ${target}.` : "No default project now."}`,
      asData(integration),
    );
  },
});

export const pushComment = defineTool({
  name: "superflow_push_comment",
  title: "Push a comment to a tracker",
  description: [
    "Create an issue or task from a comment in a connected tool (Jira, Asana, ClickUp or Monday), with the comment's text, page and link. This creates a real item in the customer's own tool that their team will see. The new item's link is saved on the comment (external_links). Needs the integrations:write and comments:read scopes.",
    `project_key says where it goes, with ids, not names. ${TARGET_FORMATS} Leave it out to use the integration's default project (superflow_update_integration).`,
    "Asana, ClickUp and Monday connections must also be set up to create items from Superflow (in Superflow under Settings > Integrations). When one is not, the API answers invalid with a hint: pass it on, with the link from superflow_connect_integration. If the push times out, call again with the same idempotency_key to pick up the result instead of creating a second item.",
    "Ask the user before pushing. Find the integration id with superflow_list_integrations. To tell a Slack channel instead use superflow_post_to_slack.",
    'Example: {"comment": "4821", "project": "Acme Dental", "integration": "int_7g8h9i", "project_key": "WEB:10001"}',
  ].join("\n"),
  inputSchema: {
    comment: commentRefSchema,
    project: projectForNumberSchema,
    integration: integrationRefSchema.describe("The tracker connection (int_... or its name), from superflow_list_integrations."),
    project_key: targetSchema
      .optional()
      .describe(`Where to create it. ${TARGET_FORMATS} Defaults to the integration's default project.`),
    title: z.string().min(1).max(255).optional().describe("Issue title. Defaults to the start of the comment text."),
    idempotency_key: idempotencySchema,
  },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api, config }) {
    // The push body has no project, so a comment number with a project is resolved to its id first.
    let comment = normalizeCommentRef(args.comment);
    const project = projectForComment(args.comment, args.project, config.defaultProject);
    if (isCommentNumber(args.comment) && project) {
      const found = await api.call<CommentFull>("getComment", {
        path: { comment },
        query: { project, include_replies: false },
      });
      comment = found.id;
    }
    // Generated once per tool call, so the client's own retries cannot create two issues.
    const idempotencyKey = args.idempotency_key ?? randomUUID();
    let result: PushCommentResponse;
    try {
      result = await api.call<PushCommentResponse>("pushComment", {
        path: { comment },
        body: compact({ integration: args.integration, project_key: args.project_key, title: args.title, idempotency_key: idempotencyKey }),
      });
    } catch (error) {
      // The item may still be created after a timeout: the same key picks up the result.
      if (!(error instanceof SuperflowApiError) || error.code !== "upstream") throw error;
      return errorResult({
        code: error.code,
        message: error.message,
        hint: join(
          error.hint,
          `To check again without creating a second item, call superflow_push_comment with the same arguments and idempotency_key "${idempotencyKey}".`,
        ),
        candidates: error.candidates,
      });
    }
    const link = result.link;
    return okResult(
      join(
        `Created ${typeLabel(link?.type)} ${link?.key ?? "item"} from comment ${result.comment ? commentLabel(result.comment) : args.comment}${link?.url ? `: ${link.url}` : ""}.`,
        "The customer's team can see it in their tool. The link is saved on the comment.",
      ),
      asData(result),
    );
  },
});

const slackFilterSchema = z
  .object(filterShape)
  .optional()
  .describe("Quote the comments that match these filters (the same as superflow_list_comments): the 25 with the most recent activity. Give comments or filter, not both.");

export const postToSlack = defineTool({
  name: "superflow_post_to_slack",
  title: "Post to Slack",
  description: [
    "Post a message to a connected Slack channel: your text, and optionally up to 25 quoted comments (by id, or the 25 most recently active that match a filter) as a list (default) or a summary, with links. Everyone in that channel sees it, in the customer's own Slack. Quoting comments also needs the comments:read scope.",
    "Without confirm: true nothing is posted: you get the channel, the text and the comments that would be posted as a preview. Show it to the user and call again with confirm: true only after they say yes.",
    "Find the Slack integration id with superflow_list_integrations. To create a tracker issue instead use superflow_push_comment.",
    'Example: {"integration": "int_1a2b3c", "text": "Pre-launch review is done. Critical items below.", "filter": {"project": "Acme Dental", "status": ["open"], "priority": ["critical"]}, "template": "list"}',
  ].join("\n"),
  inputSchema: {
    integration: integrationRefSchema.describe("The Slack connection (int_... or its name). The message goes to its channel."),
    text: z.string().min(1).max(3000).optional().describe("The message. Plain text."),
    comments: z
      .array(z.string().min(1))
      .min(1)
      .max(25)
      .optional()
      .describe("Comments to include: ids (cmt_...) from a list call, or numbers. Give comments or filter, not both."),
    filter: slackFilterSchema,
    template: z
      .enum(SLACK_TEMPLATES)
      .optional()
      .describe("How comments are shown: list (default, one line per comment with its link) or summary (counts and the top items)."),
    confirm: confirmSchema("post the message"),
  },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api }) {
    if (args.comments && args.filter) return invalidInput("Give comments or filter, not both.");
    const filter = args.filter ? pickFilters(args.filter) : undefined;
    if (filter && Object.keys(filter).length === 0) {
      return invalidInput("The filter is empty. Add at least one filter, for example a project or status.");
    }
    if (!args.text && !args.comments && !filter) return invalidInput("Nothing to post. Give text, comments or filter.");
    if (filter) {
      const badDate = findInvalidDate(filter, "filter.");
      if (badDate) return invalidInput(badDate);
    }
    const comments = args.comments?.map(normalizeCommentRef);
    const body = compact({ integration: args.integration, text: args.text, comments, filter, template: args.template });

    if (isConfirmed(args.confirm)) {
      // A refused post is a 502 upstream error, so a result here was posted.
      const result = await api.call<SlackPostResponse>("postToSlack", { body });
      const quoted = result.comments_posted ?? 0;
      return okResult(
        join(
          `Posted the message to Slack${result.channel ? ` ${result.channel}` : ""}${quoted > 0 ? ` with ${plural(quoted, "comment")}` : ""}.`,
          result.permalink ? `Link: ${result.permalink}` : "",
        ),
        asData(result),
      );
    }

    // Preview: reads only. Nothing that could post is sent without confirm.
    const integration = await api.call<Integration>("getIntegration", { path: { integration: args.integration } });
    if (integration.type !== "slack") {
      return invalidInput(
        `${integration.name} is a ${typeLabel(integration.type)} connection, not Slack.`,
        "Pick a Slack connection from superflow_list_integrations, or push to a tracker with superflow_push_comment.",
      );
    }
    let matching: { count: number; at_least: boolean; sample: Array<CommentCompact | CommentFull> } | undefined;
    if (filter) {
      // The post quotes the first 25 matches in the list's default order (most recent activity),
      // so the preview reads the same 25. Quoting needs comments:read, so a key without it fails
      // here exactly as the post would.
      const list = await api.call<ListEnvelope<CommentCompact | CommentFull>>("listComments", {
        query: { ...filter, limit: 25, fields: "compact" },
      });
      const sample = list.items ?? [];
      const total = typeof list.total === "number" ? list.total : undefined;
      matching = { count: total ?? sample.length, at_least: total === undefined && Boolean(list.next_cursor), sample };
    }
    const channel = integration.detail ? ` ${integration.detail}` : "";
    const what = join(
      args.text && `the text "${args.text.length > 120 ? `${args.text.slice(0, 120)}...` : args.text}"`,
      comments && `${args.text ? "and " : ""}${plural(comments.length, "comment")}`,
      matching &&
        (matching.count > 25 || matching.at_least
          ? `${args.text ? "and " : ""}the 25 most recently active of ${matching.at_least ? "more than 25" : matching.count} matching comments`
          : `${args.text ? "and " : ""}${plural(matching.count, "matching comment")}`),
      args.template && `as a ${args.template}`,
    );
    return confirmationResult(
      `Would post to Slack${channel} (${integration.name}): ${what}. Nothing was posted. Ask the user to confirm.`,
      {
        preview: compact({
          integration,
          channel: integration.detail ?? null,
          text: args.text,
          comments,
          filter,
          template: args.template,
          matching_comments: matching,
        }),
        message: CONFIRM_POST_TO_SLACK_MESSAGE,
      },
    );
  },
});

export const integrationTools = [
  listIntegrations,
  getIntegration,
  connectIntegration,
  updateIntegration,
  pushComment,
  postToSlack,
];
