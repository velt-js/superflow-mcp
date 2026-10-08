import { describe, expect, it } from "vitest";
import { CONFIRM_RUN_AGENTS_MESSAGE } from "../../../src/lib/confirm.ts";
import { estimate, lowBalanceEstimate, runningRun } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_run_agents";

describe(TOOL, () => {
  it("without confirm, returns the estimate as a preview and sends no run request", async () => {
    on("post", "/runs/estimate", ok(estimate));
    on("post", "/runs", ok(runningRun, 201));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", pack: "Pre-Launch" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({ needs_confirmation: true, preview: estimate, message: CONFIRM_RUN_AGENTS_MESSAGE });
    expect(summaryOf(result)).toBe(
      "This run would cost 10 credits (scan pricing, medium band): 42 pages with 2 agents (Proofreader, Legal footer). Balance: 1,234 credits. Nothing was started. Ask the user to confirm.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["estimateRun"]);
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental", pack: "Pre-Launch" });
  });

  it("without confirm and too few credits, explains the balance and how to add credits, and does not ask", async () => {
    on("post", "/runs/estimate", ok(lowBalanceEstimate));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", confirm: false });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toMatchObject({ needs_confirmation: false, insufficient_credits: true, estimate: lowBalanceEstimate });
    expect(summaryOf(result)).toContain("it needs 10 credits and the balance is 4");
    expect(summaryOf(result)).toContain("Settings > Billing");
    expect(recorded.map((r) => r.operationId)).toEqual(["estimateRun"]);
  });

  it("starts the run with confirm: true and a generated idempotency key", async () => {
    on("post", "/runs", ok(runningRun, 201));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", scope: "site", agents: ["Proofreader", "Legal footer"], confirm: true });
    expect(data(result)).toEqual(runningRun);
    expect(summaryOf(result)).toBe(
      "Started run run_8f3k2 on Acme Dental: running (1 of 2 agents finished). Credits charged: 10. Check again with superflow_get_run in 20 seconds or more; it is finished when the status is done, failed or partial.",
    );
    expect(recorded.map((r) => r.operationId)).toEqual(["runAgents"]);
    expect(recorded[0]?.body).toEqual({
      project: "Acme Dental",
      scope: "site",
      agents: ["Proofreader", "Legal footer"],
      confirm: true,
      idempotency_key: expect.any(String),
    });
  });

  it("explains a refusal for too few credits and never retries it", async () => {
    on(
      "post",
      "/runs",
      fail(409, { code: "invalid", message: "Not enough AI credits for this run.", hint: "The balance is 4 credits and this run needs 10." }),
    );
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { project: "Acme Dental", confirm: true, idempotency_key: "k-1" }));
    expect(error).toEqual({
      code: "invalid",
      message: "Not enough AI credits for this run.",
      hint: "The balance is 4 credits and this run needs 10. Add AI credits in Superflow under Settings > Billing, or turn on auto refill there. Do not retry the run until the balance covers it.",
      candidates: [],
    });
    expect(recorded).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it("checks agents or pack before any request", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { project: "Acme", agents: ["Proofreader"], pack: "Pre-Launch", confirm: true })).message).toBe(
      "Give agents or pack, not both.",
    );
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", confirm: true },
    method: "post",
    path: "/runs",
    success: ok(runningRun, 201),
  });
});
