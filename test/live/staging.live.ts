// Live suite: the BUILT package over real stdio against a real Superflow API (staging in CI).
// It reads broadly and writes only what it creates, then removes it.
//
// Needs SUPERFLOW_TEST_API_KEY and SUPERFLOW_TEST_PROJECT (a project the key can read and
// comment in); SUPERFLOW_API_BASE_URL points it at staging. Without them every test is skipped,
// unless SUPERFLOW_LIVE_REQUIRED=1, which CI sets whenever the secrets exist, so a missing or
// broken credential fails the run instead of passing it silently.
//
// Run: pnpm build && pnpm test:live. CI: .github/workflows/live.yml, on every push to staging
// and main.
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, textOf } from "../e2e/launch.ts";
import type { Launched } from "../e2e/launch.ts";

const KEY = process.env.SUPERFLOW_TEST_API_KEY ?? "";
const PROJECT = process.env.SUPERFLOW_TEST_PROJECT ?? "";
const BASE_URL = process.env.SUPERFLOW_API_BASE_URL ?? "";
const enabled = Boolean(KEY && PROJECT);
const required = process.env.SUPERFLOW_LIVE_REQUIRED === "1";

/** Error codes that mean the server or the package is broken, never the test data. */
const BROKEN_CODES = new Set(["upstream", "internal", "timeout", "network"]);
/** Reads the test key must always be able to make. */
const CORE_READS = [
  "superflow_get_me",
  "superflow_list_projects",
  "superflow_get_project",
  "superflow_list_pages",
  "superflow_list_members",
  "superflow_list_statuses",
  "superflow_list_tags",
  "superflow_list_comments",
  "superflow_comment_stats",
];
/** Arguments a core read needs beyond the project (comment_stats requires group_by by design). */
const CORE_READ_ARGS: Record<string, Record<string, unknown>> = {
  superflow_comment_stats: { group_by: "status" },
};

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    SUPERFLOW_API_KEY: KEY,
    ...(BASE_URL ? { SUPERFLOW_API_BASE_URL: BASE_URL } : {}),
    SUPERFLOW_LOG_LEVEL: "error",
    ...extra,
  };
}

function errorCode(result: CallToolResult): string | undefined {
  return (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;
}

function data<T>(name: string, result: CallToolResult): T {
  if (result.isError) throw new Error(`${name} failed: ${textOf(result).split("\n")[0]}`);
  return result.structuredContent as T;
}

/** Arguments for a read tool that needs nothing but (optionally) a project. */
function readArgs(tool: Tool): Record<string, unknown> | undefined {
  const properties = Object.keys(tool.inputSchema.properties ?? {});
  const requiredArgs = (tool.inputSchema.required ?? []) as string[];
  if (requiredArgs.some((name) => name !== "project")) return undefined;
  const args: Record<string, unknown> = {};
  if (properties.includes("project")) args.project = PROJECT;
  if (properties.includes("limit")) args.limit = 5;
  return args;
}

describe("live: credentials", () => {
  it.runIf(required)("the live secrets are set", () => {
    expect(KEY, "SUPERFLOW_TEST_API_KEY").not.toBe("");
    expect(PROJECT, "SUPERFLOW_TEST_PROJECT").not.toBe("");
  });
});

describe.skipIf(!enabled)("live: the built package against the real API", () => {
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let server: Launched;
  let tools: Tool[] = [];
  const created: { tag?: string } = {};

  beforeAll(async () => {
    server = await launch(env());
    tools = (await server.client.listTools()).tools;
  }, 60_000);

  afterAll(async () => {
    if (created.tag) await server.call("superflow_delete_tag", { tag: created.tag, confirm: true }).catch(() => undefined);
    await server?.close();
  });

  it("the key works", async () => {
    const me = data<{ member?: { name?: string } }>("get_me", await server.call("superflow_get_me"));
    expect(me).toBeTypeOf("object");
  });

  it("the core reads answer for the test project", async () => {
    for (const name of CORE_READS) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      const result = await server.call(name, { ...(readArgs(tool!) ?? { project: PROJECT }), ...CORE_READ_ARGS[name] });
      expect(result.isError, `${name}: ${textOf(result).split("\n")[0]}`).toBeFalsy();
    }
  }, 120_000);

  it("every read-only tool that needs at most a project answers without a server error", async () => {
    const broken: string[] = [];
    let called = 0;
    for (const tool of tools.filter((t) => t.annotations?.readOnlyHint)) {
      const args = readArgs(tool);
      if (!args) continue;
      called += 1;
      const result = await server.call(tool.name, args);
      expect(result.content.length, tool.name).toBeGreaterThan(0);
      const code = errorCode(result);
      if (result.isError && code && BROKEN_CODES.has(code)) broken.push(`${tool.name}: ${textOf(result).split("\n")[0]}`);
    }
    expect(called).toBeGreaterThan(CORE_READS.length);
    expect(broken).toEqual([]);
    expect(server.protocolErrors.map((e) => e.message)).toEqual([]);
  }, 300_000);

  it("pages through comments with the cursor", async () => {
    const first = data<{ items?: Array<{ id: string }>; has_more?: boolean; next_cursor?: string | null }>(
      "list_comments",
      await server.call("superflow_list_comments", { project: PROJECT, limit: 1 }),
    );
    if (!first.has_more || !first.next_cursor) return;
    const second = data<{ items?: Array<{ id: string }> }>(
      "list_comments page 2",
      await server.call("superflow_list_comments", { project: PROJECT, limit: 1, cursor: first.next_cursor }),
    );
    expect(second.items?.[0]?.id).toBeDefined();
    expect(second.items?.[0]?.id).not.toBe(first.items?.[0]?.id);
  }, 60_000);

  it("a tag lifecycle: create, find, refuse to delete without confirm, delete", async () => {
    const name = `mcp-live-${runId}`;
    data("create_tag", await server.call("superflow_create_tag", { name }));
    created.tag = name;
    expect(textOf(await server.call("superflow_list_tags", {}))).toContain(name);

    const preview = await server.call("superflow_delete_tag", { tag: name });
    expect(preview.isError).toBeFalsy();
    expect(preview.structuredContent).toMatchObject({ needs_confirmation: true });
    expect(textOf(await server.call("superflow_list_tags", {})), "still there after the preview").toContain(name);

    data("delete_tag", await server.call("superflow_delete_tag", { tag: name, confirm: true }));
    created.tag = undefined;
    expect(textOf(await server.call("superflow_list_tags", {}))).not.toContain(name);
  }, 120_000);

  it("a bulk change without dry_run: false only previews", async () => {
    const result = await server.call("superflow_bulk_update_comments", {
      // A text filter that matches nothing: a tag that does not exist is refused as not_found before any preview.
      filter: { project: PROJECT, query: `mcp-live-none-${runId}` },
      patch: { priority: "high" },
    });
    expect(result.isError, textOf(result).split("\n")[0]).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ dry_run: true });
  }, 60_000);

  it("a wrong key is refused as unauthorized", async () => {
    const wrong = await launch(env({ SUPERFLOW_API_KEY: "sf_pat_live_suite_not_a_real_key_000000" }));
    try {
      const result = await wrong.call("superflow_get_me");
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("unauthorized");
    } finally {
      await wrong.close();
    }
  }, 60_000);

  it("read-only mode lists no write tool, and reads still work", async () => {
    const readOnly = await launch(env({ SUPERFLOW_READ_ONLY: "true" }));
    try {
      const listed = (await readOnly.client.listTools()).tools;
      expect(listed.every((t) => t.annotations?.readOnlyHint)).toBe(true);
      expect((await readOnly.call("superflow_get_me")).isError).toBeFalsy();
    } finally {
      await readOnly.close();
    }
  }, 60_000);
});
