// Integration test against a real Superflow API (staging). Runs only when
// SUPERFLOW_TEST_API_KEY and SUPERFLOW_TEST_PROJECT are set. Optional:
// SUPERFLOW_API_BASE_URL (defaults to production; point it at staging) and
// SUPERFLOW_TEST_PAGE_URL (defaults to the project's site URL).
//
// Phase 1 has no create-project endpoint, so the test works inside an existing project
// instead of creating its own. It cleans up by deleting the comment it creates.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../../src/client/api.ts";
import type { CommentFull, Me, Project } from "../../src/client/types.ts";
import { loadConfig } from "../../src/config.ts";
import { silentLogger } from "../../src/lib/logger.ts";
import { createServer } from "../../src/server.ts";

const KEY = process.env.SUPERFLOW_TEST_API_KEY;
const PROJECT = process.env.SUPERFLOW_TEST_PROJECT;
const enabled = Boolean(KEY && PROJECT);

describe.skipIf(!enabled)("integration: comment lifecycle against the real API", () => {
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tag = `mcp-test-${runId}`;
  let client: Client;
  let api: ApiClient;
  let commentId = "";
  let deleted = false;

  async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  }

  function data<T>(result: CallToolResult): T {
    if (result.isError) throw new Error(`tool error: ${JSON.stringify(result.structuredContent)}`);
    return result.structuredContent as T;
  }

  beforeAll(async () => {
    const config = loadConfig({
      SUPERFLOW_API_KEY: KEY,
      SUPERFLOW_API_BASE_URL: process.env.SUPERFLOW_API_BASE_URL,
      SUPERFLOW_LOG_LEVEL: "silent",
    });
    api = new ApiClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, logger: silentLogger });
    const server = createServer({ config, client: api, logger: silentLogger });
    client = new Client({ name: "superflow-mcp-integration", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    if (commentId && !deleted) {
      await call("superflow_delete_comment", { comment: commentId, confirm: true }).catch(() => undefined);
    }
    await client?.close();
  });

  it("creates a tagged comment", async () => {
    const project = await api.call<Project>("getProject", { path: { project: PROJECT ?? "" } });
    const pageUrl = process.env.SUPERFLOW_TEST_PAGE_URL ?? project.site_url ?? "";
    expect(pageUrl).not.toBe("");
    const comment = data<CommentFull>(
      await call("superflow_create_comment", {
        project: PROJECT,
        page_url: pageUrl,
        text: `superflow-mcp integration test ${runId}`,
        tags: [tag],
        priority: "medium",
      }),
    );
    commentId = comment.id;
    expect(comment.id).toMatch(/^cmt_/);
    expect(comment.tags).toContain(tag);
    expect(comment.url).toBeTruthy();
  });

  it("lists it back by tag", async () => {
    const list = data<{ items: Array<{ id: string }> }>(
      await call("superflow_list_comments", { project: PROJECT, tags: [tag] }),
    );
    expect(list.items.map((c) => c.id)).toContain(commentId);
  });

  it("replies with a mention", async () => {
    const me = data<Me>(await call("superflow_get_me", {}));
    const result = data<{ reply: { id: string }; unresolved_mentions: string[] }>(
      await call("superflow_add_reply", { comment: commentId, text: `Checking this. @${me.member.name}` }),
    );
    expect(result.reply.id).toMatch(/^rpl_/);
    expect(result.unresolved_mentions).toEqual([]);
  });

  it("resolves with a note, and a second resolve is a no-op", async () => {
    const first = data<{ changed: boolean; note_reply_id: string | null }>(
      await call("superflow_resolve_comment", { comment: commentId, note: "Fixed in the test." }),
    );
    expect(first.changed).toBe(true);
    expect(first.note_reply_id).toMatch(/^rpl_/);
    const second = data<{ changed: boolean; note_reply_id: string | null }>(
      await call("superflow_resolve_comment", { comment: commentId, note: "Again." }),
    );
    expect(second.changed).toBe(false);
    expect(second.note_reply_id).toBeNull();
  });

  it("reopens it", async () => {
    const result = data<{ changed: boolean; comment: CommentFull }>(await call("superflow_reopen_comment", { comment: commentId }));
    expect(result.changed).toBe(true);
    expect(result.comment.status.is_resolved).toBe(false);
  });

  it("previews a bulk change without writing", async () => {
    const preview = data<{ dry_run: boolean; would_update: number; already_in_state: number }>(
      await call("superflow_bulk_update_comments", { filter: { project: PROJECT, tags: [tag] }, patch: { priority: "high" } }),
    );
    expect(preview.dry_run).toBe(true);
    expect(preview.would_update).toBe(1);
    expect(preview.already_in_state).toBe(0);
    const comment = data<CommentFull>(await call("superflow_get_comment", { comment: commentId }));
    expect(comment.priority).toBe("medium");
  });

  it("does not delete without confirm", async () => {
    const result = data<{ needs_confirmation: boolean }>(await call("superflow_delete_comment", { comment: commentId }));
    expect(result.needs_confirmation).toBe(true);
    data<CommentFull>(await call("superflow_get_comment", { comment: commentId }));
  });

  it("deletes with confirm, restores, and deletes again", async () => {
    const removed = data<{ deleted: boolean }>(await call("superflow_delete_comment", { comment: commentId, confirm: true }));
    expect(removed.deleted).toBe(true);
    const restored = data<CommentFull>(await call("superflow_restore_comment", { comment: commentId }));
    expect(restored.id).toBe(commentId);
    const again = data<{ deleted: boolean }>(await call("superflow_delete_comment", { comment: commentId, confirm: true }));
    expect(again.deleted).toBe(true);
    deleted = true;
  });
}, 120_000);
