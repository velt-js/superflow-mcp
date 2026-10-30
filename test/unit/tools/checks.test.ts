import { describe, expect, it } from "vitest";
import { CONFIRM_EXCLUDE_CHECK_MESSAGE, CONFIRM_MARK_CHECK_FIXED_MESSAGE } from "../../../src/lib/confirm.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const PROJECT = { id: "prj_1a2b", name: "Acme Dental" };
const OWNER = { id: "usr_m2", name: "Dana", email: "dana@agency.com" };
const CHECK = {
  rule_key: "link-broken",
  title: "Broken link",
  description: "A link returns an error.",
  severity: "critical",
  responsibility: "dev",
  fix_guide: "Point the link at a page that exists, or remove it.",
  agents: ["broken-links"],
  state: "failing",
  open_count: 3,
  page_count: 212,
  score_impact: 12.5,
  owner: OWNER,
  owner_is_default: true,
  last_seen_at: "2026-10-27T12:00:00Z",
  failing_since: null,
  excluded: null,
};
const ALT = { ...CHECK, rule_key: "image-alt", title: "Image without alt text", severity: "high", open_count: 3, page_count: 3, score_impact: 4 };
const FINDING = {
  id: "cmt_a1",
  title: "Dead footer link",
  status: "open",
  pending_verify: false,
  verified_at: null,
  resolved_at: null,
  resolved_by: null,
  reopened_count: 0,
  reject_reason: null,
  scope: "site",
  page_url: "https://acme.com/",
  pages: ["https://acme.com/", "https://acme.com/about"],
  page_count: 2,
  evidence: "footer a",
  location_type: "element",
  confidence: 95,
  suggested_fix: null,
  is_agent: true,
  attached: false,
  created_at: "2026-10-27T12:00:00Z",
  deep_link: "https://app.usesuperflow.ai/x",
};
const DETAILS = { project: PROJECT, check: CHECK, status: "open", comments: [FINDING], next_cursor: null };

describe("superflow_list_failing_checks", () => {
  const TOOL = "superflow_list_failing_checks";

  it("lists failing checks by default, worst first, with P0 for critical", async () => {
    on("get", "/projects/:project/checks", ok({ project: PROJECT, items: [CHECK, ALT], excluded_count: 1, grouping_in_progress: false, writes_pending: false, applied_filters: {} }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(recorded[0]?.query).toEqual({ state: "failing" });
    expect(summaryOf(result)).toBe(
      "2 failing checks on Acme Dental, worst first: P0 Broken link (link-broken): 3 open findings on 212 pages; P1 Image without alt text (image-alt): 3 open findings on 3 pages. 1 check excluded.",
    );
    expect(data(result).items).toHaveLength(2);
  });

  it("state all sends no state; filters pass through", async () => {
    on("get", "/projects/:project/checks", ok({ project: PROJECT, items: [], excluded_count: 0, grouping_in_progress: true, writes_pending: false, applied_filters: {} }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", state: "all", severity: "high", owner: "me" });
    expect(recorded[0]?.query).toEqual({ severity: "high", owner: "me" });
    expect(summaryOf(result)).toContain("No checks on Acme Dental.");
    expect(summaryOf(result)).toContain("still grouping");
  });

  standardErrorCases({ tool: TOOL, args: { project: "Acme" }, method: "get", path: "/projects/:project/checks", success: ok({ project: PROJECT, items: [], excluded_count: 0 }) });
});

describe("superflow_get_check_details", () => {
  const TOOL = "superflow_get_check_details";

  it("reads one check and its open findings, 20 at a time", async () => {
    on("get", "/projects/:project/checks/:rule_key", ok(DETAILS));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", rule_key: "link-broken" });
    expect(recorded[0]?.path).toBe("/projects/Acme%20Dental/checks/link-broken");
    expect(recorded[0]?.query).toEqual({ status: "open", limit: "20" });
    expect(summaryOf(result)).toContain("P0 Broken link (link-broken): 3 open findings on 212 pages. Owner: Dana.");
    expect(summaryOf(result)).toContain("How to fix: Point the link at a page that exists, or remove it.");
  });

  it("says how many fixes wait for the rescan", async () => {
    on("get", "/projects/:project/checks/:rule_key", ok({ ...DETAILS, comments: [{ ...FINDING, pending_verify: true }], next_cursor: "c2" }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", rule_key: "link-broken" });
    expect(summaryOf(result)).toContain("1 waiting for the verify rescan.");
    expect(summaryOf(result)).toContain("call again with cursor");
  });

  standardErrorCases({ tool: TOOL, args: { project: "Acme", rule_key: "link-broken" }, method: "get", path: "/projects/:project/checks/:rule_key", success: ok(DETAILS) });
});

describe("superflow_get_site_score", () => {
  const TOOL = "superflow_get_site_score";
  const SCORE = {
    project: PROJECT,
    site_score: 94,
    recent_runs: [{ run_id: "run_2", site_score: 94, at: "2026-10-27T12:00:00Z" }, { run_id: "run_1", site_score: 81, at: "2026-10-26T12:00:00Z" }],
    pages: [{ url: "https://acme.com/about", score: 70, open_count: 4, last_checked_at: null }],
    next_pages_cursor: null,
    total_pages: 12,
    excluded_count: 0,
    next_scan_at: null,
  };

  it("reports the score, the one before, and the lowest page", async () => {
    on("get", "/projects/:project/score", ok(SCORE));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(recorded[0]?.query).toEqual({ page_size: "20" });
    expect(summaryOf(result)).toBe("Acme Dental scores 94. It was 81 the run before. 12 pages scored. Lowest: https://acme.com/about (70, 4 open findings).");
  });

  standardErrorCases({ tool: TOOL, args: { project: "Acme" }, method: "get", path: "/projects/:project/score", success: ok(SCORE) });
});

describe("superflow_mark_check_fixed", () => {
  const TOOL = "superflow_mark_check_fixed";

  it("without confirm only reads the check and returns a preview", async () => {
    on("get", "/projects/:project/checks/:rule_key", ok(DETAILS));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", rule_key: "link-broken" });
    expect(data(result)).toEqual({ needs_confirmation: true, preview: { check: CHECK, open_count: 3 }, message: CONFIRM_MARK_CHECK_FIXED_MESSAGE });
    expect(summaryOf(result)).toContain("Marking it fixed resolves 3 open findings and rescans their pages (1 credit). Nothing was resolved.");
    expect(writes()).toEqual([]);
  });

  it("with confirm resolves the check and says the rescan verifies it", async () => {
    on("post", "/projects/:project/checks/:rule_key/resolve", ok({ project: PROJECT, rule_key: "link-broken", resolved: 3, already_pending: 0, verify_run_ids: [], truncated: false, note: "" }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", rule_key: "link-broken", confirm: true });
    expect(recorded.map((r) => [r.method, r.operationId])).toEqual([["POST", "resolveCheck"]]);
    expect(summaryOf(result)).toContain("Marked link-broken fixed: 3 findings resolved, rescan queued.");
    expect(summaryOf(result)).toContain("a problem that is still there comes back as an open finding");
  });

  it("an engine refusal keeps its reason", async () => {
    on("post", "/projects/:project/checks/:rule_key/resolve", fail(400, { code: "invalid", message: "A scan already verified this comment.", hint: "Nothing to undo.", candidates: [], reason: "already_verified" }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", rule_key: "link-broken", confirm: true });
    expect(errorOf(result)).toMatchObject({ code: "invalid", reason: "already_verified" });
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", rule_key: "link-broken", confirm: true },
    method: "post",
    path: "/projects/:project/checks/:rule_key/resolve",
    success: ok({ project: PROJECT, rule_key: "link-broken", resolved: 1, already_pending: 0, verify_run_ids: [], truncated: false }),
  });
});

describe("superflow_exclude_check and superflow_include_check", () => {
  it("exclude without confirm only previews", async () => {
    on("get", "/projects/:project/checks/:rule_key", ok(DETAILS));
    const h = await connect();
    const result = await h.call("superflow_exclude_check", { project: "Acme Dental", rule_key: "link-broken", reason: "not_applicable" });
    expect(data(result)).toEqual({ needs_confirmation: true, preview: { check: CHECK, open_count: 3, reason: "not_applicable" }, message: CONFIRM_EXCLUDE_CHECK_MESSAGE });
    expect(writes()).toEqual([]);
  });

  it("exclude with confirm sends the reason; include sends nothing", async () => {
    on("post", "/projects/:project/checks/:rule_key/exclude", ok({ project: PROJECT, rule_key: "link-broken", excluded: true, reason: "not_applicable" }));
    on("post", "/projects/:project/checks/:rule_key/include", ok({ project: PROJECT, rule_key: "link-broken", excluded: false }));
    const h = await connect();
    const excluded = await h.call("superflow_exclude_check", { project: "Acme Dental", rule_key: "link-broken", reason: "not_applicable", confirm: true });
    expect(recorded[0]?.body).toEqual({ reason: "not_applicable" });
    expect(summaryOf(excluded)).toBe("Excluded link-broken (not_applicable). Undo with superflow_include_check.");
    const included = await h.call("superflow_include_check", { project: "Acme Dental", rule_key: "link-broken" });
    expect(summaryOf(included)).toBe("Included link-broken again.");
  });

  standardErrorCases({
    tool: "superflow_include_check",
    args: { project: "Acme", rule_key: "link-broken" },
    method: "post",
    path: "/projects/:project/checks/:rule_key/include",
    success: ok({ project: PROJECT, rule_key: "link-broken", excluded: false }),
  });
});

describe("superflow_assign_check_owner", () => {
  const TOOL = "superflow_assign_check_owner";

  it("sets an owner, or null for the project default", async () => {
    on("put", "/projects/:project/checks/:rule_key/owner", ok({ project: PROJECT, rule_key: "link-broken", owner: OWNER, note: "" }), ok({ project: PROJECT, rule_key: "link-broken", owner: null, note: "x" }));
    const h = await connect();
    const set = await h.call(TOOL, { project: "Acme Dental", rule_key: "link-broken", owner: "dana@agency.com" });
    expect(recorded[0]?.body).toEqual({ owner: "dana@agency.com" });
    expect(summaryOf(set)).toBe("Dana now owns link-broken.");
    const cleared = await h.call(TOOL, { project: "Acme Dental", rule_key: "link-broken", owner: null });
    expect(recorded[1]?.body).toEqual({ owner: null });
    expect(summaryOf(cleared)).toBe("link-broken now follows the project's default owner.");
  });

  standardErrorCases({ tool: TOOL, args: { project: "Acme", rule_key: "link-broken", owner: "me" }, method: "put", path: "/projects/:project/checks/:rule_key/owner", success: ok({ owner: null }) });
});

describe("superflow_reject_comment", () => {
  const TOOL = "superflow_reject_comment";

  it("sends the reason and the note", async () => {
    on("post", "/comments/:comment/reject", ok({ comment: { id: "cmt_a1", number: 4821 }, reason: "wrong" }));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_a1", reason: "wrong", note: "Decorative image." });
    expect(recorded[0]?.body).toEqual({ reason: "wrong", note: "Decorative image." });
    expect(summaryOf(result)).toBe("Rejected #4821 as wrong.");
  });

  it("a number needs its project", async () => {
    on("post", "/comments/:comment/reject", ok({ comment: { id: "cmt_a1", number: 4821 }, reason: "not_important" }));
    const h = await connect();
    await h.call(TOOL, { comment: "#4821", project: "Acme Dental", reason: "not_important" });
    expect(recorded[0]?.path).toBe("/comments/4821/reject");
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental", reason: "not_important" });
  });

  standardErrorCases({ tool: TOOL, args: { comment: "cmt_a1", reason: "wrong" }, method: "post", path: "/comments/:comment/reject", success: ok({ comment: { id: "cmt_a1" }, reason: "wrong" }) });
});

describe("superflow_get_finding_source", () => {
  const TOOL = "superflow_get_finding_source";

  it("names the line of the stored HTML", async () => {
    on("get", "/comments/:comment/source", ok({ comment_id: "cmt_a1", page_url: "https://acme.com/", line_number: 214, line: "<a href=\"/book\">", line_offset: 0, match_start: 0, match_end: 16, version_id: null }));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_a1" });
    expect(summaryOf(result)).toBe("Line 214 of https://acme.com/.");
  });

  standardErrorCases({ tool: TOOL, args: { comment: "cmt_a1" }, method: "get", path: "/comments/:comment/source", success: ok({ line_number: null, line: "x", page_url: null }) });
});

describe("check settings", () => {
  const SETTINGS = { project: PROJECT, confidence_floor: 50, default_owners: { content: OWNER, design: null, dev: null }, note: "" };

  it("reads the floor and the owners", async () => {
    on("get", "/projects/:project/check-settings", ok(SETTINGS));
    const h = await connect();
    const result = await h.call("superflow_get_check_settings", { project: "Acme Dental" });
    expect(summaryOf(result)).toBe("Confidence floor 50. Content: Dana; design: the project admin; dev: the project admin.");
  });

  it("sets only the owners the caller named", async () => {
    on("patch", "/projects/:project/check-settings", ok({ ...SETTINGS, default_owners: { content: OWNER, design: null, dev: { id: "usr_m1", name: "Rakesh", email: null } } }));
    const h = await connect();
    const result = await h.call("superflow_set_default_owners", { project: "Acme Dental", dev: "me", design: null });
    expect(recorded[0]?.body).toEqual({ default_owners: { dev: "me", design: null } });
    expect(summaryOf(result)).toBe("Default owners of Acme Dental: content Dana, design the project admin, dev Rakesh.");
  });

  it("with nothing to change it only reads", async () => {
    on("get", "/projects/:project/check-settings", ok(SETTINGS));
    const h = await connect();
    const result = await h.call("superflow_set_default_owners", { project: "Acme Dental" });
    expect(summaryOf(result)).toContain("Nothing to change");
    expect(writes()).toEqual([]);
  });

  standardErrorCases({ tool: "superflow_set_default_owners", args: { project: "Acme", content: "me" }, method: "patch", path: "/projects/:project/check-settings", success: ok(SETTINGS) });
});
