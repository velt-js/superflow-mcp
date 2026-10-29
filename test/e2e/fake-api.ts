// A local stand-in for the Superflow REST API, for the stdio end-to-end suite. It listens on
// 127.0.0.1 (the only plain-http host the package accepts), checks every request against the
// operations generated from the OpenAPI snapshot, records it, and answers it.
//
// Answers come from the responders a test registers (newest first); with none, a generic 200
// body. The generic body is deliberately thin: the suite uses it to prove that every tool turns
// any upstream answer into a well-formed result, never a crash.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { operations } from "../../src/client/generated/operations.ts";
import type { OperationId } from "../../src/client/generated/operations.ts";

export interface FakeRequest {
  method: string;
  /** Pathname after the /v1 base, still URL-encoded. */
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: IncomingMessage["headers"];
  operationId: OperationId | undefined;
}

export interface FakeAnswer {
  status: number;
  /** A string is sent as is (to test non-JSON bodies); anything else as JSON. */
  body?: unknown;
  headers?: Record<string, string>;
}

/** Returns an answer, or undefined to let the next responder (or the default) answer. */
export type FakeResponder = (request: FakeRequest) => FakeAnswer | undefined;

const MATCHERS = (Object.keys(operations) as OperationId[])
  .map((id) => {
    const op = operations[id];
    const pattern = new RegExp(`^${op.path.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    return { id, method: op.method as string, pattern, params: op.pathParams.length };
  })
  // Fixed routes (/comments/stats) must win over templated ones (/comments/{comment}).
  .sort((a, b) => a.params - b.params);

export function operationFor(method: string, path: string): OperationId | undefined {
  return MATCHERS.find((m) => m.method === method && m.pattern.test(path))?.id;
}

/** The generic answer: empty lists, no next page, and nothing else. */
export function genericBody(method: string): Record<string, unknown> {
  return method === "GET" ? { data: [], items: [], has_more: false, next_cursor: null } : {};
}

export class FakeSuperflowApi {
  readonly requests: FakeRequest[] = [];
  /** Requests that match no operation, or send a query param the operation does not declare. */
  readonly violations: string[] = [];
  private responders: FakeResponder[] = [];
  private server: Server | undefined;
  private port = 0;

  private readonly expectedKey: string;

  constructor(expectedKey: string) {
    this.expectedKey = expectedKey;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}/v1`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  /** Adds a responder that wins over every earlier one. */
  respond(responder: FakeResponder): void {
    this.responders.unshift(responder);
  }

  /** Answers one operation with a fixed answer (every call). */
  answer(operationId: OperationId, answer: FakeAnswer): void {
    this.respond((request) => (request.operationId === operationId ? answer : undefined));
  }

  reset(): void {
    this.requests.length = 0;
    this.violations.length = 0;
    this.responders = [];
  }

  /** Requests that change data: everything except GET and the POSTs that only read. */
  writes(): FakeRequest[] {
    return this.requests.filter((r) => r.method !== "GET" && !READ_ONLY_POSTS.has(r.operationId as OperationId));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = (req.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/v1/, "");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
      this.violations.push(`${method} ${path} sent a body that is not JSON`);
    }

    const operationId = operationFor(method, path);
    if (!operationId) {
      this.violations.push(`${method} ${path} matches no operation in the OpenAPI snapshot`);
    } else {
      const allowed = new Set<string>(operations[operationId].queryParams as readonly string[]);
      for (const key of url.searchParams.keys()) {
        if (!allowed.has(key)) this.violations.push(`${operationId} sent undeclared query param "${key}"`);
      }
    }
    if (req.headers.authorization !== `Bearer ${this.expectedKey}`) {
      this.violations.push(`${method} ${path} did not send the configured key as a Bearer token`);
    }

    const request: FakeRequest = {
      method,
      path,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
      headers: req.headers,
      operationId,
    };
    this.requests.push(request);

    let answer: FakeAnswer | undefined;
    for (const responder of this.responders) {
      answer = responder(request);
      if (answer) break;
    }
    answer ??= { status: 200, body: genericBody(method) };
    const payload = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body ?? {});
    res.writeHead(answer.status, {
      "Content-Type": typeof answer.body === "string" ? "text/html" : "application/json",
      ...answer.headers,
    });
    res.end(payload);
  }
}

/**
 * A responder that makes lookups succeed: every GET answers with items built from the string
 * values the tool was called with (so `findOne` finds the tag, project or webhook it was asked
 * about), and an object GET reads as the first of them. Previews then run to the end, which is
 * what a confirmation-gate test needs to be meaningful.
 */
export function echoLookups(args: Record<string, unknown>): FakeResponder {
  const values = Object.values(args).filter((v): v is string => typeof v === "string" && v.length > 0);
  const items = values.map((v, i) => ({
    id: v,
    name: v,
    email: v.includes("@") ? v : `${i}@example.com`,
    url: v,
    page_url: v,
    site_url: v,
    title: v,
    label: v,
    selector: v,
    key: v,
    rule_key: v,
    number: i + 1,
    project: { id: v, name: v },
    mode: "watch",
    test_enabled: false,
    enabled: true,
    events: [],
    agents: [],
    version_history: { enabled: false, frequency: null, hour: null, timezone: null },
  }));
  return (request) =>
    request.method === "GET"
      ? { status: 200, body: { ...(items[0] ?? {}), data: items, items, has_more: false, next_cursor: null } }
      : undefined;
}

/** POST operations that only read, so a confirmation preview may call them. */
export const READ_ONLY_POSTS = new Set<OperationId>(["estimateRun", "connectIntegration"]);

/** The API's error envelope. */
export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): FakeAnswer {
  return { status, body: { error: { code, message, hint: "", candidates: [], ...extra } } };
}
