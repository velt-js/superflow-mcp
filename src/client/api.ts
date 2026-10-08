// The only module that talks to the network. Everything else calls ApiClient.call().
import { USER_AGENT } from "../version.ts";
import type { Logger } from "../lib/logger.ts";
import { silentLogger } from "../lib/logger.ts";
import { operations } from "./generated/operations.ts";
import type { OperationId } from "./generated/operations.ts";
import type { Candidate } from "./types.ts";

/** The preview a 409 needs_confirmation carries (bulk, or a Phase 2 delete). */
export type ApiPreview = Record<string, unknown>;

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "ambiguous"
  | "needs_confirmation"
  | "rate_limited"
  | "upstream";

export const UNAUTHORIZED_MESSAGE =
  "The Superflow API key was rejected. Create a new key in Superflow under Settings > Integrations > API keys and set SUPERFLOW_API_KEY.";

export interface SuperflowApiErrorInit {
  status: number;
  code: ErrorCode | string;
  message: string;
  hint?: string;
  candidates?: Candidate[];
  preview?: ApiPreview;
}

/** An API (or transport) failure in the contract's error shape. */
export class SuperflowApiError extends Error {
  override name = "SuperflowApiError";
  readonly status: number;
  readonly code: string;
  readonly hint: string;
  readonly candidates: Candidate[];
  readonly preview: ApiPreview | undefined;

  constructor(init: SuperflowApiErrorInit) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.hint = init.hint ?? "";
    this.candidates = init.candidates ?? [];
    this.preview = init.preview;
  }

  toJSON(): { code: string; message: string; hint: string; candidates: Candidate[] } {
    return { code: this.code, message: this.message, hint: this.hint, candidates: this.candidates };
  }
}

export type QueryValue = string | number | boolean | readonly string[] | null | undefined;

export interface RequestArgs {
  path?: Record<string, string>;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export interface ApiClientOptions {
  apiKey: string;
  baseUrl: string;
  logger?: Logger;
  /** Override for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Override for tests. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Per-request timeout in ms. Defaults per operation (30 s, or 60 s for stats, export and bulk). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const SLOW_TIMEOUT_MS = 60_000;
// Operations that scan, fetch a site, or change many comments get 60 s.
const SLOW_OPERATIONS: ReadonlySet<OperationId> = new Set([
  "getCommentStats",
  "exportComments",
  "bulkUpdateComments",
  "createProject",
  "deleteProject",
  "verifyInstall",
  "removePage",
  "removeMember",
  "deleteStatus",
  "deleteTag",
  "mergeTags",
  "getCreditUsage",
  // Phase 3: agent writes call a model, estimates read the sitemap, runs read every
  // execution, findings scan comments, and a push waits up to 20 s for the tracker.
  "createAgent",
  "updateAgent",
  "duplicateAgent",
  "deleteAgent",
  "listAgentPacks",
  "estimateRun",
  "runAgents",
  "getRun",
  "listRunFindings",
  "pushComment",
  "postToSlack",
]);
const MAX_RETRIES = 2;
const BACKOFF_MS = [500, 1500] as const;
const RETRY_AFTER_CAP_MS = 10_000;
const RETRYABLE_UPSTREAM = new Set([502, 503, 504]);

class TimeoutError extends Error {
  override name = "TimeoutError";
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function codeForStatus(status: number, body: unknown, raw: string): ErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) {
    const candidates = (body as { candidates?: unknown } | null)?.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) return "ambiguous";
    return /confirm/i.test(raw) ? "needs_confirmation" : "ambiguous";
  }
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream";
  return "invalid";
}

const FALLBACK_MESSAGES: Record<ErrorCode, string> = {
  unauthorized: UNAUTHORIZED_MESSAGE,
  forbidden: "This Superflow API key is not allowed to do that.",
  not_found: "The Superflow API could not find that.",
  invalid: "The Superflow API rejected the request as invalid.",
  ambiguous: "That name matched more than one item.",
  needs_confirmation: "This change needs confirm: true.",
  rate_limited: "Too many requests to the Superflow API.",
  upstream: "The Superflow API had a problem. Try again in a minute.",
};

const FALLBACK_HINTS: Partial<Record<ErrorCode, string>> = {
  forbidden:
    "Check the key's scopes with superflow_get_me. Change them in Superflow under Settings > Integrations > API keys.",
  ambiguous: "Pick one of the candidates and call again with its id.",
};

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function encodeQueryValue(value: Exclude<QueryValue, null | undefined>): string | undefined {
  if (Array.isArray(value)) {
    const parts = (value as readonly string[]).filter((v) => v !== "");
    return parts.length > 0 ? parts.map((v) => encodeURIComponent(v)).join(",") : undefined;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return encodeURIComponent(String(value));
}

function hasIdempotencyKey(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const key = (body as { idempotency_key?: unknown }).idempotency_key;
  return typeof key === "string" && key.length > 0;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutOverride: number | undefined;

  constructor(options: ApiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.logger = options.logger ?? silentLogger;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? realSleep;
    this.timeoutOverride = options.timeoutMs;
  }

  /** Builds the request URL for an operation: path template filled and URL-encoded, query comma-joined. */
  buildUrl(operationId: OperationId, args: RequestArgs = {}): string {
    const operation = operations[operationId];
    let path: string = operation.path;
    for (const name of operation.pathParams as readonly string[]) {
      const value = args.path?.[name];
      if (value === undefined || value === "") {
        throw new SuperflowApiError({
          status: 0,
          code: "invalid",
          message: `Missing ${name} for ${operationId}.`,
        });
      }
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    }
    const pairs: string[] = [];
    for (const [key, value] of Object.entries(args.query ?? {})) {
      if (value === undefined || value === null) continue;
      const encoded = encodeQueryValue(value);
      if (encoded === undefined) continue;
      pairs.push(`${encodeURIComponent(key)}=${encoded}`);
    }
    return `${this.baseUrl}${path}${pairs.length > 0 ? `?${pairs.join("&")}` : ""}`;
  }

  /** Calls one API operation and returns its parsed JSON body, or throws SuperflowApiError. */
  async call<T = unknown>(operationId: OperationId, args: RequestArgs = {}): Promise<T> {
    const operation = operations[operationId];
    const method: string = operation.method;
    const url = this.buildUrl(operationId, args);
    const timeoutMs = this.timeoutOverride ?? (SLOW_OPERATIONS.has(operationId) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    let body: string | undefined;
    if (args.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(args.body);
    }
    // 5xx and network errors are retried only when a repeat cannot double-apply a change.
    const safeToRepeat = method === "GET" || (method === "POST" && hasIdempotencyKey(args.body));

    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      let status = 0;
      let text = "";
      let retryAfterMs: number | undefined;
      try {
        const result = await this.fetchText(url, { method, headers, body }, timeoutMs);
        status = result.status;
        text = result.text;
        retryAfterMs = parseRetryAfter(result.retryAfter);
      } catch (error) {
        const timedOut = error instanceof TimeoutError;
        this.logger.debug("request failed", {
          method,
          operationId,
          error: timedOut ? "timeout" : "network",
          duration_ms: Date.now() - started,
        });
        // A timeout is not retried: the request may still be running on the server.
        if (!timedOut && safeToRepeat && attempt < MAX_RETRIES) {
          await this.sleep(BACKOFF_MS[attempt] ?? 1500);
          continue;
        }
        throw new SuperflowApiError({
          status: 0,
          code: "upstream",
          message: timedOut
            ? `The Superflow API did not answer within ${Math.max(1, Math.round(timeoutMs / 1000))} seconds.`
            : `Could not reach the Superflow API at ${new URL(this.baseUrl).host}.`,
          hint: timedOut
            ? "Try again with narrower filters or a smaller limit."
            : "Check the network connection and SUPERFLOW_API_BASE_URL, then try again.",
        });
      }

      this.logger.debug("request", { method, operationId, status, duration_ms: Date.now() - started });

      if (status >= 200 && status < 300) {
        if (text.trim() === "") return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new SuperflowApiError({
            status,
            code: "upstream",
            message: "The Superflow API returned a response that is not JSON.",
            hint: "Check SUPERFLOW_API_BASE_URL. It should end with /v1.",
          });
        }
      }

      if (status === 429 && attempt < MAX_RETRIES) {
        // A rate-limited request was not run, so any method may repeat it.
        await this.sleep(Math.min(retryAfterMs ?? BACKOFF_MS[attempt] ?? 1500, RETRY_AFTER_CAP_MS));
        continue;
      }
      if (RETRYABLE_UPSTREAM.has(status) && safeToRepeat && attempt < MAX_RETRIES) {
        await this.sleep(BACKOFF_MS[attempt] ?? 1500);
        continue;
      }
      throw toApiError(status, text, retryAfterMs);
    }
  }

  private async fetchText(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string | undefined },
    timeoutMs: number,
  ): Promise<{ status: number; text: string; retryAfter: string | null }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.status, text, retryAfter: response.headers.get("retry-after") };
    } catch (error) {
      if (timedOut) throw new TimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Maps a non-2xx response to SuperflowApiError, using the contract body when present. */
export function toApiError(status: number, text: string, retryAfterMs?: number): SuperflowApiError {
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const envelope = (parsed as { error?: unknown } | null)?.error;
  const errorBody =
    envelope && typeof envelope === "object" ? (envelope as Record<string, unknown>) : null;

  const code: string =
    typeof errorBody?.code === "string" && errorBody.code
      ? errorBody.code
      : codeForStatus(status, errorBody ?? parsed, text);
  const knownCode = code as ErrorCode;
  const apiMessage = typeof errorBody?.message === "string" ? errorBody.message : "";
  let hint = typeof errorBody?.hint === "string" ? errorBody.hint : "";
  const candidates = Array.isArray(errorBody?.candidates) ? (errorBody.candidates as Candidate[]) : [];
  const preview =
    errorBody?.preview && typeof errorBody.preview === "object" ? (errorBody.preview as ApiPreview) : undefined;

  let message = apiMessage || FALLBACK_MESSAGES[knownCode] || `The Superflow API returned HTTP ${status}.`;
  if (code === "unauthorized") {
    if (!hint && apiMessage && apiMessage !== UNAUTHORIZED_MESSAGE) hint = `The API said: ${apiMessage}`;
    message = UNAUTHORIZED_MESSAGE;
  }
  if (!hint && code === "rate_limited" && retryAfterMs !== undefined) {
    hint = `Wait about ${Math.ceil(retryAfterMs / 1000)} seconds before trying again.`;
  }
  if (!hint) hint = FALLBACK_HINTS[knownCode] ?? "";

  return new SuperflowApiError({ status, code, message, hint, candidates, ...(preview ? { preview } : {}) });
}
