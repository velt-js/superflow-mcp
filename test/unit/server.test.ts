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
  // CONTRACT-P3 section 8.
  superflow_list_agents: [true, false, true, false],
  superflow_get_agent: [true, false, true, false],
  superflow_create_agent: [false, false, false, false],
  superflow_update_agent: [false, false, true, false],
  superflow_delete_agent: [false, true, true, false],
  superflow_duplicate_agent: [false, false, false, false],
  superflow_list_agent_packs: [true, false, true, false],
  superflow_create_agent_pack: [false, false, false, false],
  superflow_update_agent_pack: [false, false, true, false],
  superflow_estimate_run: [true, false, true, true],
  superflow_run_agents: [false, false, false, true],
  superflow_get_run: [true, false, true, false],
  superflow_list_runs: [true, false, true, false],
  superflow_list_findings: [true, false, true, false],
  superflow_set_schedule: [false, false, true, false],
  superflow_list_schedules: [true, false, true, false],
  superflow_delete_schedule: [false, true, true, false],
  superflow_list_integrations: [true, false, true, false],
  superflow_get_integration: [true, false, true, false],
  superflow_connect_integration: [true, false, true, false],
  superflow_push_comment: [false, false, false, true],
  superflow_post_to_slack: [false, false, false, true],
  // Spec addendum v2.1.
  superflow_use_playbook: [true, false, true, false],
  superflow_import_findings: [false, false, true, false],
  superflow_get_team_analytics: [true, false, true, false],
  superflow_get_people_analytics: [true, false, true, false],
  superflow_get_all_time_analytics: [true, false, true, false],
  superflow_list_api_keys: [true, false, true, false],
  superflow_create_api_key: [false, false, false, false],
  superflow_revoke_api_key: [false, true, true, false],
  superflow_get_billing: [true, false, true, false],
  superflow_get_payment_link: [true, false, true, false],
  // Checks (the Checks Engine on the public API).
  superflow_list_failing_checks: [true, false, true, false],
  superflow_get_check_details: [true, false, true, false],
  superflow_get_site_score: [true, false, true, false],
  superflow_get_finding_source: [true, false, true, false],
  superflow_mark_check_fixed: [false, false, true, false],
  superflow_exclude_check: [false, true, true, false],
  superflow_include_check: [false, false, true, false],
  superflow_assign_check_owner: [false, false, true, false],
  superflow_reject_comment: [false, true, true, false],
  superflow_get_check_settings: [true, false, true, false],
  superflow_set_default_owners: [false, false, true, false],
  // Site settings and invoices.
  superflow_get_site_monitoring: [true, false, true, false],
  superflow_set_site_mode: [false, false, true, false],
  superflow_set_site_timezone: [false, false, true, false],
  superflow_list_forms: [true, false, true, false],
  superflow_set_form_testing: [false, false, true, true],
  superflow_get_invoices: [true, false, true, false],
};

// Destructive tools gate on confirm (CONTRACT-P2 section 10, and CONTRACT section 8 for the
// two comment deletes). Bulk gates on dry_run plus confirm. Seven tools that are not
// destructive gate on confirm too (CLAUDE.md, "Gates"): a run, a check marked fixed, care and
// a schedule spend credits, a Slack post is seen by people, a form test lands as a lead, and a
// new API key puts a credential into the conversation.
const NON_DESTRUCTIVE_GATED = [
  "superflow_run_agents",
  "superflow_post_to_slack",
  "superflow_mark_check_fixed",
  "superflow_set_site_mode",
  "superflow_set_form_testing",
  "superflow_create_api_key",
  "superflow_set_schedule",
];
const CONFIRM_GATED = [
  ...Object.entries(CONTRACT)
    .filter(([name, [, destructive]]) => destructive && name !== "superflow_bulk_update_comments")
    .map(([name]) => name),
  ...NON_DESTRUCTIVE_GATED,
];
const READ_ONLY_COUNT = Object.values(CONTRACT).filter(([readOnly]) => readOnly).length;

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

describe("tool registration", () => {
  it("registers exactly the 101 contract tools", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    expect(listed).toHaveLength(101);
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

  it("never puts confirm: true or dry_run: false in an Example, so a copied Example only previews", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    for (const tool of listed) {
      const example = JSON.parse(/Example: (.+)$/m.exec(tool.description ?? "")?.[1] ?? "{}") as Record<string, unknown>;
      expect(example.confirm, `${tool.name} example confirms`).not.toBe(true);
      expect(example.dry_run, `${tool.name} example turns off the dry run`).not.toBe(false);
    }
  });

  it("names at least one sibling tool in every description, so the model knows what to use instead", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    for (const tool of listed) {
      const others = (tool.description ?? "").match(/superflow_[a-z_]+/g)?.filter((name) => name !== tool.name) ?? [];
      expect(others.length, `${tool.name} names no other tool`).toBeGreaterThan(0);
      for (const name of others) expect(Object.keys(CONTRACT), `${tool.name} names ${name}`).toContain(name);
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
    expect(READ_ONLY_COUNT).toBe(45);
    expect(listed).toHaveLength(READ_ONLY_COUNT);
    expect(names.filter((n) => WRITE_TOOL_NAMES.includes(n))).toEqual([]);
    for (const tool of listed) expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
  });

  it("gives every destructive tool a confirm flag that defaults to false", async () => {
    expect(NON_DESTRUCTIVE_GATED).toHaveLength(7);
    expect(CONFIRM_GATED).toHaveLength(22);
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

  it("keeps estimate_run and connect_integration in read-only mode and drops every Phase 3 write tool", async () => {
    const h = await connect({ readOnly: true });
    const names = (await h.client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("superflow_estimate_run");
    expect(names).toContain("superflow_connect_integration");
    for (const name of [
      "superflow_run_agents",
      "superflow_create_agent",
      "superflow_delete_agent",
      "superflow_set_schedule",
      "superflow_push_comment",
      "superflow_post_to_slack",
    ]) {
      expect(names, name).not.toContain(name);
    }
  });

  it("tells the model how to run agents, poll, and handle secrets and other people's tools", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    const describe = (name: string) => listed.find((t) => t.name === name)?.description ?? "";
    expect(describe("superflow_run_agents")).toContain("Always call superflow_estimate_run first and show the user the credits");
    expect(describe("superflow_run_agents")).toContain("Settings > Billing");
    expect(describe("superflow_run_agents")).toContain("Do not retry");
    expect(describe("superflow_get_run")).toContain("done, failed or partial");
    expect(describe("superflow_get_run")).toContain("no more often than every 20 seconds");
    expect(describe("superflow_connect_integration")).toContain("cannot finish the sign-in");
    expect(describe("superflow_push_comment")).toContain("their team will see");
    expect(describe("superflow_post_to_slack")).toContain("Everyone in that channel sees it");
    expect(describe("superflow_set_schedule")).toContain("spends AI credits");
  });

  it("says list_runs covers portal and monitoring runs, and that an import is not a run", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    const describe = (name: string) => listed.find((t) => t.name === name)?.description ?? "";
    const runs = describe("superflow_list_runs");
    expect(runs).toContain("superflow_set_schedule");
    expect(runs).toContain("in the Superflow portal (manual)");
    expect(runs).toContain("Always-on Monitoring");
    expect(runs).toContain("Imports from superflow_import_findings are not runs and are not listed");
    expect(runs).not.toContain("Not listed: runs started in the Superflow portal");
    const findings = describe("superflow_list_findings");
    expect(findings).toContain("portal and Always-on Monitoring runs included");
    expect(findings).toContain("the run_id superflow_import_findings returned");
  });

  it("says deletes are permanent and tag rewrites stop at 500 a call", async () => {
    const h = await connect();
    const { tools: listed } = await h.client.listTools();
    const describe = (name: string) => listed.find((t) => t.name === name)?.description ?? "";
    expect(describe("superflow_delete_comment")).toContain("cannot be restored");
    expect(describe("superflow_remove_page")).toContain("cannot be restored");
    for (const name of ["superflow_update_tag", "superflow_delete_tag", "superflow_merge_tags"]) {
      expect(describe(name), name).toContain("at most 500 comments");
      expect(describe(name), name).toContain("complete: false");
    }
    expect(describe("superflow_push_comment")).toContain("already_linked: true");
    expect(describe("superflow_set_schedule")).toContain("fixed when the schedule is saved");
    expect(h.client.getInstructions()).toContain("Deleted comments cannot be restored");
    for (const tool of listed) {
      expect(tool.description ?? "", tool.name).not.toMatch(/restore_comment|update_integration|create_tag|#\d{3,}\b|comment number|SUPERFLOW_DEFAULT_PROJECT/);
    }
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
    expect(h.client.getInstructions()).toContain("Price a run with superflow_estimate_run before superflow_run_agents");
    expect(h.client.getInstructions()).toContain("get a yes before calling superflow_run_agents with confirm true");
    expect(h.client.getInstructions()).toContain("call superflow_use_playbook first and follow it");
    expect(h.client.getInstructions()).toContain("(triage)");
    expect(h.client.getInstructions()).toContain("(fix)");
    const { prompts } = await h.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(
      [
        "agent_findings_review",
        "client_update",
        "find_duplicates",
        "launch_checklist",
        "onboard_client",
        "prelaunch_run",
        "stale_threads",
        "triage",
        "fix",
        "push_my_review",
        "onboard_agency",
      ].sort(),
    );
    const { resources } = await h.client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["superflow://organization", "superflow://projects"]);
    const { resourceTemplates } = await h.client.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.uriTemplate).sort()).toEqual(
      [
        "superflow://comments/{comment}",
        "superflow://projects/{project}",
        "superflow://projects/{project}/comments{?status,page_url,assignee}",
        "superflow://runs/{run}",
      ].sort(),
    );
  });

  it("hosted surface: no SUPERFLOW_ variables in the instructions or the read-only refusal", async () => {
    const h = await connect({ readOnly: true, surface: "hosted" });
    const instructions = h.client.getInstructions() ?? "";
    expect(instructions).not.toContain("SUPERFLOW_");
    expect(instructions).toContain("This connection is read-only");
    const refused = await h.call("superflow_create_comment", { project: "p", page_url: "https://a.com/", text: "x" });
    expect(errorOf(refused).code).toBe("forbidden");
    expect(errorOf(refused).message).toContain("this connection was allowed to read only");
  });

  it("renamed tools answer with their new name", async () => {
    const h = await connect({ renamedTools: { list_workspaces: "superflow_get_me" } });
    const result = await h.call("list_workspaces", {});
    expect(errorOf(result).message).toBe("list_workspaces was renamed to superflow_get_me.");
  });

  it("reports every tool call to onToolCall, and a throwing reporter never fails the call", async () => {
    const events: Array<{ tool: string; ok: boolean }> = [];
    const h = await connect({ onToolCall: (event) => { events.push(event); throw new Error("telemetry down"); } });
    const result = await h.call("superflow_use_playbook", { name: "fix" });
    expect(result.isError).toBeFalsy();
    expect(events).toEqual([expect.objectContaining({ tool: "superflow_use_playbook", ok: true })]);
  });

  it("names only registered tools in the instructions: no write tool in read-only mode", async () => {
    for (const surface of ["stdio", "hosted"] as const) {
      for (const readOnly of [false, true]) {
        const h = await connect({ readOnly, surface });
        const instructions = h.client.getInstructions() ?? "";
        const registered = (await h.client.listTools()).tools.map((t) => t.name);
        for (const name of instructions.match(/superflow_[a-z_]+/g) ?? []) {
          expect(registered, `${surface}${readOnly ? " read-only" : ""} instructions name ${name}`).toContain(name);
        }
        if (readOnly) for (const name of WRITE_TOOL_NAMES) expect(instructions, name).not.toContain(name);
      }
    }
  });

  it("says so in the instructions when read-only", async () => {
    const h = await connect({ readOnly: true });
    expect(h.client.getInstructions()).toContain("read-only");
  });
});
