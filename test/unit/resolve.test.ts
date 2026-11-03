import { describe, expect, it } from "vitest";
import { normalizeCommentRef, parseReplyId } from "../../src/lib/resolve.ts";

describe("comment references", () => {
  it("trims ids, and turns a comment link into its cmt_ id", () => {
    expect(normalizeCommentRef(" cmt_8f3k2 ")).toBe("cmt_8f3k2");
    expect(normalizeCommentRef("8f3k2")).toBe("8f3k2");
    expect(normalizeCommentRef(" https://acme.com/pricing?scommentId=8f3k2 ")).toBe("cmt_8f3k2");
    expect(normalizeCommentRef("HTTP://acme.com/a/b?x=1&scommentId=8f3k2#top")).toBe("cmt_8f3k2");
  });

  it("passes a link without scommentId, or one that does not parse, through for the API", () => {
    expect(normalizeCommentRef("https://acme.com/pricing")).toBe("https://acme.com/pricing");
    expect(normalizeCommentRef("https://acme.com/pricing?scommentId=")).toBe("https://acme.com/pricing?scommentId=");
    expect(normalizeCommentRef("https://")).toBe("https://");
  });
});

describe("parseReplyId", () => {
  it("splits at the last dot", () => {
    expect(parseReplyId("rpl_8f3k2.654321")).toEqual({ replyId: "rpl_8f3k2.654321", commentId: "cmt_8f3k2" });
    expect(parseReplyId("a.b.c")).toEqual({ replyId: "rpl_a.b.c", commentId: "cmt_a.b" });
  });

  it("rejects values without a usable dot", () => {
    expect(parseReplyId("8f3k2")).toBeUndefined();
    expect(parseReplyId("rpl_.x")).toBeUndefined();
    expect(parseReplyId("rpl_x.")).toBeUndefined();
  });
});
