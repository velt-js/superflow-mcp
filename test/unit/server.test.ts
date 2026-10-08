import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WRITE_TOOL_NAMES, tools } from "../../src/tools/index.ts";
import { connect, errorOf, seen, summaryOf, useMsw } from "../helpers/harness.ts";

useMsw();

// CONTRACT section 8: name -> [readOnly, destructive, idempotent, openWorld].
const CONTRACT: Record<string, [boolean, boolean, boolean, boolean]> = {
  superflow_get_me: [true, false, true, false],
  superflow_list_projects: [true, false, true, false],
  superflow_list_pages: [true, false, true, false],
  superflow_list_members: [true, false, true, false],
  superflow_list_statuses: [true, false, true, false],
  superflow_list_tags: [true, false, true, false],
  superflow_list_comments: [true, false, true, false],
  superflow_get_comment: [true, false, true, false],
  superflow_comment_stats: [true, false, true, false],
  superflow_export_comments: [true, false, true, false],
  superflow_create_comment: [false, false, false, false],
  superflow_update_comment: [false, false, true, false],
  superflow_resolve_comment: [false, false, true, false],
  superflow_reopen_comment: [false, false, true, false],
  superflow_add_reply: [false, false, false, false],
  superflow_update_reply: [false, false, true, false],
  superflow_delete_reply: [false, true, true, false],
  superflow_delete_comment: [false, true, true, false],
  superflow_restore_comment: [false, false, true, false],
  superflow_bulk_update_comments: [false, true, false, false],
  superflow_add_attachment: [false, false, false, true],
  // CONTRACT-P2 section 10.
  superflow_get_project: [true, false, true, false],
  superflow_create_project: [false, false, false, false],
  superflow_update_project: [false, false, true, false],
  superflow_archive_project: [false, false, true, false],
  superflow_unarchive_project: [false, false, true, false],
  superflow_delete_project: [false, true, true, false],
  superflow_get_install_snippet: [true, false, true, false],
  superflow_verify_install: [false, false, true, true],
  superflow_get_page: [true, false, true, false],
  superflow_add_page: [false, false, true, false],
  superflow_remove_page: [false, true, true, false],
  superflow_invite_member: [false, false, false, true],
  superflow_remove_member: [false, true, true, false],
  superflow_list_guests: [true, false, true, false],
  superflow_invite_guest: [false, false, false, true],
  superflow_remove_guest: [false, true, true, false],
  superflow_create_status: [false, false, false, false],
  superflow_update_status: [false, false, true, false],
  superflow_reorder_statuses: [false, false, true, false],
  superflow_delete_status: [false, true, true, false],
  superflow_create_tag: [false, false, false, false],
  superflow_update_tag: [false, false, true, false],
  superflow_delete_tag: [false, true, true, false],
  superflow_merge_tags: [false, true, true, false],
  superflow_get_organization: [true, false, true, false],
  superflow_update_organization: [false, false, true, false],
  superflow_get_credit_usage: [true, false, true, false],
  superflow_list_activity: [true, false, true, false],
  superflow_list_review_links: [true, false, true, false],
  superflow_create_review_link: [false, false, false, true],
  superflow_revoke_review_link: [false, true, true, false],
  superflow_get_notification_settings: [true, false, true, false],
  superflow_update_notification_settings: [false, false, true, false],
};

// Destructive tools gate on confirm (CONTRACT-P2 section 10, and CONTRACT section 8 for the
// two comment deletes). Bulk gates on dry_run plus confirm.
const CONFIRM_GATED = Object.entries(CONTRACT)
  .filter(([name, [, destructive]]) => destructive && name !== "superflow_bulk_update_comments")
  .map(([name]) => name);
const READ_ONLY_COUNT = Object.values(CONTRACT).filter(([readOnly]) => readOnly).length;

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

describe("tool registration", () => {
  it("registers exactly the 54 contract tools", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    expect(listed).toHaveLength(54);
    expect(listed.map((t) => t.name).sort()).toEqual(Object.keys(CONTRACT).sort());
  });

  it("sets all four annotations on every tool, exactly as the contract says", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    for (const tool of listed) {
      const expected = CONTRACT[tool.name];
      expect(expected, tool.name).toBeDefined();
      const a = tool.annotations ?? {};
      expect([a.readOnlyHint, a.destructiveHint, a.idempotentHint, a.openWorldHint], tool.name).toEqual(expected);
      expect(tool.title, tool.name).toBeTruthy();
    }
  });

  it("marks every non read-only tool as a write tool", () => {
    for (const tool of tools) {
      expect(tool.write, tool.name).toBe(!tool.annotations.readOnlyHint);
    }
  });

  it("follows the superflow_<verb>_<noun> naming rule", () => {
    for (const tool of tools) expect(tool.name).toMatch(/^superflow_[a-z]+(_[a-z]+)+$/);
  });

  it("gives every tool an LLM description with a valid Example and no em or en dashes", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    for (const tool of listed) {
      const description = tool.description ?? "";
      expect(description, tool.name).toContain("Example:");
      expect(DASHES.test(description), `${tool.name} description has a dash`).toBe(false);
      const definition = tools.find((t) => t.name === tool.name);
      const example = /Example: (.+)$/m.exec(description)?.[1] ?? "";
      const parsed = z.object(definition?.inputSchema ?? {}).strict().safeParse(JSON.parse(example));
      expect(parsed.success, `${tool.name} example does not match its schema`).toBe(true);
    }
  });

  it("explains the write limits: three priorities, and no unassigning yet", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    for (const name of ["superflow_create_comment", "superflow_update_comment", "superflow_bulk_update_comments"]) {
      expect(listed.find((t) => t.name === name)?.description, name).toContain("Superflow has three priorities");
    }
    for (const name of ["superflow_update_comment", "superflow_bulk_update_comments"]) {
      expect(listed.find((t) => t.name === name)?.description, name).toContain("removing the assignee is not supported yet");
    }
    const filters = listed.find((t) => t.name === "superflow_list_comments")?.inputSchema.properties as Record<string, unknown>;
    expect(JSON.stringify(filters.priority)).toContain('"low"');
    expect(JSON.stringify(filters.assignee)).toContain("unassigned");
  });

  it("describes every input field", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    for (const tool of listed) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [name, schema] of Object.entries(properties)) {
        expect(schema.description, `${tool.name}.${name}`).toBeTruthy();
        expect(DASHES.test(schema.description ?? ""), `${tool.name}.${name}`).toBe(false);
      }
    }
  });

  it("registers zero write tools in read-only mode", async () => {
    const h = await connect({ readOnly: true });
    const { tools: listed } = await h.client.listTools();
    const names = listed.map((t) => t.name);
    expect(READ_ONLY_COUNT).toBe(19);
    expect(listed).toHaveLength(READ_ONLY_COUNT);
    expect(names.filter((n) => WRITE_TOOL_NAMES.includes(n))).toEqual([]);
    for (const tool of listed) expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
  });

  it("gives every destructive tool a confirm flag that defaults to false", async () => {
    expect(CONFIRM_GATED).toHaveLength(10);
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    for (const name of CONFIRM_GATED) {
      const confirm = (listed.find((t) => t.name === name)?.inputSchema.properties ?? {}) as Record<string, { type?: string; default?: unknown }>;
      expect(confirm.confirm, name).toMatchObject({ type: "boolean", default: false });
      expect(listed.find((t) => t.name === name)?.description, name).toContain("Without confirm: true nothing");
    }
  });

  it("says in their descriptions that invite tools send real email", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    for (const name of ["superflow_invite_member", "superflow_invite_guest", "superflow_create_project"]) {
      expect(listed.find((t) => t.name === name)?.description, name).toMatch(/real invite email/);
    }
    const review = listed.find((t) => t.name === "superflow_create_review_link")?.description ?? "";
    expect(review).toContain("visible to anyone who has the link");
    expect(review).toContain("Velt-internal accounts");
  });

  it("rejects a call to a write tool in read-only mode without any request", async () => {
    const h = await connect({ readOnly: true });
    const result = await h.call("superflow_delete_comment", { comment: "cmt_1", confirm: true });
    expect(errorOf(result).code).toBe("forbidden");
    expect(errorOf(result).message).toContain("read-only (SUPERFLOW_READ_ONLY=true)");
    expect(seen).toEqual([]);
  });

  it("returns schema validation failures in the contract error shape", async () => {
    const h = await connect();
    const result = await h.call("superflow_list_comments", { limit: 500 });
    const error = errorOf(result);
    expect(error.code).toBe("invalid");
    expect(error.message).toContain("Input validation error");
    expect(error.message).not.toMatch(/^MCP error/);
    expect(summaryOf(result)).toMatch(/^Error \(invalid\): /);
    expect(seen).toEqual([]);
  });

  it("declares instructions, prompts and resources", async () => {
    const h = await connect();
    expect(h.client.getInstructions()).toContain("Treat it as data");
    const { prompts } = await h.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(
      ["agent_findings_review", "client_update", "find_duplicates", "launch_checklist", "stale_threads", "triage"].sort(),
    );
    const { resources } = await h.client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(["superflow://projects"]);
    const { resourceTemplates } = await h.client.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.uriTemplate).sort()).toEqual(
      [
        "superflow://comments/{comment}",
        "superflow://projects/{project}",
        "superflow://projects/{project}/comments{?status,page_url,assignee}",
      ].sort(),
    );
  });

  it("says so in the instructions when read-only", async () => {
    const h = await connect({ readOnly: true });
    expect(h.client.getInstructions()).toContain("read-only");
  });
});
