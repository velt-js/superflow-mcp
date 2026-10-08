// Tool registry. The order here is the order clients see in tools/list.
import type { z } from "zod";
import { commentTools } from "./comments.ts";
import type { ToolDefinition } from "./define.ts";
import { lookupTools } from "./lookups.ts";
import { memberTools } from "./members.ts";
import { notificationTools } from "./notifications.ts";
import { organizationTools } from "./organization.ts";
import { pageTools } from "./pages.ts";
import { projectTools } from "./projects.ts";
import { reviewLinkTools } from "./review-links.ts";
import { statusTools } from "./statuses.ts";
import { tagTools } from "./tags.ts";

export type { ToolContext, ToolDefinition, ToolHints } from "./define.ts";

export const tools: ReadonlyArray<ToolDefinition<z.ZodRawShape>> = [
  // Phase 1: lookups and comments.
  ...lookupTools,
  ...commentTools,
  // Phase 2: admin.
  ...projectTools,
  ...pageTools,
  ...memberTools,
  ...statusTools,
  ...tagTools,
  ...organizationTools,
  ...reviewLinkTools,
  ...notificationTools,
];

export const TOOL_NAMES: readonly string[] = tools.map((tool) => tool.name);
export const WRITE_TOOL_NAMES: readonly string[] = tools.filter((tool) => tool.write).map((tool) => tool.name);

/** The tools to register for a configuration: write tools are left out in read-only mode. */
export function toolsFor(options: { readOnly: boolean }): ReadonlyArray<ToolDefinition<z.ZodRawShape>> {
  return options.readOnly ? tools.filter((tool) => !tool.write) : tools;
}
