import { describe, expect, it } from "vitest";
import { tags } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, seen, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_tag";
const renamed = { ...tags[0], name: "copywriting" };

describe(TOOL, () => {
  it("renames a tag and keeps its id", async () => {
    on("patch", "/tags/:tag", ok(renamed));
    const h = await connect();
    const result = await h.call(TOOL, { tag: "copy", name: "copywriting" });
    expect(data(result)).toEqual(renamed);
    expect(summaryOf(result)).toBe("Updated tag copywriting (tag_copy).");
    expect(recorded[0]?.path).toBe("/tags/copy");
    expect(recorded[0]?.body).toEqual({ name: "copywriting" });
  });

  it("refuses an empty change", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { tag: "copy" })).code).toBe("invalid");
    expect(seen).toEqual([]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { tag: "copy", color: "#000000" },
    method: "patch",
    path: "/tags/:tag",
    success: ok(renamed),
  });
});
