import { describe, expect, it } from "vitest";
import { normalizeCommentRef, parseCommentNumber, parseReplyId, projectForComment } from "../../src/lib/resolve.ts";

describe("comment numbers", () => {
  it("parses 4821 and #4821", () => {
    expect(parseCommentNumber("4821")).toBe(4821);
    expect(parseCommentNumber(" #4821 ")).toBe(4821);
    expect(parseCommentNumber("cmt_4821")).toBeUndefined();
    expect(parseCommentNumber("48a")).toBeUndefined();
  });

  it("normalizes numbers for paths and leaves ids alone", () => {
    expect(normalizeCommentRef("#4821")).toBe("4821");
    expect(normalizeCommentRef(" cmt_8f3k2 ")).toBe("cmt_8f3k2");
  });

  it("injects the default project only for numbers without a project", () => {
    expect(projectForComment("#4821", undefined, "Acme")).toBe("Acme");
    expect(projectForComment("4821", "Other", "Acme")).toBe("Other");
    expect(projectForComment("cmt_1", undefined, "Acme")).toBeUndefined();
    expect(projectForComment("4821", undefined, undefined)).toBeUndefined();
  });
});

describe("parseReplyId", () => {
  it("splits at the last dot", () => {
    expect(parseReplyId("rpl_8f3k2.654321")).toEqual({ replyId: "rpl_8f3k2.654321", commentId: "cmt_8f3k2" });
    expect(parseReplyId("a.b.c")).toEqual({ replyId: "rpl_a.b.c", commentId: "cmt_a.b" });
  });

  it("rejects values without a usable dot", () => {
    expect(parseReplyId("4821")).toBeUndefined();
    expect(parseReplyId("rpl_.x")).toBeUndefined();
    expect(parseReplyId("rpl_x.")).toBeUndefined();
  });
});
