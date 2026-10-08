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

  it("still lets tags be cleared with an empty list", async () => {
    on("patch", "/comments/:comment", ok(fullComment));
    const h = await connect();
    await h.call(TOOL, { comment: "cmt_8f3k2", tags: [] });
    expect(recorded[0]?.body).toEqual({ tags: [] });
  });

  it.each([
    ["an empty assignees list", { assignees: [] }],
    ["an empty add_assignees list", { add_assignees: [] }],
    ["two assignees", { assignees: ["Jen", "Bob"] }],
    ["priority low", { priority: "low" }],
    ["priority none", { priority: "none" }],
  ])("rejects %s through the schema without a request", async (_label, change) => {
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", ...change });
    expect(errorOf(result).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("does not offer remove_assignees, so it never reaches the API", async () => {
    on("patch", "/comments/:comment", ok(fullComment));
    const h = await connect();
    const { tools } = await h.client.listTools();
    const schema = tools.find((t) => t.name === TOOL)?.inputSchema.properties ?? {};
    expect(schema).not.toHaveProperty("remove_assignees");
    await h.call(TOOL, { comment: "cmt_8f3k2", remove_assignees: ["Jen"], assignees: ["Bob"] });
    expect(recorded[0]?.body).toEqual({ assignees: ["Bob"] });
  });

  it("refuses to unassign and points to the toolbar", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", assignees: ["Unassigned"] });
    const error = errorOf(result);
    expect(error.message).toBe("Removing the assignee is not supported yet.");
    expect(error.hint).toContain("Superflow toolbar");
    expect(recorded).toHaveLength(0);
  });

  it("refuses an update with nothing to change", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { comment: "4821", project: "Acme" });
    expect(errorOf(result).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("surfaces the API's refusal of a write it does not support", async () => {
    on("patch", "/comments/:comment", () =>
      Response.json(
        {
          error: {
            code: "invalid",
            message: "Superflow has three priorities: critical (P0), high (P1) and medium (P2).",
            hint: "Use medium.",
            candidates: [],
          },
        },
        { status: 400 },
      ),
    );
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", priority: "medium" });
    expect(errorOf(result).message).toContain("three priorities");
  });

  it("labels a comment without a number by its id", async () => {
    on("patch", "/comments/:comment", ok({ ...fullComment, number: null }));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", priority: "critical" });
    expect(summaryOf(result)).toMatch(/^Updated\. Comment cmt_8f3k2 in Acme Dental/);
    expect(summaryOf(result)).not.toContain("#null");
  });

  it("does not retry a PATCH on 503", async () => {
    on("patch", "/comments/:comment", () => new Response("", { status: 503 }));
    const h = await connect();
    const result = await h.call(TOOL, { comment: "cmt_8f3k2", priority: "medium" });
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
