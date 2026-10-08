// Shared helpers for the nightly evals (scripts/check-tool-choice.ts, scripts/run-evals.ts).
// Model calls follow the Claude API guidance for claude-opus-5-5: no `thinking` field (it
// always thinks), effort through output_config, tool_choice auto (forced tool choice is a
// 400 on this model), and the server-side refusal fallback. stop_reason is checked before
// any content is read.
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient } from "../../src/client/api.ts";
import type { Config } from "../../src/config.ts";
import { DEFAULT_BASE_URL } from "../../src/config.ts";
import { silentLogger } from "../../src/lib/logger.ts";
import { createServer } from "../../src/server.ts";

export const MODEL = "claude-opus-5-5";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
// Opus 5.5 thinking counts against max_tokens, so leave room for it.
export const MAX_TOKENS = 16_000;

export type Check =
  | { tool: string; arg_includes: Record<string, unknown> }
  | { result_path_nonempty: string }
  | { tool_not_called: string }
  | { no_confirmed_writes: true };

export interface EvalPrompt {
  id: string;
  prompt: string;
  /** A tool name, a list of acceptable names, or null for "no tool call". */
  expect_first_tool: string | null | Array<string | null>;
  expect_tools_any_order?: string[];
  check?: Check[];
  read_only?: boolean;
  default_project?: string;
}

export interface Placeholders {
  project: string;
  page_url: string;
}

export function loadPrompts(placeholders: Placeholders): EvalPrompt[] {
  const raw = readFileSync(new URL("../../test/evals/prompts.json", import.meta.url), "utf8");
  const fill = (text: string) =>
    text.replaceAll("{project}", placeholders.project).replaceAll("{page_url}", placeholders.page_url);
  return (JSON.parse(raw) as EvalPrompt[]).map((entry) => ({
    ...entry,
    prompt: fill(entry.prompt),
    ...(entry.default_project ? { default_project: fill(entry.default_project) } : {}),
  }));
}

export function acceptedFirstTools(entry: EvalPrompt): Array<string | null> {
  return Array.isArray(entry.expect_first_tool) ? entry.expect_first_tool : [entry.expect_first_tool];
}

export interface McpSession {
  client: Client;
  tools: Tool[];
  instructions: string;
  close(): Promise<void>;
}

/** Starts the real server in memory and lists its tools through the MCP client. */
export async function startServer(options: {
  apiKey: string;
  baseUrl?: string;
  readOnly?: boolean;
  defaultProject?: string;
}): Promise<McpSession> {
  const config: Config = {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    defaultProject: options.defaultProject,
    readOnly: options.readOnly ?? false,
    logLevel: "silent",
  };
  const api = new ApiClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, logger: silentLogger });
  const server = createServer({ config, client: api, logger: silentLogger });
  const client = new Client({ name: "superflow-mcp-evals", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  return {
    client,
    tools,
    instructions: client.getInstructions() ?? "",
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Converts MCP tools/list entries to Claude API tool definitions. */
export function toClaudeTools(tools: Tool[]): Anthropic.Beta.BetaTool[] {
  return tools.map((tool) => {
    const { $schema: _schema, ...schema } = tool.inputSchema as Record<string, unknown>;
    return {
      name: tool.name,
      description: tool.description ?? "",
      input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
    };
  });
}

export function systemPrompt(session: McpSession, defaultProject?: string): string {
  const lines = [
    "You are an assistant connected to the user's Superflow workspace through MCP tools.",
    "Use the tools to answer. Follow the server instructions below.",
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ];
  if (defaultProject) lines.push(`SUPERFLOW_DEFAULT_PROJECT is set to "${defaultProject}".`);
  lines.push("", "Server instructions:", session.instructions);
  return lines.join("\n");
}

export function createAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(2);
  }
  return new Anthropic();
}

export async function createMessage(
  anthropic: Anthropic,
  params: {
    system: string;
    tools: Anthropic.Beta.BetaTool[];
    messages: Anthropic.Beta.BetaMessageParam[];
  },
): Promise<Anthropic.Beta.BetaMessage> {
  return anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "medium" },
    tool_choice: { type: "auto" },
    system: params.system,
    tools: params.tools,
    messages: params.messages,
  });
}

export function toolUses(message: Anthropic.Beta.BetaMessage): Anthropic.Beta.BetaToolUseBlock[] {
  return message.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
}

export function textOf(result: CallToolResult): string {
  return result.content
    .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
    .join("\n");
}

/** Deep partial match: objects match by key, arrays when every expected item is in the actual array. */
export function includes(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((item) => actual.some((candidate) => includes(candidate, item)));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
      includes((actual as Record<string, unknown>)[key], value),
    );
  }
  if (typeof expected === "string" && typeof actual === "string") {
    return actual.toLowerCase() === expected.toLowerCase();
  }
  return actual === expected;
}

export function valueAt(data: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[key];
    return undefined;
  }, data);
}

export function isNonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== "";
}

/** Runs async work over items with a small concurrency limit, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}
