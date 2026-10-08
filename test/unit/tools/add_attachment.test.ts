import { describe, expect, it } from "vitest";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_add_attachment";
const attachment = {
  id: "att_8f3k2.123456.2",
  name: "fix.png",
  url: "https://storage.example.com/fix.png",
  size: 20311,
  content_type: "image/png",
};

describe(TOOL, () => {
  it("attaches to a comment", async () => {
    on("post", "/comments/:comment/attachments", ok(attachment, 201));
    const h = await connect({ defaultProject: "Acme Dental" });
    const result = await h.call(TOOL, { comment: "4821", url: "https://files.example.com/fix.png", name: "fix.png" });
    expect(data(result)).toEqual(attachment);
    expect(summaryOf(result)).toBe("Attached fix.png to comment 4821. File: https://storage.example.com/fix.png");
    expect(recorded[0]?.body).toEqual({ project: "Acme Dental", url: "https://files.example.com/fix.png", name: "fix.png" });
  });

  it("attaches to a reply", async () => {
    on("post", "/replies/:reply/attachments", ok(attachment, 201));
    const h = await connect();
    await h.call(TOOL, { reply: "rpl_8f3k2.654321", url: "https://files.example.com/fix.png" });
    expect(recorded[0]?.operationId).toBe("addReplyAttachment");
    expect(recorded[0]?.body).toEqual({ url: "https://files.example.com/fix.png" });
  });

  it("needs exactly one of comment or reply", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { url: "https://files.example.com/a.png" })).code).toBe("invalid");
    expect(
      errorOf(await h.call(TOOL, { comment: "1", reply: "rpl_a.b", url: "https://files.example.com/a.png" })).code,
    ).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { comment: "4821", project: "Acme", url: "https://files.example.com/fix.png" },
    method: "post",
    path: "/comments/:comment/attachments",
    success: ok(attachment, 201),
  });
});
