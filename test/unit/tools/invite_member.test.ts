import { describe, expect, it } from "vitest";
import { memberInvite } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_invite_member";

describe(TOOL, () => {
  it("invites, reports skipped emails and the seat change", async () => {
    on("post", "/members", ok(memberInvite, 201));
    const h = await connect();
    const result = await h.call(TOOL, { emails: ["jen@agency.com", "rakesh@agency.com"] });
    expect(data(result)).toEqual(memberInvite);
    expect(summaryOf(result)).toBe(
      "Invited 1 member: jen@agency.com. Skipped 1: rakesh@agency.com (already a member). Member seats: 4 of 10 used (was 3).",
    );
    const body = recorded[0]?.body as { emails: string[]; idempotency_key: string };
    expect(body.emails).toEqual(["jen@agency.com", "rakesh@agency.com"]);
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("says when nobody new was invited", async () => {
    on("post", "/members", ok({ invited: [], skipped: [{ email: "jen@agency.com", reason: "already_member" }], seats: memberInvite.seats }, 201));
    const h = await connect();
    const summary = summaryOf(await h.call(TOOL, { emails: ["jen@agency.com"], idempotency_key: "k-9" }));
    expect(summary).toMatch(/^Nobody new was invited\. Skipped 1: jen@agency\.com \(already a member\)\./);
    expect((recorded[0]?.body as { idempotency_key: string }).idempotency_key).toBe("k-9");
  });

  it("refuses more than 10 emails before calling the API", async () => {
    const h = await connect();
    const emails = Array.from({ length: 11 }, (_, i) => `p${i}@agency.com`);
    expect(errorOf(await h.call(TOOL, { emails })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { emails: ["jen@agency.com"] },
    method: "post",
    path: "/members",
    success: ok(memberInvite, 201),
  });
});
