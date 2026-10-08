import { describe, expect, it } from "vitest";
import { CONFIRM_DELETE_REPLY_MESSAGE } from "../../../src/lib/confirm.ts";
import { list, reply } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_delete_reply";

describe(TOOL, () => {
  it("without confirm, reads the thread and returns the reply as a preview", async () => {
    on("get", "/comments/:comment/replies", ok(list([reply])));
    const h = await connect();
    const result = await h.call(TOOL, { reply: "rpl_8f3k2.654321" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({ needs_confirmation: true, preview: reply, message: CONFIRM_DELETE_REPLY_MESSAGE });
    expect(summaryOf(result)).toBe("Reply rpl_8f3k2.654321 by Jen would be deleted. Nothing was deleted. Ask the user to confirm.");
    expect(recorded[0]?.path).toBe("/comments/cmt_8f3k2/replies");
    expect(writes()).toEqual([]);
  });

  it("parses the parent at the last dot for raw ids", async () => {
    on("get", "/comments/:comment/replies", ok(list([{ ...reply, id: "rpl_a.b.c" }])));
    const h = await connect();
    const result = await h.call(TOOL, { reply: "a.b.c", confirm: false });
    expect(recorded[0]?.path).toBe("/comments/cmt_a.b/replies");
    expect(data(result).needs_confirmation).toBe(true);
    expect(writes()).toEqual([]);
  });

  it("returns not_found when the reply is not in the thread", async () => {
    on("get", "/comments/:comment/replies", ok(list([reply])));
    const h = await connect();
    const result = await h.call(TOOL, { reply: "rpl_8f3k2.999" });
    expect(errorOf(result).code).toBe("not_found");
    expect(writes()).toEqual([]);
  });

  it("rejects a value that is not a reply id", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { reply: "4821" });
    expect(errorOf(result).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("deletes with confirm: true", async () => {
    on("delete", "/replies/:reply", ok({ deleted: true, id: "rpl_8f3k2.654321" }));
    const h = await connect();
    const result = await h.call(TOOL, { reply: "rpl_8f3k2.654321", confirm: true });
    expect(summaryOf(result)).toBe("Deleted reply rpl_8f3k2.654321.");
    expect(recorded.map((r) => r.method)).toEqual(["DELETE"]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { reply: "rpl_8f3k2.654321", confirm: true },
    method: "delete",
    path: "/replies/:reply",
    success: ok({ deleted: true, id: "rpl_8f3k2.654321" }),
  });
});
