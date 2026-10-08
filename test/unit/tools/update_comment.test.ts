import { describe, expect, it } from "vitest";
import { fullComment } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_comment";

describe(TOOL, () => {
  it("patches the comment and summarizes the new state", async () => {
    on("patch", "/comments/:comment", ok(fullComment));
    const h = await connect({ defaultProject: "Acme Dental" });
    const result = await h.call(TOOL, { comment: "#4821", priority: "high", assignees: ["Jen"], add_tags: ["mobile"] });
    expect(data(result)).toEqual(fullComment);
    expect(summaryOf(result)).toMatch(/^Updated\. Comment #4821 in Acme Dental/);
    expect(recorded[0]?.path).toBe("/comments/4821");
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental", priority: "high", assignees: ["Jen"], add_tags: ["mobile"] });
  });

  it("sends an empty assignees list to clear the assignee", async () => {
    on("patch", "/comments/:comment", ok(fullComment));
    const h = await connect();
    await h.call(TOOL, { comment: "cmt_8f3k2", assignees: [], tags: [] });
    expect(recorded[0]?.body).toEqual({ assignees: [], tags: [] });
  });

  it("refuses an update with nothing to change", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { comment: "4821", project: "Acme" });
    expect(errorOf(result).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("does not retry a PATCH on 503", async () => {
    on("patch", "/comments/:comment", () => new Response("", { status: 503 }));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", priority: "low" });
    expect(errorOf(result).code).toBe("upstream");
    expect(recorded).toHaveLength(1);
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "4821", project: "Acme", status: "In progress" },
    method: "patch",
    path: "/comments/:comment",
    success: ok(fullComment),
  });
});
