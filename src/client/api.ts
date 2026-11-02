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

/** The 401 message for a signed-in session (`superflow-mcp login`) instead of an API key. */
export const SESSION_ENDED_MESSAGE = "Your Superflow sign-in expired or was revoked. Run npx superflow-mcp login.";

/** A 403 for a signed-in session: its scopes are fixed, so the way out is a new sign-in. */
export const SESSION_SCOPE_HINT =
  "A sign-in's scopes cannot be changed: run npx superflow-mcp login --scope \"...\" again, naming every scope you need (login --help lists them).";

export interface SuperflowApiErrorInit {
  status: number;
  code: ErrorCode | string;
  message: string;
  hint?: string;
  candidates?: Candidate[];
  preview?: ApiPreview;
  /** Every validation problem when there was more than one (`findings[37].fix_type`). */
  issues?: ApiIssue[];
  /** Why the Checks Engine refused, when it did (`already_verified`, `not_agent_comment`, ...). */
  reason?: string;
  /** The key a write was sent with, when it may still have run: a retry with it is safe. */
  idempotencyKey?: string;
  /** When a rate limit resets (ISO time), from Retry-After. */
  resetAt?: string;
}

/** One validation problem the API listed. */
export interface ApiIssue {
  field: string;
  reason: string;
}

/** An API (or transport) failure in the contract's error shape. */
export class SuperflowApiError extends Error {
  override name = "SuperflowApiError";
  readonly status: number;
  readonly code: string;
  readonly hint: string;
  readonly candidates: Candidate[];
  readonly preview: ApiPreview | undefined;
  readonly issues: ApiIssue[];
  readonly reason: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly resetAt: string | undefined;

  constructor(init: SuperflowApiErrorInit) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.hint = init.hint ?? "";
    this.candidates = init.candidates ?? [];
    this.preview = init.preview;
    this.issues = init.issues ?? [];
    this.reason = init.reason;
    this.idempotencyKey = init.idempotencyKey;
    this.resetAt = init.resetAt;
  }

  toJSON(): {
    code: string;
    message: string;
    hint: string;
    candidates: Candidate[];
    issues?: ApiIssue[];
    reason?: string;
    idempotency_key?: string;
    reset_at?: string;
  } {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      candidates: this.candidates,
      ...(this.issues.length > 0 ? { issues: this.issues } : {}),
      ...(this.reason ? { reason: this.reason } : {}),
      ...(this.idempotencyKey ? { idempotency_key: this.idempotencyKey } : {}),
      ...(this.resetAt ? { reset_at: this.resetAt } : {}),
    };
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
  /**
   * Supplies the Bearer token per request instead of `apiKey`, for a signed-in session
   * (`superflow-mcp login`): access tokens expire after an hour and are refreshed.
   */
  tokenProvider?: TokenProvider;
}

/** Hands the client a current access token, and a new one after a 401. */
export interface TokenProvider {
  /** A token that is valid now (refreshed first when it is about to expire). */
  token(): Promise<string>;
  /** Called once after a 401: a fresh token, or null when the session cannot be renewed. */
  refresh(): Promise<string | null>;
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
  // Addendum: an import writes up to 500 comments.
  "importFindings",
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
    "Check the scopes with superflow_get_me. Scopes cannot be added to an existing key or sign-in: create a key with the scope this needs in Superflow under Settings > Integrations > API keys, or sign in again with npx superflow-mcp login --scope \"...\".",
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

function idempotencyKeyOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const key = (body as { idempotency_key?: unknown }).idempotency_key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

/**
 * What to do after a write whose outcome is unknown (a timeout, a dropped connection, a 5xx):
 * with an idempotency key, repeat it with that key; without one, look before repeating.
 */
export function uncertainWriteHint(idempotencyKey: string | undefined): string {
  return idempotencyKey
    ? `The change may still have gone through. To retry safely, call the tool again with the same arguments and idempotency_key "${idempotencyKey}": the API then returns the first result instead of doing it twice.`
    : "The change may still have gone through. Check first (read the item, or list them) before calling again.";
}

/** Adds the retry guidance and the key to an error from a write that may have run. */
function asUncertainWrite(error: SuperflowApiError, idempotencyKey: string | undefined): SuperflowApiError {
  return new SuperflowApiError({
    status: error.status,
    code: error.code,
    message: error.message,
    hint: [error.hint, uncertainWriteHint(idempotencyKey)].filter(Boolean).join(" "),
    candidates: error.candidates,
    ...(error.preview ? { preview: error.preview } : {}),
    ...(error.issues.length > 0 ? { issues: error.issues } : {}),
    ...(error.reason ? { reason: error.reason } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutOverride: number | undefined;
  private readonly tokenProvider: TokenProvider | undefined;

  constructor(options: ApiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.logger = options.logger ?? silentLogger;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? realSleep;
    this.timeoutOverride = options.timeoutMs;
    this.tokenProvider = options.tokenProvider;
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
      Authorization: `Bearer ${this.tokenProvider ? await this.tokenProvider.token() : this.apiKey}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      // Marks the call as made by this package, so the API's audit log records via: mcp.
      "X-Superflow-Client": USER_AGENT,
    };
    let body: string | undefined;
    if (args.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(args.body);
    }
    // 5xx and network errors are retried only when a repeat cannot double-apply a change.
    const idempotencyKey = method === "GET" ? undefined : idempotencyKeyOf(args.body);
    const safeToRepeat = method === "GET" || (method === "POST" && idempotencyKey !== undefined);

    let refreshed = false;
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
        const failure = new SuperflowApiError({
          status: 0,
          code: "upstream",
          message: timedOut
            ? `The Superflow API did not answer within ${Math.max(1, Math.round(timeoutMs / 1000))} seconds.`
            : `Could not reach the Superflow API at ${new URL(this.baseUrl).host}.`,
          hint: timedOut
            ? method === "GET"
              ? "Try again with narrower filters or a smaller limit."
              : ""
            : "Check the network connection and SUPERFLOW_API_BASE_URL, then try again.",
        });
        // A write that timed out may still be running on the server: say how to retry it safely.
        throw method === "GET" ? failure : asUncertainWrite(failure, idempotencyKey);
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

      if (status === 401 && this.tokenProvider && !refreshed) {
        // A signed-in session's access token expired: renew it once and repeat the call.
        // A 401 was not run, so any method may repeat it.
        refreshed = true;
        const fresh = await this.tokenProvider.refresh();
        if (fresh) {
          headers.Authorization = `Bearer ${fresh}`;
          attempt--;
          continue;
        }
      }
      // A rate-limited request was not run, so any method may repeat it, but only when the
      // wait fits under the cap: a longer one is the caller's to wait out, with the reset time.
      if (status === 429 && attempt < MAX_RETRIES && (retryAfterMs === undefined || retryAfterMs <= RETRY_AFTER_CAP_MS)) {
        await this.sleep(retryAfterMs ?? BACKOFF_MS[attempt] ?? 1500);
        continue;
      }
      if (RETRYABLE_UPSTREAM.has(status) && safeToRepeat && attempt < MAX_RETRIES) {
        await this.sleep(BACKOFF_MS[attempt] ?? 1500);
        continue;
      }
      const error = toApiError(status, text, retryAfterMs, { signedIn: this.tokenProvider !== undefined });
      throw status >= 500 && method !== "GET" ? asUncertainWrite(error, idempotencyKey) : error;
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

/**
 * Maps a non-2xx response to SuperflowApiError, using the contract body when present.
 * `signedIn`: the token came from `superflow-mcp login`, not an API key, so a 401 or 403 says
 * how to sign in again.
 */
export function toApiError(status: number, text: string, retryAfterMs?: number, context: { signedIn?: boolean } = {}): SuperflowApiError {
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
  const issues = Array.isArray(errorBody?.issues)
    ? (errorBody.issues as unknown[])
        .filter((issue): issue is ApiIssue => !!issue && typeof (issue as ApiIssue).field === "string" && typeof (issue as ApiIssue).reason === "string")
        .slice(0, 20)
    : [];

  let message = apiMessage || FALLBACK_MESSAGES[knownCode] || `The Superflow API returned HTTP ${status}.`;
  if (code === "unauthorized") {
    if (!hint && apiMessage && apiMessage !== UNAUTHORIZED_MESSAGE && apiMessage !== SESSION_ENDED_MESSAGE) hint = `The API said: ${apiMessage}`;
    message = context.signedIn ? SESSION_ENDED_MESSAGE : UNAUTHORIZED_MESSAGE;
  }
  let resetAt: string | undefined;
  if (code === "rate_limited" && retryAfterMs !== undefined) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    resetAt = new Date(Date.now() + retryAfterMs).toISOString();
    hint = [hint, `The limit resets in about ${seconds} seconds (${resetAt}). Wait until then before trying again.`].filter(Boolean).join(" ");
  }
  if (code === "forbidden" && context.signedIn) {
    // The fallback hint offers a new key or a new sign-in; a signed-in session needs the second.
    hint = [hint || "Check the scopes with superflow_get_me.", SESSION_SCOPE_HINT].join(" ");
  }
  if (!hint) hint = FALLBACK_HINTS[knownCode] ?? "";

  const reason = typeof errorBody?.reason === "string" && /^[a-z_]{1,64}$/.test(errorBody.reason) ? errorBody.reason : undefined;

  return new SuperflowApiError({
    status,
    code,
    message,
    hint,
    candidates,
    ...(preview ? { preview } : {}),
    ...(issues.length > 0 ? { issues } : {}),
    ...(reason ? { reason } : {}),
    ...(resetAt ? { resetAt } : {}),
  });
}

/** One request to the OAuth server (`superflow-mcp login`, token refresh, revoke). */
export interface OAuthRequest {
  url: string;
  method: "GET" | "POST";
  /** Sent as application/x-www-form-urlencoded (the token and revoke endpoints). */
  form?: Record<string, string>;
  /** Sent as JSON (client registration). */
  json?: unknown;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Sends one OAuth request and returns the status and parsed JSON body (null when the body
 * is empty or not JSON). It lives here so every network call stays in this file. Never
 * logs: the bodies carry codes and tokens.
 */
export async function oauthRequest(request: OAuthRequest): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const fetchImpl = request.fetch ?? ((input: string | URL | Request, init?: RequestInit) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT };
    let body: string | undefined;
    if (request.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(request.form).toString();
    } else if (request.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(request.json);
    }
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      const value: unknown = text ? JSON.parse(text) : null;
      parsed = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}
