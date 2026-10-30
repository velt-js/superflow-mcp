import { beforeEach, describe, expect, it } from "vitest";
import { CONFIRM_FORM_TEST_MESSAGE, CONFIRM_SITE_CARE_MESSAGE } from "../../../src/lib/confirm.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const PROJECT = { id: "prj_1a2b", name: "Acme Dental" };
const WATCH = {
  project: PROJECT, mode: "watch", monitored: false, cadence: null, timezone: null, agents: [], active_run: null, last_run_at: null, last_run_status: null, score: null,
  version_history: { enabled: true, frequency: "daily", hour: 6, timezone: "UTC" },
};
const CARE = {
  ...WATCH, mode: "care", monitored: true, cadence: "weekly", timezone: "America/Chicago", agents: ["broken-links", "spell-check"],
  last_run_at: "2026-10-28T06:00:00Z", last_run_status: "complete", score: 91,
};
const FORM = {
  id: "f1", page_url: "https://acme.test/contact", selector: "#contact", action: "/send", method: "POST", test_enabled: false, daily_test: false,
  accepted_test_leads_at: null, delivery_verified_at: null, last_test_at: null, last_result: null, last_result_detail: null,
  delivery_state: null, delivery_note: "waiting for the first test email", missing_since: null,
};
const FORMS = { project: PROJECT, data: [FORM, { ...FORM, id: "f2", page_url: "https://acme.test/quote", selector: "#quote" }], notice: "", test_email: "tests@usesuperflow.ai" };

describe("superflow_get_site_monitoring", () => {
  it("summarizes a site in care", async () => {
    on("get", "/projects/:project/monitoring", ok(CARE));
    const h = await connect();
    expect(summaryOf(await h.call("superflow_get_site_monitoring", { project: "Acme Dental" }))).toBe(
      "Acme Dental is in care: Superflow runs 2 agents weekly (America/Chicago). Score 91. Last run 2026-10-28 (complete).",
    );
  });

  it("summarizes a site in watch with its Version history schedule", async () => {
    on("get", "/projects/:project/monitoring", ok(WATCH));
    const h = await connect();
    expect(summaryOf(await h.call("superflow_get_site_monitoring", { project: "Acme Dental" }))).toBe(
      "Acme Dental is in watch: no agents run on a schedule. Version history captures the site daily (UTC).",
    );
  });

  standardErrorCases({ tool: "superflow_get_site_monitoring", args: { project: "Acme" }, method: "get", path: "/projects/:project/monitoring", success: ok(CARE) });
});

describe("superflow_set_site_mode", () => {
  const TOOL = "superflow_set_site_mode";

  it("care without confirm only reads and returns a preview", async () => {
    on("get", "/projects/:project/monitoring", ok(WATCH));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", mode: "care" });
    expect(data(result)).toEqual({ needs_confirmation: true, preview: WATCH, message: CONFIRM_SITE_CARE_MESSAGE });
    expect(summaryOf(result)).toContain("Turning care on runs the agents daily and spends AI credits, starting with a full check now. Nothing was changed.");
    expect(writes()).toEqual([]);
  });

  it("care with confirm sends the mode, cadence and zone and reports the first run", async () => {
    on("patch", "/projects/:project/monitoring", ok({ ...CARE, first_run: { version: 1 } }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", mode: "care", cadence: "weekly", timezone: "America/Chicago", confirm: true });
    // care carries confirm: true to the API, which gates it server-side too.
    expect(recorded.map((r) => [r.method, r.operationId, r.body])).toEqual([["PATCH", "updateSiteMonitoring", { mode: "care", cadence: "weekly", timezone: "America/Chicago", confirm: true }]]);
    expect(summaryOf(result)).toContain("First full check started (version 1).");
  });

  it("a site already in care changes its cadence without a confirm", async () => {
    on("get", "/projects/:project/monitoring", ok(CARE));
    on("patch", "/projects/:project/monitoring", ok({ ...CARE, cadence: "daily" }));
    const h = await connect();
    await h.call(TOOL, { project: "Acme Dental", mode: "care", cadence: "daily" });
    expect(recorded.map((r) => [r.method, r.operationId])).toEqual([["GET", "getSiteMonitoring"], ["PATCH", "updateSiteMonitoring"]]);
  });

  it("watch needs no confirm", async () => {
    on("patch", "/projects/:project/monitoring", ok({ ...CARE, mode: "watch" }));
    const h = await connect();
    await h.call(TOOL, { project: "Acme Dental", mode: "watch" });
    expect(recorded.map((r) => [r.method, r.body])).toEqual([["PATCH", { mode: "watch" }]]);
  });

  it("is hidden in read-only mode", async () => {
    const h = await connect({ readOnly: true });
    const { tools } = await h.client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).not.toContain(TOOL);
    expect(names).not.toContain("superflow_set_site_timezone");
    expect(names).not.toContain("superflow_set_form_testing");
    expect(names).toEqual(expect.arrayContaining(["superflow_get_site_monitoring", "superflow_list_forms"]));
  });

  standardErrorCases({ tool: TOOL, args: { project: "Acme", mode: "watch" }, method: "patch", path: "/projects/:project/monitoring", success: ok(CARE) });
});

describe("superflow_set_site_timezone", () => {
  it("sends the zone", async () => {
    on("patch", "/projects/:project/monitoring", ok({ ...CARE, timezone: "Europe/London" }));
    const h = await connect();
    const result = await h.call("superflow_set_site_timezone", { project: "Acme Dental", timezone: "Europe/London" });
    expect(recorded.map((r) => r.body)).toEqual([{ timezone: "Europe/London" }]);
    expect(summaryOf(result)).toContain("Time zone of Acme Dental set to Europe/London.");
  });

  standardErrorCases({ tool: "superflow_set_site_timezone", args: { project: "Acme", timezone: "UTC" }, method: "patch", path: "/projects/:project/monitoring", success: ok(CARE) });
});

describe("superflow_list_forms", () => {
  it("lists each form with its test state", async () => {
    on("get", "/projects/:project/forms", ok(FORMS));
    const h = await connect();
    const summary = summaryOf(await h.call("superflow_list_forms", { project: "Acme Dental" }));
    expect(summary).toContain("2 forms on Acme Dental.");
    expect(summary).toContain("#contact on https://acme.test/contact (f1): not tested, waiting for the first test email.");
  });

  standardErrorCases({ tool: "superflow_list_forms", args: { project: "Acme" }, method: "get", path: "/projects/:project/forms", success: ok(FORMS) });
});

describe("superflow_set_form_testing", () => {
  const TOOL = "superflow_set_form_testing";

  it("turning a test on without confirm only reads and returns a preview", async () => {
    on("get", "/projects/:project/forms", ok(FORMS));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", form: "https://acme.test/contact", enabled: true });
    expect(data(result)).toEqual({ needs_confirmation: true, preview: { ...FORM, name: FORM.page_url }, message: CONFIRM_FORM_TEST_MESSAGE });
    expect(summaryOf(result)).toContain("each test lands in the client's inbox as a lead. Nothing was changed.");
    expect(writes()).toEqual([]);
  });

  it("with confirm sends the form id and accepts the test leads", async () => {
    on("get", "/projects/:project/forms", ok(FORMS));
    on("patch", "/projects/:project/forms/:form", ok({ project: PROJECT, form: { ...FORM, test_enabled: true, daily_test: true } }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", form: "f1", enabled: true, daily_test: true, confirm: true });
    const write = recorded.find((r) => r.method === "PATCH");
    expect(write?.path).toBe("/projects/Acme%20Dental/forms/f1");
    expect(write?.body).toEqual({ test_enabled: true, daily_test: true, accept_test_leads: true });
    expect(summaryOf(result)).toBe("Testing #contact on https://acme.test/contact daily.");
  });

  it("turning a test off needs no confirm and accepts nothing", async () => {
    on("get", "/projects/:project/forms", ok({ ...FORMS, data: [{ ...FORM, test_enabled: true }] }));
    on("patch", "/projects/:project/forms/:form", ok({ project: PROJECT, form: FORM }));
    const h = await connect();
    await h.call(TOOL, { project: "Acme Dental", form: "f1", enabled: false });
    expect(recorded.find((r) => r.method === "PATCH")?.body).toEqual({ test_enabled: false });
  });

  it("an unknown form is not_found and writes nothing", async () => {
    on("get", "/projects/:project/forms", ok(FORMS));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", form: "f9", enabled: false });
    expect(errorOf(result).code).toBe("not_found");
    expect(writes()).toEqual([]);
  });

  describe("errors on the form lookup", () => {
    beforeEach(() => on("patch", "/projects/:project/forms/:form", ok({ project: PROJECT, form: FORM })));
    standardErrorCases({ tool: TOOL, args: { project: "Acme", form: "f1", enabled: false }, method: "get", path: "/projects/:project/forms", success: ok(FORMS) });
  });
});
