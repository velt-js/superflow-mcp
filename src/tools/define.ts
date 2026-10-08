import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { ApiClient } from "../client/api.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../lib/logger.ts";

export interface ToolContext {
  api: ApiClient;
  config: Config;
  logger: Logger;
}

/** MCP tool annotations. Every tool sets all four (CONTRACT section 8). */
export interface ToolHints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  /** Written for a language model: what, when, when not, and one "Example:" call. */
  description: string;
  inputSchema: Shape;
  annotations: ToolHints;
  /** Write tools are not registered when SUPERFLOW_READ_ONLY is true. */
  write: boolean;
  run(args: z.objectOutputType<Shape, z.ZodTypeAny>, ctx: ToolContext): Promise<CallToolResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(definition: ToolDefinition<Shape>): ToolDefinition<Shape> {
  return definition;
}

/** Annotation helper in the contract's column order: readOnly, destructive, idempotent, openWorld. */
export function hints(readOnlyHint: boolean, destructiveHint: boolean, idempotentHint: boolean, openWorldHint: boolean): ToolHints {
  return { readOnlyHint, destructiveHint, idempotentHint, openWorldHint };
}

export const READ_HINTS = hints(true, false, true, false);
