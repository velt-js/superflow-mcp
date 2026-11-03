import { describe, expect, it } from "vitest";
import { tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_create_tag";
const mobile = tags[1];

describe(TOOL, () => {
  it("creates a project tag", async () => {
    on("post", "/tags", ok(mobile, 201));
    const h = await connect();
    const result = await h.call(TOOL, { name: "mobile", color: "#b3261e", project: "Acme Dental" });
    expect(data(result)).toEqual(mobile);
    expect(summaryOf(result)).toBe("Created tag mobile (tag_mobile) in project Acme Dental.");
    expect(recorded[0]?.body).toEqual({ name: "mobile", color: "#b3261e", project: "Acme Dental" });
  });

  it("creates a workspace tag", async () => {
    on("post", "/tags", ok(tags[0], 201));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { name: "copy" }))).toBe("Created tag copy (tag_copy) for the workspace.");
    expect(recorded[0]?.body).toEqual({ name: "copy" });
  });

  it("refuses a color that is not hex before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { name: "mobile", color: "red" })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("surfaces an existing tag with the same name as the candidate", async () => {
    on("post", "/tags", fail(409, { code: "invalid", message: 'A tag named "Copy" already exists.', candidates: [{ id: "tag_copy", name: "copy" }] }));
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { name: "Copy" }));
    expect(error.code).toBe("invalid");
    expect(error.candidates).toEqual([{ id: "tag_copy", name: "copy" }]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { name: "mobile", project: "Acme" },
    method: "post",
    path: "/tags",
    success: ok(mobile, 201),
  });
});
