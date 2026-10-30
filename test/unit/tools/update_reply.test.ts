import { describe, expect, it } from "vitest";
import { reply } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_update_reply";

describe(TOOL, () => {
  it("edits the reply text", async () => {
    const edited = { ...reply, text: "Fixed in v2.3", edited: true };
    on("patch", "/replies/:reply", ok(edited));
    const h = await connect();
    const result = await h.call(TOOL, { reply: "rpl_8f3k2.654321", text: "Fixed in v2.3" });
    expect(data(result)).toEqual(edited);
    expect(summaryOf(result)).toBe("Updated reply rpl_8f3k2.654321.");
    expect(recorded[0]?.path).toBe("/replies/rpl_8f3k2.654321");
    expect(recorded[0]?.body).toEqual({ text: "Fixed in v2.3" });
  });

  standardErrorCases({
    tool: TOOL,
    args: { reply: "rpl_8f3k2.654321", text: "x" },
    method: "patch",
    path: "/replies/:reply",
    success: ok(reply),
  });
});
