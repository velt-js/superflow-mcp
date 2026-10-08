import { describe, expect, it } from "vitest";
import { fullComment } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_create_comment";
const created = { ...fullComment, screenshot_status: "not_captured" };

describe(TOOL, () => {
  it("creates a comment and returns its link", async () => {
    on("post", "/comments", ok(created, 201));
    const h = await connect();
    const result = await h.call(TOOL, {
      project: "Acme Dental",
      page_url: "https://acme.com/pricing",
      text: "Button overlaps the nav on mobile",
      priority: "high",
      tags: ["mobile"],
      anchor: { xpath: "/html/body/header/nav/a[3]", x: 0.82, y: 0.04, device: "mobile" },
    });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual(created);
    expect(summaryOf(result)).toBe(
      "Created comment #4821 on https://acme.com/pricing in Acme Dental. Link: https://acme.com/pricing?scommentId=8f3k2",
    );
    const body = recorded[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      project: "Acme Dental",
      page_url: "https://acme.com/pricing",
      text: "Button overlaps the nav on mobile",
      priority: "high",
      tags: ["mobile"],
      anchor: { xpath: "/html/body/header/nav/a[3]", x: 0.82, y: 0.04, device: "mobile" },
    });
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps a caller idempotency key and reuses the generated one across its own retries", async () => {
    on("post", "/comments", () => new Response("", { status: 503 }), ok(created, 201));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme", page_url: "https://acme.com/", text: "Hi" });
    expect(result.isError).toBeFalsy();
    expect(recorded).toHaveLength(2);
    const first = (recorded[0]?.body as { idempotency_key: string }).idempotency_key;
    expect((recorded[1]?.body as { idempotency_key: string }).idempotency_key).toBe(first);

    on("post", "/comments", ok(created, 201));
    await h.call(TOOL, { project: "Acme", page_url: "https://acme.com/", text: "Hi", idempotency_key: "my-key-1" });
    expect((recorded[2]?.body as { idempotency_key: string }).idempotency_key).toBe("my-key-1");
  });

  it("allows at most one assignee", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme", page_url: "https://acme.com/", text: "Hi", assignees: ["Jen", "Bob"] });
    expect(result.isError).toBe(true);
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", page_url: "https://acme.com/", text: "Hi" },
    method: "post",
    path: "/comments",
    success: ok(created, 201),
  });
});
