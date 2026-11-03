// A fake of the hosted Superflow MCP server (superflowmcphandler) for the bridge tests: stateless
// Streamable HTTP on localhost with JSON answers and a 405 on GET, like the real one, bearer auth
// (401 with a JSON body), and a few tools, a prompt, resources and completions. It records every
// HTTP request (method, JSON-RPC method, headers) and can fail the next request of a method.
import { type IncomingMessage, createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export const FAKE_INSTRUCTIONS = "Fake hosted instructions: use superflow_list_projects first.";
export const FAKE_PROJECTS = { items: [{ id: "prj_1", name: "Acme Dental" }], next_cursor: null };
export const FAKE_ME = { member: { id: "usr_7", email: "dana@acme.com" }, organization: { id: "org_1", name: "Acme" } };

export interface RecordedRequest {
  method: string;
  /** The JSON-RPC method of a POST (initialize, tools/list, ...). */
  rpc: string | undefined;
  headers: IncomingMessage["headers"];
}

export interface FakeHosted {
  /** The /mcp endpoint, on 127.0.0.1. */
  url: string;
  /** Bearer tokens accepted now. Change it to revoke or rotate a token. */
  validTokens: Set<string>;
  requests: RecordedRequest[];
  /** POSTs of one JSON-RPC method so far. */
  count(rpc: string): number;
  /** Answer the next POST of this JSON-RPC method with this HTTP status, once. */
  failNext(rpc: string, status: number): void;
  /** Hold the next POST of this JSON-RPC method this long before answering it, once (a cold start). */
  delayNext(rpc: string, ms: number): void;
  /** The instructions the next servers answer initialize with. */
  instructions: string;
  close(): Promise<void>;
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

function buildServer(instructions: string): McpServer {
  const server = new McpServer({ name: "superflow-mcp", title: "Superflow", version: "9.9.9" }, { instructions });
  const text = (value: string) => [{ type: "text" as const, text: value }];
  server.registerTool(
    "superflow_list_projects",
    { description: "List projects.", inputSchema: { limit: z.number().optional() }, annotations: READ },
    async () => ({ content: text("Found 1 project."), structuredContent: FAKE_PROJECTS }),
  );
  server.registerTool("superflow_get_me", { description: "Who you are.", inputSchema: {}, annotations: READ }, async () => ({
    content: text("You are dana@acme.com in Acme."),
    structuredContent: FAKE_ME,
  }));
  server.registerTool(
    "superflow_delete_comment",
    { description: "Delete a comment.", inputSchema: { comment: z.string(), confirm: z.boolean().optional() }, annotations: WRITE },
    async () => ({ content: text("Deleted.") }),
  );
  server.registerTool("superflow_failing", { description: "Always fails.", inputSchema: {}, annotations: READ }, async () => ({
    isError: true,
    content: text("Error (not_found): No project \"Nope\"."),
    structuredContent: { error: { code: "not_found", message: 'No project "Nope".', hint: "List the projects.", candidates: [] } },
  }));
  server.registerTool(
    "superflow_slow",
    { description: "Answers after ms.", inputSchema: { ms: z.number() }, annotations: READ },
    async ({ ms }) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { content: text("Done.") };
    },
  );
  server.registerTool("custom_read_tool", { description: "A newer read tool.", inputSchema: {}, annotations: READ }, async () => ({ content: text("read") }));
  server.registerTool("custom_write_tool", { description: "A newer write tool.", inputSchema: {}, annotations: WRITE }, async () => ({ content: text("wrote") }));

  server.registerPrompt(
    "triage",
    {
      title: "Triage",
      description: "One ordered fix list.",
      argsSchema: { project: completable(z.string(), (value) => ["Acme Dental", "Acme Shop"].filter((name) => name.startsWith(value))) },
    },
    ({ project }) => ({ messages: [{ role: "user", content: { type: "text", text: `Triage ${project}.` } }] }),
  );
  server.registerResource("workspace", "superflow://workspace", { mimeType: "application/json" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(FAKE_ME) }],
  }));
  server.registerResource("project", new ResourceTemplate("superflow://projects/{project}", { list: undefined }), { mimeType: "application/json" }, async (uri, { project }) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ project }) }],
  }));
  return server;
}

/** Starts the fake on 127.0.0.1 with a free port. */
export async function startFakeHosted(tokens: string[]): Promise<FakeHosted> {
  const validTokens = new Set(tokens);
  const requests: RecordedRequest[] = [];
  const failures = new Map<string, number>();
  const delays = new Map<string, number>();
  const state = { instructions: FAKE_INSTRUCTIONS };

  const http = createHttpServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    const rpc = body && !Array.isArray(body) ? (body as { method?: string }).method : undefined;
    requests.push({ method: req.method ?? "", rpc, headers: req.headers });
    const json = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(payload));
    };

    if (req.method !== "POST") {
      json(405, { error: "method_not_allowed", message: "Use POST." }, { Allow: "POST, OPTIONS" });
      return;
    }
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!validTokens.has(token)) {
      json(401, { error: "unauthorized", message: "This connector token is not valid." });
      return;
    }
    const forced = rpc ? failures.get(rpc) : undefined;
    if (rpc && forced) {
      failures.delete(rpc);
      json(forced, { error: "internal", message: "The MCP server had a problem." });
      return;
    }
    const delay = rpc ? delays.get(rpc) : undefined;
    if (rpc && delay) {
      delays.delete(rpc);
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (res.destroyed || req.destroyed) return;
    }
    // Per request and stateless, like the real handler (src/superflow-v2/mcp/transport.ts).
    const server = buildServer(state.instructions);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    validTokens,
    requests,
    count: (rpc) => requests.filter((request) => request.method === "POST" && request.rpc === rpc).length,
    failNext: (rpc, status) => void failures.set(rpc, status),
    delayNext: (rpc, ms) => void delays.set(rpc, ms),
    get instructions() {
      return state.instructions;
    },
    set instructions(value: string) {
      state.instructions = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections?.();
        http.close(() => resolve());
      }),
  };
}
