// Workspace analytics (GET /analytics/team, /people, /history). The numbers are computed once a
// day, so every answer says how fresh it is: a stale rollup reads as zeros and must be
// reported as unavailable, never as "no activity".
import { z } from "zod";
import { okResult } from "../lib/format.ts";
import { defineTool, READ_HINTS } from "./define.ts";
import { asData, join } from "./helpers.ts";

const STALE_NOTE =
  "Analytics are recomputed once a day. When is_stale is true the numbers are zeros because the rollup is old: say the numbers are not available right now, not that there was no activity.";

const lookbackSchema = z
  .union([z.literal(1), z.literal(7), z.literal(14), z.literal(30)])
  .optional()
  .describe("Window in days: 1, 7, 14 or 30. Default 7.");

interface AnalyticsAnswer {
  lookback_days?: number;
  is_stale: boolean;
  last_computed_date?: string | null;
  team?: Record<string, unknown> | null;
  people?: Record<string, unknown> | null;
  history?: Record<string, unknown> | null;
}

function freshness(answer: AnalyticsAnswer): string {
  return answer.is_stale
    ? "STALE: the numbers are not available right now (the daily rollup is old)."
    : `Fresh${answer.last_computed_date ? `, computed ${answer.last_computed_date}` : ""}.`;
}

export const getTeamAnalytics = defineTool({
  name: "superflow_get_team_analytics",
  title: "Team analytics",
  description: [
    "Workspace activity over a window: comments added and resolved, and the projects that were active.",
    "Use it for questions like \"how busy were we this week\". For counts of comments by status, page or person right now, use superflow_comment_stats instead: it is live.",
    STALE_NOTE,
    'Example: {"lookback_days": 7}',
  ].join("\n"),
  inputSchema: { lookback_days: lookbackSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const answer = await api.call<AnalyticsAnswer>("getTeamAnalytics", { query: { lookback_days: args.lookback_days } });
    const stats = (answer.team?.commentStats ?? {}) as { commentsAdded?: number; commentsResolved?: number };
    return okResult(
      join(
        `Team analytics, last ${answer.lookback_days ?? args.lookback_days ?? 7} days.`,
        freshness(answer),
        !answer.is_stale && `${stats.commentsAdded ?? 0} comments added, ${stats.commentsResolved ?? 0} resolved.`,
      ),
      asData(answer),
    );
  },
});

export const getPeopleAnalytics = defineTool({
  name: "superflow_get_people_analytics",
  title: "People analytics",
  description: [
    "Per-person activity over a window: who commented, who resolved, and who has work waiting.",
    "Use it for questions like \"who resolved the most this month\". For the comments assigned to one person right now, use superflow_list_comments with assignee.",
    STALE_NOTE,
    'Example: {"lookback_days": 30}',
  ].join("\n"),
  inputSchema: { lookback_days: lookbackSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const answer = await api.call<AnalyticsAnswer>("getPeopleAnalytics", { query: { lookback_days: args.lookback_days } });
    return okResult(join(`People analytics, last ${answer.lookback_days ?? args.lookback_days ?? 7} days.`, freshness(answer)), asData(answer));
  },
});

export const getAllTimeAnalytics = defineTool({
  name: "superflow_get_all_time_analytics",
  title: "All-time analytics",
  description: [
    "The workspace's all-time rollup: lifetime comment counts, the most active projects and the most active people.",
    "Use it for questions about the whole history of the workspace. For a recent window use superflow_get_team_analytics.",
    "history is null when no rollup was ever computed for the workspace: say so.",
    "Example: {}",
  ].join("\n"),
  inputSchema: {},
  annotations: READ_HINTS,
  write: false,
  async run(_args, { api }) {
    const answer = await api.call<AnalyticsAnswer>("getAnalyticsHistory");
    return okResult(answer.history ? "All-time analytics." : "No all-time analytics have been computed for this workspace yet.", asData(answer));
  },
});

export const analyticsTools = [getTeamAnalytics, getPeopleAnalytics, getAllTimeAnalytics];
