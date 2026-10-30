// End-to-end over real stdio: the BUILT package (dist/index.js) in a child process, a real MCP
// client, and a local fake of the Superflow API. The unit suite tests each tool's logic in
// process; this suite tests what ships: the bundle, the CLI entry, the stdio framing, the
// environment handling and properties that must hold for EVERY tool at once.
//
// Run: pnpm build && pnpm test:e2e. CI runs it on every pull request and on every push to
// staging and main (.github/workflows/ci.yml).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../../src/client/api.ts";
import { silentLogger } from "../../src/lib/logger.ts";
import { createServer } from "../../src/server.ts";
import { FakeSuperflowApi, apiError, echoLookups } from "./fake-api.ts";
import { ENTRY, assertBuilt, exampleOf, isolatedEnv, launch, textOf } from "./launch.ts";
import type { Launched } from "./launch.ts";

const KEY = "sf_pat_E2EKEY0123456789abcdef";
const PKG = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { name: string; version: string };

/** Tools that gate on confirm: true without being destructive (CLAUDE.md, "Gates"). */
const NON_DESTRUCTIVE_GATED = [
  "superflow_run_agents",
  "superflow_mark_check_fixed",
  "superflow_post_to_slack",
  "superflow_set_site_mode",
  "superflow_set_form_testing",
];
/** Destructive tools with their own preview rule: remove_member asks the API (409 preview); bulk is a dry run. */
const OWN_PREVIEW_RULE = new Set(["superflow_remove_member", "superflow_bulk_update_comments"]);

const api = new FakeSuperflowApi(KEY);
let server: Launched;
let tools: Tool[] = [];

function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { SUPERFLOW_API_KEY: KEY, SUPERFLOW_API_BASE_URL: api.baseUrl, SUPERFLOW_LOG_LEVEL: "debug", ...extra };
}

function withoutConfirm(args: Record<string, unknown>): Record<string, unknown> {
  const { confirm: _confirm, dry_run: _dryRun, ...rest } = args;
  return rest;
}

function expectWellFormed(name: string, result: CallToolResult): void {
  expect(Array.isArray(result.content), `${name}: content is an array`).toBe(true);
  expect(result.content.length, `${name}: at least one content block`).toBeGreaterThan(0);
  const text = textOf(result);
  expect(text.split("\n")[0]?.trim(), `${name}: a one-line summary`).not.toBe("");
  expect(text, `${name}: no stack trace reaches the model`).not.toMatch(/\n\s+at .+:\d+:\d+/);
  expect(text.length, `${name}: text capped at 30,000 characters`).toBeLessThanOrEqual(30_000);
  if (result.isError) {
    const error = (result.structuredContent as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    expect(typeof error?.code, `${name}: an error carries a code`).toBe("string");
    expect(typeof error?.message, `${name}: an error carries a message`).toBe("string");
  } else {
    expect(result.structuredContent, `${name}: a result carries structuredContent`).toBeTypeOf("object");
  }
}

/** The tools the source registers, listed in process, to prove the bundle matches the source. */
async function sourceTools(readOnly: boolean): Promise<string[]> {
  const config = { apiKey: KEY, baseUrl: "https://api.superflow.test/v1", defaultProject: undefined, readOnly, logLevel: "silent" as const };
  const mcp = createServer({ config, client: new ApiClient({ apiKey: KEY, baseUrl: config.baseUrl, logger: silentLogger }), logger: silentLogger });
  const client = new Client({ name: "source", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(b), client.connect(a)]);
  const names = (await client.listTools()).tools.map((t) => t.name);
  await client.close();
  return names;
}

beforeAll(async () => {
  assertBuilt();
  await api.start();
  server = await launch(baseEnv());
  tools = (await server.client.listTools()).tools;
}, 60_000);

afterEach(() => {
  expect(api.violations, "every request uses an operation and query params from the OpenAPI snapshot").toEqual([]);
  api.reset();
});

afterAll(async () => {
  await server?.close();
  await api.stop();
});

describe("handshake", () => {
  it("names the package and its version", () => {
    const info = server.client.getServerVersion();
    expect(info?.name).toBe(PKG.name);
    expect(info?.version).toBe(PKG.version);
  });

  it("offers tools, prompts and resources, with instructions", () => {
    const caps = server.client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect(caps?.prompts).toBeDefined();
    expect(caps?.resources).toBeDefined();
    expect(server.client.getInstructions()?.length ?? 0).toBeGreaterThan(100);
  });

  it("answers ping", async () => {
    await expect(server.client.ping()).resolves.toBeDefined();
  });
});

describe("tools/list", () => {
  it("the built bundle registers exactly the tools the source does", async () => {
    expect(tools.map((t) => t.name).sort()).toEqual((await sourceTools(false)).sort());
  });

  it("has one entry per name, all prefixed superflow_", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^superflow_[a-z][a-z0-9_]*$/);
  });

  it("every tool has a title, all four annotations and an object input schema", () => {
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.inputSchema.type, tool.name).toBe("object");
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        expect(typeof tool.annotations?.[hint], `${tool.name}.${hint}`).toBe("boolean");
      }
      if (tool.annotations?.readOnlyHint) expect(tool.annotations.destructiveHint, `${tool.name}: read-only is never destructive`).toBe(false);
    }
  });

  it("every description ends with an Example whose keys the schema declares", () => {
    for (const tool of tools) {
      const example = exampleOf(tool.description);
      const declared = Object.keys((tool.inputSchema.properties ?? {}) as Record<string, unknown>);
      for (const key of Object.keys(example)) expect(declared, `${tool.name} example key "${key}"`).toContain(key);
      for (const key of (tool.inputSchema.required ?? []) as string[]) expect(example, `${tool.name} example has required "${key}"`).toHaveProperty(key);
    }
  });

  it("every destructive tool takes confirm", () => {
    for (const tool of tools.filter((t) => t.annotations?.destructiveHint && !OWN_PREVIEW_RULE.has(t.name))) {
      expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).toContain("confirm");
    }
  });
});

describe("prompts and resources", () => {
  it("every prompt renders with its required arguments", async () => {
    const { prompts } = await server.client.listPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      const args = Object.fromEntries((prompt.arguments ?? []).filter((a) => a.required).map((a) => [a.name, "example"]));
      const rendered = await server.client.getPrompt({ name: prompt.name, arguments: args });
      expect(rendered.messages.length, prompt.name).toBeGreaterThan(0);
      const first = rendered.messages[0]?.content;
      expect(first?.type === "text" && first.text.length > 0, prompt.name).toBe(true);
    }
  });

  it("lists resources and resource templates", async () => {
    const [{ resources }, { resourceTemplates }] = await Promise.all([server.client.listResources(), server.client.listResourceTemplates()]);
    expect(resources.length + resourceTemplates.length).toBeGreaterThan(0);
    for (const r of resources) expect(r.uri).toMatch(/^superflow:\/\//);
  });

  it("a resource read either answers or refuses, and the server stays up", async () => {
    const { resources } = await server.client.listResources();
    for (const resource of resources) {
      await server.client.readResource({ uri: resource.uri }).catch(() => undefined);
    }
    await expect(server.client.ping()).resolves.toBeDefined();
  });
});

describe("every tool over stdio", () => {
  it("answers its own Example with a well-formed result, never a crash", async () => {
    for (const tool of tools) {
      const result = await server.call(tool.name, exampleOf(tool.description));
      expectWellFormed(tool.name, result);
    }
    await expect(server.client.ping()).resolves.toBeDefined();
  }, 120_000);

  it("survives an upstream that answers every call with an empty object", async () => {
    api.respond(() => ({ status: 200, body: {} }));
    for (const tool of tools) expectWellFormed(tool.name, await server.call(tool.name, exampleOf(tool.description)));
    await expect(server.client.ping()).resolves.toBeDefined();
  }, 120_000);

  it("survives an upstream that answers every call with an HTML error page", async () => {
    api.respond(() => ({ status: 500, body: "<html><body>Internal Server Error</body></html>" }));
    for (const tool of tools) {
      const result = await server.call(tool.name, exampleOf(tool.description));
      expectWellFormed(tool.name, result);
      // A tool that only reads locally (use_playbook) never calls the API; every other one reports the failure.
      if (api.requests.length > 0) expect(result.isError, tool.name).toBe(true);
      api.requests.length = 0;
    }
  }, 120_000);

  it("refuses arguments its schema rejects before calling the API", async () => {
    for (const tool of tools) {
      const result = await server.call(tool.name, { ...exampleOf(tool.description), __not_a_field: { nested: true }, limit: -1 });
      // Unknown keys may be stripped; an out-of-range limit is refused where the tool takes one.
      if (Object.keys(tool.inputSchema.properties ?? {}).includes("limit")) {
        expect(result.isError, `${tool.name} refuses limit -1`).toBe(true);
      }
    }
    expect(api.requests.filter((r) => r.query.limit === "-1")).toEqual([]);
  }, 120_000);
});

describe("confirmation gates over stdio", () => {
  const gated = () =>
    tools.filter((t) => (t.annotations?.destructiveHint && !OWN_PREVIEW_RULE.has(t.name)) || NON_DESTRUCTIVE_GATED.includes(t.name));

  it("covers every destructive tool and the five gated ones", () => {
    const names = gated().map((t) => t.name);
    for (const name of NON_DESTRUCTIVE_GATED) expect(names, name).toContain(name);
    expect(names.length).toBeGreaterThan(NON_DESTRUCTIVE_GATED.length);
  });

  it("no gated tool sends a write without confirm: true, with empty lookups", async () => {
    for (const tool of gated()) {
      api.reset();
      const result = await server.call(tool.name, withoutConfirm(exampleOf(tool.description)));
      expectWellFormed(tool.name, result);
      expect(api.writes().map((r) => `${r.method} ${r.path}`), `${tool.name} wrote without confirm`).toEqual([]);
    }
  }, 120_000);

  it("no gated tool sends a write without confirm: true, when its lookups find the item", async () => {
    const previews: string[] = [];
    for (const tool of gated()) {
      api.reset();
      const args = withoutConfirm(exampleOf(tool.description));
      api.respond(echoLookups(args));
      const result = await server.call(tool.name, args);
      expectWellFormed(tool.name, result);
      expect(api.writes().map((r) => `${r.method} ${r.path}`), `${tool.name} wrote without confirm`).toEqual([]);
      if ((result.structuredContent as { needs_confirmation?: boolean } | undefined)?.needs_confirmation) previews.push(tool.name);
    }
    // The previews are what make this test bite: most gated tools must reach theirs.
    expect(previews.length, `previews reached: ${previews.join(", ")}`).toBeGreaterThanOrEqual(Math.ceil(gated().length * 0.6));
  }, 120_000);

  it("with confirm: true the same tools do write (the gate is the only thing in the way)", async () => {
    const wrote: string[] = [];
    for (const tool of gated()) {
      api.reset();
      const args = { ...withoutConfirm(exampleOf(tool.description)), confirm: true };
      api.respond(echoLookups(args));
      await server.call(tool.name, args);
      if (api.writes().length > 0) wrote.push(tool.name);
    }
    expect(wrote.length, `wrote with confirm: ${wrote.join(", ")}`).toBeGreaterThanOrEqual(Math.ceil(gated().length * 0.6));
  }, 120_000);

  it("bulk update is a dry run unless dry_run is false and confirm is true", async () => {
    const bulk = tools.find((t) => t.name === "superflow_bulk_update_comments")!;
    await server.call(bulk.name, withoutConfirm(exampleOf(bulk.description)));
    await server.call(bulk.name, { ...withoutConfirm(exampleOf(bulk.description)), dry_run: false });
    const sent = api.requests.filter((r) => r.operationId === "bulkUpdateComments");
    for (const request of sent) expect((request.body as { dry_run?: unknown }).dry_run, "bulk without confirm stays a dry run").not.toBe(false);
  });

  it("run_agents without confirm only asks for the estimate", async () => {
    const tool = tools.find((t) => t.name === "superflow_run_agents")!;
    await server.call(tool.name, withoutConfirm(exampleOf(tool.description)));
    expect(api.requests.some((r) => r.operationId === "runAgents")).toBe(false);
  });
});

describe("read-only mode over stdio", () => {
  let readOnly: Launched;
  beforeAll(async () => {
    readOnly = await launch(baseEnv({ SUPERFLOW_READ_ONLY: "true" }));
  }, 60_000);
  afterAll(() => readOnly?.close());

  it("registers exactly the source's read-only tools, every one read only", async () => {
    const listed = (await readOnly.client.listTools()).tools;
    expect(listed.map((t) => t.name).sort()).toEqual((await sourceTools(true)).sort());
    for (const tool of listed) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
    }
    expect(listed.length).toBeLessThan(tools.length);
  });

  it("a write tool is not callable and nothing is sent", async () => {
    const result = await readOnly.client.callTool({ name: "superflow_delete_comment", arguments: { comment: "cmt_1", confirm: true } }).catch((error: unknown) => error);
    if (result && typeof result === "object" && "isError" in result) expect((result as CallToolResult).isError).toBe(true);
    expect(api.requests).toEqual([]);
  });
});

describe("errors over stdio", () => {
  it("401 is unauthorized, with sign-in guidance, and is not retried", async () => {
    api.answer("getMe", apiError(401, "unauthorized", "Invalid key"));
    const result = await server.call("superflow_get_me");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "unauthorized" } });
    expect(api.requests).toHaveLength(1);
  });

  it("403 keeps the API's scope message and hint", async () => {
    api.answer("listProjects", apiError(403, "forbidden", "This key lacks the projects:read scope.", { hint: "Create a key with projects:read." }));
    const result = await server.call("superflow_list_projects");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("projects:read");
  });

  it("404 lists the API's candidates in the summary", async () => {
    api.answer("getProject", apiError(404, "not_found", "No project matches \"acme\".", { candidates: [{ id: "prj_1", name: "Acme Dental" }] }));
    const result = await server.call("superflow_get_project", { project: "acme" });
    expect(result.isError).toBe(true);
    expect(textOf(result).split("\n")[0]).toContain("Acme Dental (prj_1)");
  });

  it("429 is retried after Retry-After, then reported as rate_limited", async () => {
    api.answer("getMe", { ...apiError(429, "rate_limited", "Rate limit reached."), headers: { "Retry-After": "0" } });
    const result = await server.call("superflow_get_me");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "rate_limited" } });
    expect(api.requests).toHaveLength(3);
  }, 30_000);

  it("a 503 on a read is retried, then reported", async () => {
    api.answer("getMe", { status: 503, body: "<html>Service Unavailable</html>" });
    const result = await server.call("superflow_get_me");
    expect(result.isError).toBe(true);
    expect(api.requests).toHaveLength(3);
  }, 30_000);

  it("a 503 on a create is not blindly repeated without its idempotency key", async () => {
    api.answer("createComment", { status: 503, body: "<html>Service Unavailable</html>" });
    const result = await server.call("superflow_create_comment", { project: "prj_1", page_url: "https://example.com/", text: "hello" });
    expect(result.isError).toBe(true);
    const keys = api.requests.filter((r) => r.operationId === "createComment").map((r) => (r.body as { idempotency_key?: string }).idempotency_key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key, "every attempt carries the same idempotency key").toBe(keys[0]);
    expect(keys[0]).toBeTruthy();
  }, 30_000);

  it("an unknown tool is refused and the server stays up", async () => {
    const outcome = await server.client.callTool({ name: "superflow_does_not_exist", arguments: {} }).catch((error: unknown) => error);
    if (outcome && typeof outcome === "object" && "isError" in outcome) expect((outcome as CallToolResult).isError).toBe(true);
    await expect(server.client.ping()).resolves.toBeDefined();
  });
});

describe("hygiene", () => {
  it("every request sends the key, JSON and the client header", async () => {
    await server.call("superflow_get_me");
    expect(api.requests.length).toBeGreaterThan(0);
    for (const request of api.requests) {
      expect(request.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(String(request.headers["x-superflow-client"])).toMatch(/^superflow-mcp\//);
      expect(String(request.headers.accept)).toContain("application/json");
    }
  });

  it("debug logs on stderr never carry the key, a request body or comment text", async () => {
    const secretText = "E2E-PRIVATE-COMMENT-TEXT-7f3a";
    api.answer("createComment", { status: 201, body: { id: "cmt_1", text: secretText, number: 1 } });
    await server.call("superflow_create_comment", { project: "prj_1", page_url: "https://example.com/", text: secretText });
    await server.call("superflow_get_me");
    const logs = server.stderr();
    expect(logs).not.toContain(KEY);
    expect(logs).not.toContain(KEY.slice(8));
    expect(logs).not.toContain(secretText);
  });

  it("stdout carried nothing but protocol messages for the whole run", () => {
    expect(server.protocolErrors.map((e) => e.message)).toEqual([]);
  });
});

describe("startup", () => {
  function run(env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [ENTRY], { env: { PATH: process.env.PATH ?? "", ...isolatedEnv(env) }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("the CLI did not exit"));
      }, 15_000);
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  it("without a key or a saved sign-in it exits non-zero, explains, and prints nothing on stdout", async () => {
    const out = await run({});
    expect(out.code).not.toBe(0);
    expect(out.stdout).toBe("");
    expect(out.stderr).toMatch(/login|SUPERFLOW_API_KEY/);
  });

  it("refuses a plain-http API outside localhost", async () => {
    const out = await run({ SUPERFLOW_API_KEY: KEY, SUPERFLOW_API_BASE_URL: "http://api.example.com/v1" });
    expect(out.code).not.toBe(0);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain("https");
  });

  it("refuses an unknown log level and a malformed read-only flag", async () => {
    const bad: Array<Record<string, string>> = [{ SUPERFLOW_LOG_LEVEL: "loud" }, { SUPERFLOW_READ_ONLY: "maybe" }];
    for (const env of bad) {
      const out = await run({ SUPERFLOW_API_KEY: KEY, ...env });
      expect(out.code, JSON.stringify(env)).not.toBe(0);
      expect(out.stdout).toBe("");
    }
  });
});
