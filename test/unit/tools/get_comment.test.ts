import { describe, expect, it } from "vitest";
import { UNTRUSTED_NOTICE } from "../../../src/lib/format.ts";
import { fullComment } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, textOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_comment";

describe(TOOL, () => {
  it("returns the full comment with a linked summary", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect();
    const result = await h.call(TOOL, { comment: " cmt_8f3k2 ", project: "Acme Dental" });
    expect(data(result)).toEqual(fullComment);
    expect(summaryOf(result)).toBe(
      "Comment cmt_8f3k2 in Acme Dental on https://acme.com/pricing: Open, high priority, assigned to Jen, 1 reply. Link: https://acme.com/pricing?scommentId=8f3k2",
    );
    expect(textOf(result).split("\n")[1]).toBe(UNTRUSTED_NOTICE);
    expect(recorded[0]?.path).toBe("/comments/cmt_8f3k2");
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental", include_replies: "true" });
  });

  it("sends no project when none is given", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect();
    await h.call(TOOL, { comment: "cmt_8f3k2", include_replies: false });
    expect(recorded[0]?.query).toEqual({ include_replies: "false" });
  });

  it("takes the comment's link and sends its id in the path", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect();
    await h.call(TOOL, { comment: "https://acme.com/pricing?utm_source=x&scommentId=8f3k2#top" });
    expect(recorded[0]?.path).toBe("/comments/cmt_8f3k2");
    expect(recorded[0]?.operationId).toBe("getComment");
  });

  it("passes a link without scommentId through for the API to answer", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect();
    await h.call(TOOL, { comment: "https://acme.com/pricing" });
    expect(decodeURIComponent(recorded[0]?.path ?? "")).toBe("/comments/https://acme.com/pricing");
  });

  it("never labels a comment by a number", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2" });
    expect(summaryOf(result)).toMatch(/^Comment cmt_8f3k2 in Acme Dental/);
    expect(summaryOf(result)).not.toContain("#");
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "cmt_nope" },
    method: "get",
    path: "/comments/:comment",
    success: ok(fullComment),
  });
});
