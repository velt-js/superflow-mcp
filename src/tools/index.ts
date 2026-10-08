// Tool registry. The order here is the order clients see in tools/list.
import type { z } from "zod";
import { commentTools } from "./comments.ts";
import type { ToolDefinition } from "./define.ts";
import { lookupTools } from "./lookups.ts";

export type { ToolContext, ToolDefinition, ToolHints } from "./define.ts";

export const tools: ReadonlyArray<ToolDefinition<z.ZodRawShape>> = [...lookupTools, ...commentTools];

export const TOOL_NAMES: readonly string[] = tools.map((tool) => tool.name);
export const WRITE_TOOL_NAMES: readonly string[] = tools.filter((tool) => tool.write).map((tool) => tool.name);

/** The tools to register for a configuration: write tools are left out in read-only mode. */
export function toolsFor(options: { readOnly: boolean }): ReadonlyArray<ToolDefinition<z.ZodRawShape>> {
  return options.readOnly ? tools.filter((tool) => !tool.write) : tools;
}
