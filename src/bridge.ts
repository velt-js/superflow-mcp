// The stdio bridge. `npx -y @usesuperflow/mcp` serves the hosted Superflow MCP server
// (https://mcp.usesuperflow.ai/mcp) over stdio: every request goes to the hosted endpoint over
// Streamable HTTP with the user's API key or sign-in, so the npm package and the hosted connector
// are one server with the same tools, prompts and resources. Results and errors pass through
// unchanged. The bridge only adds the bearer token (refreshing a sign-in once after a 401), the
// read-only filter (SUPERFLOW_READ_ONLY) and clear messages when the hosted server cannot answer.
//
// Not part of the library entry (src/lib.ts): the hosted server runs the tools in process and
// never loads this file.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  type Implementation,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  type ListToolsResult,
  McpError,
  PromptListChangedNotificationSchema,
  ReadResourceRequestSchema,
  ResourceListChangedNotificationSchema,
  ResultSchema,
  type ServerCapabilities,
  type Tool,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SESSION_ENDED_MESSAGE, type TokenProvider, UNAUTHORIZED_MESSAGE, bearerFetch } from "./client/api.ts";
import { errorResult } from "./lib/format.ts";
import type { Logger } from "./lib/logger.ts";
import { silentLogger } from "./lib/logger.ts";
import { NPX_COMMAND } from "./target.ts";
import { TOOL_NAMES, WRITE_TOOL_NAMES } from "./tools/index.ts";
import { PACKAGE_NAME, USER_AGENT, VERSION } from "./version.ts";

/**
 * How long one tool call may take. The longest tool on the hosted server is a tag rewrite (its
 * API call gets 90 s, the API allows 120 s); a preview can make a second call, and a cold start
 * adds a few seconds. The hosted function itself stops at 300 s.
 */
export const TOOL_CALL_TIMEOUT_MS = 150_000;
/** Every other request (lists, reads, prompts, completions). */
export const REQUEST_TIMEOUT_MS = 60_000;
/**
 * The hosted initialize, tried twice at most, before stdio connects. 20 s each keeps a cold start
 * inside the start-up timeouts of MCP clients (30 s and more): staging measured 17.5 s cold, prod
 * keeps a warm instance, and a first try that timed out leaves the instance warm for the second.
 */
export const INITIALIZE_TIMEOUT_MS = 20_000;

/** The package's own read-only line (src/server.ts); the hosted server uses it when it sees X-Superflow-Read-Only. */
export const READ_ONLY_LINE = "This server is read-only: write tools are not available.";

/** What the bridge always adds in read-only mode: whose choice it is, and how to make a change. */
export const READ_ONLY_CHOICE =
  "Read-only mode is on in this machine's settings (SUPERFLOW_READ_ONLY=true): to make a change, the user turns it off, or makes the change in Superflow.";

/**
 * Added when the hosted text tells the user to reconnect (it does when the key or sign-in itself
 * cannot write): then both steps are needed, and the note says so instead of contradicting it.
 */
export const READ_ONLY_RECONNECT =
  `The key or sign-in can only read as well: for changes the user also needs one that may write (a key with write scopes, or ${NPX_COMMAND} login again allowing the write permissions).`;

export interface BridgeOptions {
  /** The hosted MCP endpoint, for example https://mcp.usesuperflow.ai/mcp. */
  url: string;
  /** The bearer token: an API key, or a signed-in session that refreshes itself. */
  tokens: TokenProvider;
  /** True for a sign-in (`@usesuperflow/mcp login`), false for an API key: picks the 401 message. */
  signedIn: boolean;
  /** SUPERFLOW_READ_ONLY: list and allow only the tools that read. */
  readOnly: boolean;
  logger?: Logger;
  /** Override for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  toolTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** Override for tests. Defaults to INITIALIZE_TIMEOUT_MS. */
  initializeTimeoutMs?: number;
}

/** A token provider for an API key: the same token every time, nothing to refresh. */
export function staticToken(token: string): TokenProvider {
  return { token: async () => token, refresh: async () => null };
}

/** Why the hosted server did not answer, in words for the user. Never carries a token. */
export class BridgeError extends Error {
  override name = "BridgeError";
  readonly code: "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "upstream";
  readonly hint: string;
  /** True when repeating the same request may work (the network, a 5xx, a closed connection). */
  readonly retryable: boolean;

  constructor(init: { code: BridgeError["code"]; message: string; hint?: string; retryable?: boolean }) {
    super(init.message);
    this.code = init.code;
    this.hint = init.hint ?? "";
    this.retryable = init.retryable ?? false;
  }

  /** One line for stderr at start: the message and what to do. */
  describe(): string {
    return this.hint ? `${this.message} ${this.hint}` : this.message;
  }
}

/** An error the hosted server answered (JSON-RPC), passed on with its own code, message and data. */
class UpstreamProtocolError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/** The message the hosted server sent in an HTTP error body ({ error, message }), if any. */
function bodyMessage(error: StreamableHTTPError): string {
  const json = /\{[\s\S]*\}\s*$/.exec(error.message)?.[0];
  if (!json) return "";
  try {
    const body = JSON.parse(json) as { message?: unknown; error?: unknown };
    if (typeof body.message === "string") return body.message;
    if (body.error && typeof body.error === "object" && typeof (body.error as { message?: unknown }).message === "string") {
      return (body.error as { message: string }).message;
    }
  } catch {
    // Not JSON: no message to quote.
  }
  return "";
}

/**
 * Turns what a request to the hosted server threw into a BridgeError, or undefined when the
 * hosted server answered with a JSON-RPC error (that one passes through unchanged).
 */
export function bridgeFailure(error: unknown, options: Pick<BridgeOptions, "url" | "signedIn">, timeoutMs: number): BridgeError | undefined {
  const host = hostOf(options.url);
  if (error instanceof BridgeError) return error;
  if (error instanceof StreamableHTTPError) {
    const status = error.code ?? 0;
    const said = bodyMessage(error);
    if (status === 401) {
      return options.signedIn
        ? new BridgeError({ code: "unauthorized", message: SESSION_ENDED_MESSAGE })
        : new BridgeError({
            code: "unauthorized",
            message: UNAUTHORIZED_MESSAGE,
            hint: `Or unset SUPERFLOW_API_KEY and run ${NPX_COMMAND} login to sign in in the browser.`,
          });
    }
    if (status === 403) {
      return new BridgeError({
        code: "forbidden",
        message: said || "Superflow refused this key or sign-in.",
        hint: "Check its scopes with superflow_get_me, or create a key with the scopes you need in Superflow under Settings > Integrations > API keys.",
      });
    }
    if (status === 429) {
      return new BridgeError({
        code: "rate_limited",
        message: said || "Too many requests to the Superflow MCP server.",
        hint: "It allows 60 requests a minute per key or sign-in. Wait a minute, then try again.",
      });
    }
    if (status === 404) {
      return new BridgeError({ code: "not_found", message: `No Superflow MCP server answers at ${options.url}.`, hint: "Check SUPERFLOW_MCP_URL." });
    }
    return new BridgeError({
      code: "upstream",
      message: `The Superflow MCP server at ${host} had a problem${status > 0 ? ` (HTTP ${status})` : ""}.`,
      hint: "Try again in a minute.",
      retryable: status >= 500 || status <= 0,
    });
  }
  if (error instanceof McpError) {
    if (error.code === ErrorCode.RequestTimeout) {
      return new BridgeError({
        code: "upstream",
        message: `The Superflow MCP server at ${host} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
      });
    }
    if (error.code === ErrorCode.ConnectionClosed) {
      return new BridgeError({ code: "upstream", message: `The connection to the Superflow MCP server at ${host} closed.`, retryable: true });
    }
    return undefined;
  }
  // fetch rejects with a TypeError when the host cannot be reached (DNS, refused, reset).
  const reason = error instanceof Error ? ((error.cause as { code?: string } | undefined)?.code ?? error.message) : String(error);
  return new BridgeError({
    code: "upstream",
    message: `Could not reach the Superflow MCP server at ${host} (${reason}).`,
    hint: "Check the network connection, or SUPERFLOW_MCP_URL.",
    retryable: true,
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The local copy of a JSON-RPC error from the hosted server: its code, message (without the SDK's prefix) and data. */
function passThrough(error: McpError): UpstreamProtocolError {
  return new UpstreamProtocolError(error.code, error.message.replace(/^MCP error -?\d+:\s*/, ""), error.data);
}

/** What a request handler throws: the hosted server's own JSON-RPC error, or one the bridge words. */
function protocolError(error: unknown, options: BridgeOptions, timeoutMs: number): Error {
  const failure = bridgeFailure(error, options, timeoutMs);
  if (!failure) return passThrough(error as McpError);
  return new McpError(ErrorCode.InternalError, failure.describe());
}

/** Request params as the local client sent them, minus its progress token (the hosted server's would not match). */
function forwardedParams(params: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const meta = params._meta as Record<string, unknown> | undefined;
  if (!meta || !("progressToken" in meta)) return params;
  const { progressToken: _dropped, ...rest } = meta;
  return { ...params, _meta: rest };
}

const READ_TOOLS: ReadonlySet<string> = new Set(TOOL_NAMES.filter((name) => !WRITE_TOOL_NAMES.includes(name)));
const WRITE_TOOLS: ReadonlySet<string> = new Set(WRITE_TOOL_NAMES);

/**
 * Whether a tool only reads: the package's own list first; a tool the package does not know
 * (a newer hosted version) reads only when the hosted server marks it readOnlyHint.
 */
export function isReadTool(tool: Pick<Tool, "name" | "annotations">): boolean {
  if (READ_TOOLS.has(tool.name)) return true;
  if (WRITE_TOOLS.has(tool.name)) return false;
  return tool.annotations?.readOnlyHint === true;
}

/** The connection to the hosted server: one MCP client, made again if it closes. */
class Hosted {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;
  /** Called when the hosted server says a list changed, to tell the local client too. */
  onListChanged: ((kind: "tools" | "prompts" | "resources") => void) | undefined;

  private readonly options: BridgeOptions;

  constructor(options: BridgeOptions) {
    this.options = options;
  }

  private get logger(): Logger {
    return this.options.logger ?? silentLogger;
  }

  /** fetch with the bearer token and the client headers; after a 401, one renewal and one retry (src/client/api.ts). */
  private authorizedFetch(): typeof fetch {
    return bearerFetch({
      tokens: this.options.tokens,
      headers: {
        "User-Agent": USER_AGENT,
        // Tells the hosted server this is the npm package's bridge (its analytics and logs).
        "X-Superflow-Client": USER_AGENT,
        // Tells the hosted server the user chose read-only mode. Whatever it does with it, the
        // bridge filters the tool list and refuses write tools itself.
        ...(this.options.readOnly ? { "X-Superflow-Read-Only": "true" } : {}),
      },
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      logger: this.logger,
    });
  }

  /**
   * Connects (initialize), 20 s a try. A first try that timed out (a cold start), hit the
   * network or a 5xx is tried once more; a refused key or sign-in is not.
   */
  async connect(): Promise<Client> {
    const timeout = this.initializeTimeoutMs;
    try {
      return await this.connectOnce();
    } catch (error) {
      const failure = bridgeFailure(error, this.options, timeout);
      const timedOut = error instanceof McpError && error.code === ErrorCode.RequestTimeout;
      if (!failure || !(failure.retryable || timedOut)) throw failure ?? error;
      this.logger.debug("bridge: connecting again after a failed first try", { reason: failure.message });
      try {
        return await this.connectOnce();
      } catch (again) {
        throw bridgeFailure(again, this.options, timeout) ?? again;
      }
    }
  }

  private get initializeTimeoutMs(): number {
    return this.options.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS;
  }

  private async connectOnce(): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(this.options.url), { fetch: this.authorizedFetch() });
    const client = new Client({ name: PACKAGE_NAME, version: VERSION }, { capabilities: {} });
    client.onerror = (error) => this.logger.debug("bridge: transport error", { message: error.message });
    client.onclose = () => {
      if (this.client === client) this.client = undefined;
    };
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => this.onListChanged?.("tools"));
    client.setNotificationHandler(PromptListChangedNotificationSchema, async () => this.onListChanged?.("prompts"));
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => this.onListChanged?.("resources"));
    try {
      await client.connect(transport, { timeout: this.initializeTimeoutMs });
    } catch (error) {
      // Abort the request still in flight (a timeout) before a second try.
      await client.close().catch(() => undefined);
      throw error;
    }
    this.client = client;
    return client;
  }

  /** The connected client, connecting again when the last one closed. */
  current(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    this.connecting ??= this.connect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  /**
   * Sends one request and returns the hosted server's result unchanged. `retry` (lists and
   * reads only, never a tool call: it may write) sends it once more after a network failure,
   * a 5xx or a closed connection.
   */
  async request(method: string, params: Record<string, unknown> | undefined, options: { timeout: number; signal?: AbortSignal; retry: boolean }) {
    const attempt = async () => {
      const client = await this.current();
      return client.request({ method, ...(params ? { params } : {}) } as never, ResultSchema, { timeout: options.timeout, ...(options.signal ? { signal: options.signal } : {}) });
    };
    try {
      return await attempt();
    } catch (error) {
      const failure = bridgeFailure(error, this.options, options.timeout);
      if (!options.retry || !failure?.retryable || options.signal?.aborted) throw error;
      this.logger.debug("bridge: sending again after a failure", { method, reason: failure.message });
      return attempt();
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.close().catch(() => undefined);
  }
}

/** The local server's capabilities: what the hosted server offers, minus subscriptions and logging. */
function mirrorCapabilities(upstream: ServerCapabilities | undefined): ServerCapabilities {
  const capabilities: ServerCapabilities = {};
  if (upstream?.tools) capabilities.tools = upstream.tools.listChanged ? { listChanged: true } : {};
  if (upstream?.prompts) capabilities.prompts = upstream.prompts.listChanged ? { listChanged: true } : {};
  if (upstream?.resources) capabilities.resources = upstream.resources.listChanged ? { listChanged: true } : {};
  if (upstream?.completions) capabilities.completions = {};
  return capabilities;
}

/**
 * The hosted server's instructions; in read-only mode the bridge's own note always follows them,
 * without repeating the read-only line the hosted text already has, and agreeing with any advice
 * there to reconnect (that advice means the key or sign-in itself is read-only too).
 */
export function bridgeInstructions(upstream: string | undefined, readOnly: boolean): string | undefined {
  if (!readOnly) return upstream;
  const text = upstream ?? "";
  const lines = [
    text,
    // The hosted text says it already, in stdio wording or in its own ("This connection is ...").
    !/read-only: write tools are not available/i.test(text) && READ_ONLY_LINE,
    READ_ONLY_CHOICE,
    /reconnect/i.test(text) && READ_ONLY_RECONNECT,
  ];
  return lines.filter((line): line is string => typeof line === "string" && line !== "").join("\n");
}

/** The refusal of a write tool in read-only mode, worded like the package's own (src/server.ts). */
function readOnlyRefusal(name: string): CallToolResult {
  return errorResult({
    code: "forbidden",
    message: `${name} changes data, and this server is read-only (SUPERFLOW_READ_ONLY=true).`,
    hint: "Tell the user the change cannot be made from here. They can make it in Superflow, or turn off read-only mode.",
    candidates: [],
  });
}

export interface Bridge {
  /** The local MCP server to connect to stdio. */
  server: Server;
  /** What the hosted server said it is (name, version). */
  hostedInfo: Implementation | undefined;
  close(): Promise<void>;
}

/**
 * Connects to the hosted server and builds the local server that forwards to it. Throws a
 * BridgeError when the hosted server cannot be reached or refuses the key or sign-in, so the
 * CLI can say why before any client connects.
 */
export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const hosted = new Hosted(options);
  const client = await hosted.connect();
  const hostedInfo = client.getServerVersion();
  const capabilities = mirrorCapabilities(client.getServerCapabilities());
  const instructions = bridgeInstructions(client.getInstructions(), options.readOnly);
  const server = new Server(hostedInfo ?? { name: PACKAGE_NAME, version: VERSION }, { capabilities, ...(instructions ? { instructions } : {}) });
  const requestTimeout = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const toolTimeout = options.toolTimeoutMs ?? TOOL_CALL_TIMEOUT_MS;
  // The tools the hosted server listed last, to judge a tool call the package does not know.
  const listed = new Map<string, Tool>();

  const forward = (method: string, retry = true) =>
    async (request: { params?: Record<string, unknown> }, extra: { signal: AbortSignal }) => {
      try {
        return await hosted.request(method, forwardedParams(request.params), { timeout: requestTimeout, signal: extra.signal, retry });
      } catch (error) {
        throw protocolError(error, options, requestTimeout);
      }
    };

  if (capabilities.tools) {
    server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
      const result = (await forward("tools/list")(request, extra)) as ListToolsResult;
      for (const tool of result.tools ?? []) listed.set(tool.name, tool);
      if (!options.readOnly) return result;
      return { ...result, tools: (result.tools ?? []).filter(isReadTool) };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const name = request.params.name;
      if (options.readOnly && !READ_TOOLS.has(name)) {
        if (WRITE_TOOLS.has(name)) return readOnlyRefusal(name);
        // A tool the package does not know: judge it by the hosted server's own list.
        if (!listed.has(name)) {
          try {
            const result = (await hosted.request("tools/list", undefined, { timeout: requestTimeout, retry: true })) as ListToolsResult;
            for (const tool of result.tools ?? []) listed.set(tool.name, tool);
          } catch {
            return readOnlyRefusal(name);
          }
        }
        const tool = listed.get(name);
        // Refuse what writes; a name the hosted server does not list goes on, and it answers that.
        if (tool && !isReadTool(tool)) return readOnlyRefusal(name);
      }
      try {
        // Never sent twice: a tool call may write.
        return (await hosted.request("tools/call", forwardedParams(request.params as Record<string, unknown>), {
          timeout: toolTimeout,
          signal: extra.signal,
          retry: false,
        })) as CallToolResult;
      } catch (error) {
        const failure = bridgeFailure(error, options, toolTimeout);
        if (!failure) throw passThrough(error as McpError);
        const unsure = failure.code === "upstream";
        return errorResult({
          code: failure.code,
          message: failure.message,
          hint: unsure
            ? "The call may still have gone through on the server: check before repeating a change (read it back with a list or get tool). A read can be repeated."
            : failure.hint,
          candidates: [],
        });
      }
    });
  }

  if (capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, forward("prompts/list") as never);
    server.setRequestHandler(GetPromptRequestSchema, forward("prompts/get") as never);
  }
  if (capabilities.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, forward("resources/list") as never);
    server.setRequestHandler(ListResourceTemplatesRequestSchema, forward("resources/templates/list") as never);
    server.setRequestHandler(ReadResourceRequestSchema, forward("resources/read") as never);
  }
  if (capabilities.completions) {
    server.setRequestHandler(CompleteRequestSchema, forward("completion/complete") as never);
  }

  // The hosted endpoint is stateless (no stream from server to client), so these rarely fire;
  // when they do, the local client hears about it too.
  hosted.onListChanged = (kind) => {
    const send = kind === "tools" ? server.sendToolListChanged() : kind === "prompts" ? server.sendPromptListChanged() : server.sendResourceListChanged();
    void Promise.resolve(send).catch(() => undefined);
  };

  return {
    server,
    hostedInfo,
    close: async () => {
      await hosted.close();
      await server.close().catch(() => undefined);
    },
  };
}

/**
 * Calls one tool on the hosted server and closes the connection: `login` uses it to say who
 * signed in. Undefined when the call fails or the tool is not there.
 */
export async function callHostedTool(
  options: Omit<BridgeOptions, "readOnly" | "signedIn">,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult | undefined> {
  const hosted = new Hosted({ ...options, readOnly: false, signedIn: true });
  try {
    await hosted.connect();
    return (await hosted.request("tools/call", { name, arguments: args }, { timeout: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, retry: false })) as CallToolResult;
  } catch {
    return undefined;
  } finally {
    await hosted.close();
  }
}
