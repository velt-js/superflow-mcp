import { describe, expect, it } from "vitest";
import { estimate, lowBalanceEstimate } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_estimate_run";

describe(TOOL, () => {
  it("prices a run and tells the model to ask before running it", async () => {
    on("post", "/runs/estimate", ok(estimate));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", scope: "site", pack: "Pre-Launch" });
    expect(data(result)).toEqual(estimate);
    expect(summaryOf(result)).toBe(
      "This run would cost 10 credits (scan pricing, medium band): 42 pages with 2 agents (Proofreader, Legal footer). Balance: 1,234 credits. Show the user the credits and ask before starting it with superflow_run_agents and confirm: true.",
    );
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental", scope: "site", pack: "Pre-Launch" });
  });

  it("explains a workspace billed by model usage", async () => {
    const token = {
      ...estimate,
      pricing_mode: "token",
      credits: null,
      credits_display: "Not priced",
      band: null,
      note: "This workspace is billed by model usage, so runs cannot be priced in advance.",
    };
    on("post", "/runs/estimate", ok(token));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { project: "Acme Dental" }))).toBe(
      "A run with 2 agents (Proofreader, Legal footer) on 42 pages. This workspace is billed by model usage, so runs cannot be priced in advance. Balance: 1,234 credits. Show the user the credits and ask before starting it with superflow_run_agents and confirm: true.",
    );
  });

  it("says when the balance is too low, and how to add credits", async () => {
    on("post", "/runs/estimate", ok(lowBalanceEstimate));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", agents: ["Proofreader", "Legal footer"] });
    expect(result.isError).toBeFalsy();
    expect(summaryOf(result)).toBe(
      "Not enough AI credits for this run: it needs 10 credits and the balance is 4. Add AI credits in Superflow under Settings > Billing, or turn on auto refill there. Do not retry the run until the balance covers it.",
    );
  });

  it("checks agents or pack, and pages for a list scope, before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { project: "Acme", agents: ["Proofreader"], pack: "Pre-Launch" })).message).toBe(
      "Give agents or pack, not both.",
    );
    expect(errorOf(await h.call(TOOL, { project: "Acme", scope: "list" })).message).toContain("scope list needs pages");
    expect(errorOf(await h.call(TOOL, { project: "Acme", agents: Array.from({ length: 26 }, (_, i) => `a${i}`) })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("stays available in read-only mode", async () => {
    on("post", "/runs/estimate", ok(estimate));
    const h = await connect({ readOnly: true });
    const result = await h.call(TOOL, { project: "Acme Dental", scope: "list", pages: ["https://acme.com/", "https://acme.com/pricing"] });
    expect(result.isError).toBeFalsy();
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental", scope: "list", pages: ["https://acme.com/", "https://acme.com/pricing"] });
  });

  standardErrorCases({ tool: TOOL, args: { project: "Acme" }, method: "post", path: "/runs/estimate", success: ok(estimate) });
});
