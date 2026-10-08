import { describe, expect, it } from "vitest";
import { fullComment } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_restore_comment";

describe(TOOL, () => {
  it("restores a deleted comment", async () => {
    on("post", "/comments/:comment/restore", ok(fullComment));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2" });
    expect(data(result)).toEqual(fullComment);
    expect(summaryOf(result)).toMatch(/^Restored\. Comment #4821 in Acme Dental/);
    expect(recorded[0]?.body).toEqual({});
  });

  it("sends the project for a number", async () => {
    on("post", "/comments/:comment/restore", ok(fullComment));
    const h = await connect();
    await h.call(TOOL, { comment: "4821", project: "Acme Dental" });
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental" });
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "4821", project: "Acme" },
    method: "post",
    path: "/comments/:comment/restore",
    success: ok(fullComment),
  });
});
