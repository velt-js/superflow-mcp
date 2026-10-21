import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, SuperflowApiError, UNAUTHORIZED_MESSAGE, toApiError } from "../../src/client/api.ts";
import { createLogger, redact } from "../../src/lib/logger.ts";
import { VERSION } from "../../src/version.ts";
import { BASE, TEST_KEY, fail, ok, on, recorded, useMsw } from "../helpers/harness.ts";

useMsw();

function client(overrides: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}) {
  const sleeps: number[] = [];
  const api = new ApiClient({
    apiKey: TEST_KEY,
    baseUrl: BASE,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...overrides,
  });
  return { api, sleeps };
}

async function rejection(promise: Promise<unknown>): Promise<SuperflowApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SuperflowApiError);
    return error as SuperflowApiError;
  }
  throw new Error("expected the call to fail");
}

/** A fetch that answers with the given responses in order (the last one repeats). */
function scriptedFetch(...steps: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (!step) throw new Error("no step");
    return step();
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ApiClient headers", () => {
  it("sends bearer auth, Accept and the superflow-mcp User-Agent", async () => {
    on("get", "/me", ok({}));
    await client().api.call("getMe");
    const headers = recorded[0]?.headers;
    expect(headers?.get("authorization")).toBe(`Bearer ${TEST_KEY}`);
    expect(headers?.get("accept")).toBe("application/json");
    expect(headers?.get("user-agent")).toBe(`superflow-mcp/${VERSION}`);
    expect(headers?.get("content-type")).toBeNull();
  });

  it("sends JSON bodies with a content type", async () => {
    on("post", "/comments/:comment/resolve", ok({ changed: true }));
    await client().api.call("resolveComment", { path: { comment: "cmt_1" }, body: { note: "done" } });
    expect(recorded[0]?.headers.get("content-type")).toBe("application/json");
    expect(recorded[0]?.body).toEqual({ note: "done" });
  });
});

describe("ApiClient URL building", () => {
  const { api } = client();

  it("comma-joins arrays, writes booleans and numbers, and drops empty values", () => {
    const url = api.buildUrl("listComments", {
      query: {
        status: ["open", "In progress"],
        tags: [],
        has_replies: false,
        unanswered: true,
        limit: 25,
        project: undefined,
        cursor: null,
        query: "a&b=c",
      },
    });
    expect(url).toBe(`${BASE}/comments?status=open,In%20progress&has_replies=false&unanswered=true&limit=25&query=a%26b%3Dc`);
  });

  it("encodes a comma inside one array value so it is not split", () => {
    expect(api.buildUrl("listComments", { query: { tags: ["copy, legal", "seo"] } })).toBe(
      `${BASE}/comments?tags=copy%2C%20legal,seo`,
    );
  });

  it("URL-encodes path parameters", () => {
    expect(api.buildUrl("listProjectPages", { path: { project: "Acme Dental/EU" } })).toBe(
      `${BASE}/projects/Acme%20Dental%2FEU/pages`,
    );
    expect(api.buildUrl("getComment", { path: { comment: "#4821" } })).toBe(`${BASE}/comments/%234821`);
  });

  it("refuses to build a URL with a missing path parameter", () => {
    expect(() => api.buildUrl("getComment", {})).toThrow(/Missing comment/);
  });
});

describe("ApiClient retries", () => {
  it("honors Retry-After on 429 and caps it at 10 seconds", async () => {
    on("get", "/me", fail(429, { code: "rate_limited", message: "slow down" }, { "Retry-After": "120" }), ok({ ok: 1 }));
    const { api, sleeps } = client();
    await expect(api.call("getMe")).resolves.toEqual({ ok: 1 });
    expect(sleeps).toEqual([10_000]);
  });

  it("backs off 500 ms then 1500 ms on 429 without Retry-After, then fails with a hint", async () => {
    on("get", "/me", () => new Response("", { status: 429 }));
    const { api, sleeps } = client();
    const error = await rejection(api.call("getMe"));
    expect(error.code).toBe("rate_limited");
    expect(sleeps).toEqual([500, 1500]);
    expect(recorded).toHaveLength(3);
  });

  it("retries 429 on writes too, because the API did not run the request", async () => {
    on("patch", "/comments/:comment", fail(429, { code: "rate_limited", message: "slow" }), ok({ id: "cmt_1" }));
    const { api } = client();
    await expect(api.call("updateComment", { path: { comment: "cmt_1" }, body: { priority: "low" } })).resolves.toEqual({ id: "cmt_1" });
    expect(recorded).toHaveLength(2);
  });

  it("retries GETs on 502, 503 and 504 with 500 ms then 1500 ms backoff", async () => {
    on(
      "get",
      "/me",
      () => new Response("", { status: 502 }),
      () => new Response("", { status: 504 }),
      ok({ ok: true }),
    );
    const { api, sleeps } = client();
    await expect(api.call("getMe")).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([500, 1500]);
  });

  it("gives up on a GET after two 503 retries with code upstream", async () => {
    on("get", "/me", () => new Response("", { status: 503 }));
    const { api } = client();
    const error = await rejection(api.call("getMe"));
    expect(error.code).toBe("upstream");
    expect(recorded).toHaveLength(3);
  });

  it("does not retry a POST without an idempotency key on 503", async () => {
    on("post", "/comments/:comment/resolve", () => new Response("", { status: 503 }));
    const { api, sleeps } = client();
    const error = await rejection(api.call("resolveComment", { path: { comment: "cmt_1" }, body: {} }));
    expect(error.code).toBe("upstream");
    expect(recorded).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("retries a POST that carries an idempotency key on 503", async () => {
    on("post", "/comments", () => new Response("", { status: 503 }), ok({ id: "cmt_1" }, 201));
    const { api } = client();
    await expect(api.call("createComment", { body: { text: "x", idempotency_key: "k1" } })).resolves.toEqual({ id: "cmt_1" });
    expect(recorded).toHaveLength(2);
  });

  it("retries GETs on network errors and maps the final failure to upstream", async () => {
    const scripted = scriptedFetch(() => {
      throw new TypeError("fetch failed");
    });
    const { api, sleeps } = client({ fetch: scripted.fetch });
    const error = await rejection(api.call("getMe"));
    expect(error.code).toBe("upstream");
    expect(error.message).toContain("Could not reach the Superflow API");
    expect(scripted.calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1500]);
  });

  it("does not retry a DELETE on a network error", async () => {
    const scripted = scriptedFetch(() => {
      throw new TypeError("fetch failed");
    });
    const { api } = client({ fetch: scripted.fetch });
    await rejection(api.call("deleteReply", { path: { reply: "rpl_a.b" } }));
    expect(scripted.calls).toHaveLength(1);
  });
});

describe("ApiClient timeouts", () => {
  function hangingFetch() {
    const calls: number[] = [];
    const fn = (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        calls.push(Date.now());
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    return { fetch: fn as unknown as typeof fetch, calls };
  }

  it("times out after 30 s and does not retry", async () => {
    vi.useFakeTimers();
    const hanging = hangingFetch();
    const { api } = client({ fetch: hanging.fetch });
    const pending = rejection(api.call("getMe"));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(hanging.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(error.code).toBe("upstream");
    expect(error.message).toBe("The Superflow API did not answer within 30 seconds.");
    expect(hanging.calls).toHaveLength(1);
  });

  it("allows 60 s for stats, export and bulk", async () => {
    vi.useFakeTimers();
    for (const operationId of ["getCommentStats", "exportComments", "bulkUpdateComments"] as const) {
      const hanging = hangingFetch();
      const { api } = client({ fetch: hanging.fetch });
      let settled = false;
      const pending = rejection(api.call(operationId, { body: operationId === "bulkUpdateComments" ? {} : undefined })).finally(
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      const error = await pending;
      expect(error.message).toBe("The Superflow API did not answer within 60 seconds.");
    }
  });

  it("uses a timeout override when given", async () => {
    vi.useFakeTimers();
    const hanging = hangingFetch();
    const { api } = client({ fetch: hanging.fetch, timeoutMs: 100 });
    const pending = rejection(api.call("getMe"));
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).code).toBe("upstream");
  });
});

describe("error mapping", () => {
  it("uses the contract body when present", () => {
    const error = toApiError(
      409,
      JSON.stringify({ error: { code: "ambiguous", message: "Two matches.", hint: "Pick one.", candidates: [{ id: "a", name: "A" }] } }),
    );
    expect(error.toJSON()).toEqual({ code: "ambiguous", message: "Two matches.", hint: "Pick one.", candidates: [{ id: "a", name: "A" }] });
  });

  it.each([
    [401, "", "unauthorized"],
    [403, "", "forbidden"],
    [404, "<html>nope</html>", "not_found"],
    [409, JSON.stringify({ candidates: [{ id: "x", name: "X" }] }), "ambiguous"],
    [409, JSON.stringify({ message: "needs confirm: true" }), "needs_confirmation"],
    [429, "", "rate_limited"],
    [500, "", "upstream"],
    [503, "oops", "upstream"],
    [400, "", "invalid"],
    [422, "", "invalid"],
  ])("maps HTTP %i with an unknown body to %s", (status, body, code) => {
    expect(toApiError(status, body).code).toBe(code);
  });

  it("always uses the API key message for 401 and keeps the API's reason as the hint", () => {
    const error = toApiError(401, JSON.stringify({ error: { code: "unauthorized", message: "Token revoked.", hint: "", candidates: [] } }));
    expect(error.message).toBe(UNAUTHORIZED_MESSAGE);
    expect(error.hint).toBe("The API said: Token revoked.");
  });

  it("maps a non-JSON 2xx body to upstream", async () => {
    on("get", "/me", () => new Response("<html>proxy</html>", { status: 200 }));
    const error = await rejection(client().api.call("getMe"));
    expect(error.code).toBe("upstream");
    expect(error.hint).toContain("/v1");
  });

  it("returns {} for an empty 2xx body", async () => {
    on("delete", "/replies/:reply", () => new Response(null, { status: 204 }));
    await expect(client().api.call("deleteReply", { path: { reply: "rpl_a.b" } })).resolves.toEqual({});
  });
});

describe("logging", () => {
  it("never writes the key to stderr, even at debug level and on errors", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    const logger = createLogger({ level: "debug", secrets: [TEST_KEY] });
    on("get", "/me", ok({ ok: true }));
    on("get", "/comments", () => new Response("", { status: 401 }));
    const { api } = client({ logger });
    await api.call("getMe");
    await rejection(api.call("listComments", { query: { query: "secret comment text" } }));
    logger.info(`oops ${TEST_KEY} and Bearer ${TEST_KEY} and sf_at_abc123`);

    const all = writes.join("");
    expect(writes.length).toBeGreaterThan(0);
    expect(all).toContain('"operationId":"getMe"');
    expect(all).toContain('"status":401');
    expect(all).not.toContain(TEST_KEY);
    expect(all).not.toContain("sf_at_abc123");
    expect(all).not.toContain("secret comment text");
    expect(all).not.toContain("/comments?");
  });

  it("redacts tokens and bearer values", () => {
    expect(redact("key sf_pat_abc.DEF-123 ok")).toBe("key sf_[redacted] ok");
    expect(redact("Authorization: Bearer abc.def")).toBe("Authorization: Bearer [redacted]");
    expect(redact("custom-secret-value here", ["custom-secret-value"])).toBe("[redacted] here");
  });

  it("drops lines below the level and writes nothing when silent", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", write: (line) => lines.push(line) });
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d", { n: 1 });
    expect(lines).toEqual(["[superflow-mcp] warn: c\n", '[superflow-mcp] error: d {"n":1}\n']);
    const quiet: string[] = [];
    createLogger({ level: "silent", write: (line) => quiet.push(line) }).error("x");
    expect(quiet).toEqual([]);
  });
});
