import { describe, expect, it } from "vitest";
import { customAgentDetail } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_create_agent";
const INSTRUCTIONS = "Check that every page footer has the copyright line and links to the privacy policy and terms.";

describe(TOOL, () => {
  it("creates a custom agent with a generated idempotency key", async () => {
    on("post", "/agents", ok(customAgentDetail, 201));
    const h = await connect();
    const result = await h.call(TOOL, { name: "Legal footer", instructions: INSTRUCTIONS, packs: ["Pre-Launch"] });
    expect(data(result)).toEqual(customAgentDetail);
    expect(summaryOf(result)).toBe(
      "Created agent Legal footer (agt_legal1, custom, on, in pack Pre-Launch). Run it with superflow_estimate_run, then superflow_run_agents.",
    );
    expect(recorded[0]?.body).toEqual({
      name: "Legal footer",
      instructions: INSTRUCTIONS,
      packs: ["Pre-Launch"],
      idempotency_key: expect.any(String),
    });
  });

  it("keeps the caller's idempotency key and description", async () => {
    on("post", "/agents", ok(customAgentDetail, 201));
    const h = await connect();
    await h.call(TOOL, { name: "Legal footer", instructions: INSTRUCTIONS, description: "Footer checks.", idempotency_key: "k-1" });
    expect(recorded[0]?.body).toEqual({ name: "Legal footer", instructions: INSTRUCTIONS, description: "Footer checks.", idempotency_key: "k-1" });
  });

  it("refuses instructions over 20,000 characters before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { name: "Too long", instructions: "x".repeat(20_001) })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { name: "Legal footer", instructions: INSTRUCTIONS },
    method: "post",
    path: "/agents",
    success: ok(customAgentDetail, 201),
  });
});
