// Test harness: msw handlers keyed to the contract, a request recorder that checks every
// query parameter against the generated operations, and an in-memory MCP client.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { ApiClient } from "../../src/client/api.ts";
import { operations } from "../../src/client/generated/operations.ts";
import type { OperationId } from "../../src/client/generated/operations.ts";
import type { Config } from "../../src/config.ts";
import { silentLogger } from "../../src/lib/logger.ts";
import { createServer } from "../../src/server.ts";

export const BASE = "https://api.superflow.test/v1";
export const TEST_KEY = "sf_pat_TESTKEY0123456789";

type Method = "get" | "post" | "patch" | "delete";

export interface Recorded {
  method: string;
  /** Raw pathname after the /v1 base, still URL-encoded. */
  path: string;
  url: URL;
  query: Record<string, string>;
  body: unknown;
  headers: Headers;
  operationId: OperationId | undefined;
}

export const recorded: Recorded[] = [];
/** Every request that reached msw, including unhandled ones. */
export const seen: Array<{ method: string; url: string }> = [];
const contractViolations: string[] = [];
const cleanups: Array<() => Promise<void>> = [];

export const mswServer = setupServer();
mswServer.events.on("request:start", ({ request }) => {
  seen.push({ method: request.method, url: request.url });
});

const OPERATION_MATCHERS = (Object.keys(operations) as OperationId[])
  .map((id) => {
    const op = operations[id];
    const pattern = new RegExp(`^${op.path.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    return { id, method: op.method as string, pattern, params: op.pathParams.length };
  })
  // Fixed routes (/comments/stats) must win over templated ones (/comments/{comment}).
  .sort((a, b) => a.params - b.params);

export function operationFor(method: string, path: string): OperationId | undefined {
  return OPERATION_MATCHERS.find((m) => m.method === method && m.pattern.test(path))?.id;
}

export function useMsw(): void {
  beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    mswServer.resetHandlers();
    recorded.length = 0;
    seen.length = 0;
    const violations = contractViolations.splice(0);
    expect(violations, "requests must only use operations and query params from the OpenAPI snapshot").toEqual([]);
  });
  afterAll(() => mswServer.close());
}

async function record(request: Request): Promise<Recorded> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/v1/, "");
  const text = await request.clone().text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  const operationId = operationFor(request.method, path);
  if (!operationId) {
    contractViolations.push(`${request.method} ${path} matches no operation`);
  } else {
    const allowed = new Set<string>(operations[operationId].queryParams as readonly string[]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key)) contractViolations.push(`${operationId} sent undeclared query param "${key}"`);
    }
  }
  const entry: Recorded = {
    method: request.method,
    path,
    url,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
    headers: request.headers,
    operationId,
  };
  recorded.push(entry);
  return entry;
}

export type Responder = (request: Recorded) => Response | Promise<Response>;

/** Registers a handler. Responders are used in order; the last one repeats. */
export function on(method: Method, path: string, ...responders: Responder[]): void {
  let calls = 0;
  mswServer.use(
    http[method](`${BASE}${path}`, async ({ request }) => {
      const entry = await record(request);
      const responder = responders[Math.min(calls, responders.length - 1)];
      calls += 1;
      if (!responder) return HttpResponse.json({}, { status: 500 });
      return responder(entry);
    }),
  );
}

export const ok =
  (body: unknown, status = 200, headers: Record<string, string> = {}): Responder =>
  () =>
    HttpResponse.json(body as Record<string, unknown>, { status, headers });

export const fail =
  (status: number, error: Record<string, unknown>, headers: Record<string, string> = {}): Responder =>
  () =>
    HttpResponse.json(
      { error: { hint: "", candidates: [], ...error } },
      { status, headers: { ...(status === 429 ? { "Retry-After": "2" } : {}), ...headers } },
    );

export const rateLimited = fail(429, { code: "rate_limited", message: "Rate limit reached: 600 requests per minute." });

export interface Harness {
  client: Client;
  api: ApiClient;
  sleeps: number[];
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
}

export interface HarnessOptions {
  readOnly?: boolean;
  defaultProject?: string;
}

export function testConfig(options: HarnessOptions = {}): Config {
  return {
    apiKey: TEST_KEY,
    baseUrl: BASE,
    defaultProject: options.defaultProject,
    readOnly: options.readOnly ?? false,
    logLevel: "silent",
  };
}

/** Builds the real server around an ApiClient whose sleeps are recorded, not waited. */
export async function connect(options: HarnessOptions = {}): Promise<Harness> {
  const sleeps: number[] = [];
  const config = testConfig(options);
  const api = new ApiClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    logger: silentLogger,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  const server = createServer({ config, client: api, logger: silentLogger });
  const client = new Client({ name: "superflow-mcp-tests", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return {
    client,
    api,
    sleeps,
    call: async (name, args = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult,
  };
}

export function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first && first.type === "text" ? first.text : "";
}

export function summaryOf(result: CallToolResult): string {
  return textOf(result).split("\n")[0] ?? "";
}

export function data<T = Record<string, unknown>>(result: CallToolResult): T {
  return result.structuredContent as T;
}

export function errorOf(result: CallToolResult): { code: string; message: string; hint: string; candidates: unknown[] } {
  expect(result.isError).toBe(true);
  return (result.structuredContent as { error: { code: string; message: string; hint: string; candidates: unknown[] } }).error;
}

/** Methods that change data. */
export function writes(): Array<{ method: string; url: string }> {
  return seen.filter((r) => r.method !== "GET");
}

export interface StandardCaseOptions {
  tool: string;
  args: Record<string, unknown>;
  method: Method;
  path: string;
  success: Responder;
  harness?: HarnessOptions;
}

/**
 * Error behavior every tool must share: ambiguous candidates surfaced, not_found as a
 * tool error, rate limit retried then succeeded, and retries exhausted.
 */
export function standardErrorCases(options: StandardCaseOptions): void {
  const { tool, args, method, path, success } = options;

  it("surfaces ambiguous candidates as a tool error", async () => {
    on(method, path, fail(409, {
      code: "ambiguous",
      message: 'The project "Acme" matches 2 projects.',
      hint: "Pick one of the candidates and call again with its id.",
      candidates: [
        { id: "prj_1a2b", name: "Acme Dental" },
        { id: "prj_3c4d", name: "Acme Labs" },
      ],
    }));
    const h = await connect(options.harness);
    const result = await h.call(tool, args);
    const error = errorOf(result);
    expect(error.code).toBe("ambiguous");
    expect(error.candidates).toHaveLength(2);
    expect(summaryOf(result)).toContain("Error (ambiguous)");
    expect(summaryOf(result)).toContain("Acme Labs (prj_3c4d)");
  });

  it("returns not_found as a tool error with the API hint", async () => {
    on(method, path, fail(404, { code: "not_found", message: "No comment #4821 in project Acme Dental.", hint: "List comments first." }));
    const h = await connect(options.harness);
    const result = await h.call(tool, args);
    const error = errorOf(result);
    expect(error).toEqual({
      code: "not_found",
      message: "No comment #4821 in project Acme Dental.",
      hint: "List comments first.",
      candidates: [],
    });
    expect(textOf(result)).toContain('"code": "not_found"');
  });

  it("retries after rate_limited and then succeeds", async () => {
    on(method, path, rateLimited, success);
    const h = await connect(options.harness);
    const result = await h.call(tool, args);
    expect(result.isError).toBeFalsy();
    expect(recorded.filter((r) => r.path === recorded[0]?.path)).toHaveLength(2);
    expect(h.sleeps).toEqual([2000]);
  });

  it("gives up after two retries when still rate limited", async () => {
    on(method, path, rateLimited);
    const h = await connect(options.harness);
    const result = await h.call(tool, args);
    expect(errorOf(result).code).toBe("rate_limited");
    expect(recorded).toHaveLength(3);
    expect(h.sleeps).toEqual([2000, 2000]);
  });
}
