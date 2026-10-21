import { describe, expect, it } from "vitest";
import { reply } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_add_reply";

describe(TOOL, () => {
  it("posts a reply and reports unresolved mentions", async () => {
    const body = { reply, unresolved_mentions: ["@Bob"] };
    on("post", "/comments/:comment/replies", ok(body, 201));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "4821", project: "Acme Dental", text: "Fixed, please check. @Bob" });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe(
      "Replied to comment 4821 (reply rpl_8f3k2.654321). These mentions matched nobody and stayed plain text: @Bob. Check names with superflow_list_members.",
    );
    const sent = recorded[0]?.body as Record<string, unknown>;
    expect(sent).toMatchObject({ project: "Acme Dental", text: "Fixed, please check. @Bob" });
    expect(sent.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("retries a keyed POST on 502 with the same key", async () => {
    on("post", "/comments/:comment/replies", () => new Response("", { status: 502 }), ok({ reply, unresolved_mentions: [] }, 201));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", text: "On it" });
    expect(result.isError).toBeFalsy();
    expect(recorded).toHaveLength(2);
    expect((recorded[1]?.body as { idempotency_key: string }).idempotency_key).toBe(
      (recorded[0]?.body as { idempotency_key: string }).idempotency_key,
    );
    expect(h.sleeps).toEqual([500]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "4821", project: "Acme", text: "Thanks" },
    method: "post",
    path: "/comments/:comment/replies",
    success: ok({ reply, unresolved_mentions: [] }, 201),
  });
});
