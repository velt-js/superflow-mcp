import { describe, expect, it } from "vitest";
import { UNTRUSTED_NOTICE } from "../../../src/lib/format.ts";
import { fullComment, unnumberedComment } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, textOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_comment";

describe(TOOL, () => {
  it("returns the full comment with a linked summary", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "#4821", project: "Acme Dental" });
    expect(data(result)).toEqual(fullComment);
    expect(summaryOf(result)).toBe(
      "Comment #4821 in Acme Dental on https://acme.com/pricing: Open, high priority, assigned to Jen, 1 reply. Link: https://acme.com/pricing?scommentId=8f3k2",
    );
    expect(textOf(result).split("\n")[1]).toBe(UNTRUSTED_NOTICE);
    expect(recorded[0]?.path).toBe("/comments/4821");
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental", include_replies: "true" });
  });

  it("injects SUPERFLOW_DEFAULT_PROJECT for a bare number", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect({ defaultProject: "Acme Dental" });
    await h.call(TOOL, { comment: "4821", include_replies: false });
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental", include_replies: "false" });
  });

  it("does not inject the default project for an id", async () => {
    on("get", "/comments/:comment", ok(fullComment));
    const h = await connect({ defaultProject: "Acme Dental" });
    await h.call(TOOL, { comment: "cmt_8f3k2" });
    expect(recorded[0]?.path).toBe("/comments/cmt_8f3k2");
    expect(recorded[0]?.query).toEqual({ include_replies: "true" });
  });

  it("labels a comment without a number by its id, never #null", async () => {
    on("get", "/comments/:comment", ok(unnumberedComment));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2" });
    expect(summaryOf(result)).toMatch(/^Comment cmt_8f3k2 in Acme Dental/);
    expect(summaryOf(result)).not.toContain("#null");
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "4821" },
    method: "get",
    path: "/comments/:comment",
    success: ok(fullComment),
  });
});
