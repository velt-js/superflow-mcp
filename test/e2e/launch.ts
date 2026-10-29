// Starts the BUILT package (dist/index.js) over real stdio, the way Claude Desktop, Cursor or
// any stdio client does, and connects an MCP client to it. Shared by the e2e and live suites.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const ENTRY = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

export function assertBuilt(): void {
  if (!existsSync(ENTRY)) throw new Error(`${ENTRY} is missing: run pnpm build before the e2e and live suites.`);
}

export interface Launched {
  client: Client;
  /** Everything the server wrote to stderr so far. */
  stderr(): string;
  /** Transport and protocol errors the client saw (a stray stdout line lands here). */
  protocolErrors: Error[];
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

/**
 * Environment for a child that must never touch this machine's saved sign-in: a fresh HOME and a
 * credentials file nobody wrote.
 */
export function isolatedEnv(extra: Record<string, string>): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), "superflow-mcp-e2e-"));
  return {
    HOME: home,
    USERPROFILE: home,
    SUPERFLOW_CREDENTIALS_STORE: "file",
    SUPERFLOW_CREDENTIALS_FILE: join(home, "credentials.json"),
    ...extra,
  };
}

export async function launch(env: Record<string, string>): Promise<Launched> {
  assertBuilt();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY],
    env: isolatedEnv(env),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const protocolErrors: Error[] = [];
  const client = new Client({ name: "superflow-mcp-e2e", version: "0.0.0" });
  client.onerror = (error) => protocolErrors.push(error);
  await client.connect(transport);
  return {
    client,
    stderr: () => stderr,
    protocolErrors,
    call: async (name, args = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult,
    close: () => client.close(),
  };
}

/** The one JSON line after "Example:" in a tool description. */
export function exampleOf(description: string | undefined): Record<string, unknown> {
  const line = (description ?? "").split("\n").find((l) => l.startsWith("Example:"));
  if (!line) throw new Error("description has no Example line");
  return JSON.parse(line.slice("Example:".length).trim()) as Record<string, unknown>;
}

export function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first && first.type === "text" ? first.text : "";
}
