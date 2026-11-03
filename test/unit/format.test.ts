import { describe, expect, it } from "vitest";
import { SuperflowApiError } from "../../src/client/api.ts";
import {
  MAX_TEXT_CHARS,
  UNTRUSTED_NOTICE,
  containsCommentText,
  describeFilters,
  errorResult,
  okResult,
  paginationNote,
  toCompactComment,
} from "../../src/lib/format.ts";
import { compactComment, fullComment } from "../helpers/fixtures.ts";

function text(result: ReturnType<typeof okResult>): string {
  const first = result.content[0];
  return first && first.type === "text" ? first.text : "";
}

describe("okResult", () => {
  it("puts the summary first, then a blank line, then pretty JSON", () => {
    const result = okResult("Found 2 tags.", { items: [{ name: "copy" }] });
    expect(text(result)).toBe(`Found 2 tags.\n\n${JSON.stringify({ items: [{ name: "copy" }] }, null, 2)}`);
    expect(result.structuredContent).toEqual({ items: [{ name: "copy" }] });
    expect(result.isError).toBeUndefined();
  });

  it("adds the untrusted notice right after the summary only when comment text is present", () => {
    const withText = text(okResult("One comment.", { items: [compactComment] }));
    expect(withText.split("\n").slice(0, 3)).toEqual(["One comment.", UNTRUSTED_NOTICE, ""]);
    const withoutText = text(okResult("Two tags.", { items: [{ name: "copy", usage_count: 2 }] }));
    expect(withoutText).not.toContain(UNTRUSTED_NOTICE);
    const emptyText = text(okResult("x", { items: [{ text: "  " }] }));
    expect(emptyText).not.toContain(UNTRUSTED_NOTICE);
  });

  it("lets a caller force the notice on or off", () => {
    expect(text(okResult("Export.", { content: "csv" }, { untrusted: true }))).toContain(UNTRUSTED_NOTICE);
    expect(text(okResult("x", { items: [compactComment] }, { untrusted: false }))).not.toContain(UNTRUSTED_NOTICE);
  });

  it("keeps the summary to one line", () => {
    expect(text(okResult("a\nb\n\nc", {})).split("\n")[0]).toBe("a b c");
  });

  it("truncates items from the end to stay under the cap and says how to page", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ ...compactComment, number: i, text: "x".repeat(400) }));
    const result = okResult("Found 100 comments.", { items, next_cursor: "c2", total: 900 });
    const body = text(result);
    expect(body.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    const data = result.structuredContent as { items: unknown[]; truncated: boolean; next_cursor: string };
    expect(data.truncated).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.length).toBeLessThan(100);
    expect(data.next_cursor).toBe("c2");
    const summary = body.split("\n")[0] ?? "";
    expect(summary).toContain(`Truncated: dropped the last ${100 - data.items.length} of 100 items`);
    expect(summary).toContain(`limit=${data.items.length}`);
    expect((data.items.at(-1) as { number: number }).number).toBe(data.items.length - 1);
  });

  it("truncates large export content", () => {
    const result = okResult("Exported.", { format: "csv", row_count: 400, content: "a,b\n".repeat(20_000) }, { untrusted: true });
    expect(text(result).length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    const data = result.structuredContent as { truncated: boolean; content: string };
    expect(data.truncated).toBe(true);
    expect(text(result).split("\n")[0]).toContain("Truncated: the content was cut to");
  });

  it("does not mark small results as truncated", () => {
    expect(okResult("x", { items: [compactComment] }).structuredContent).not.toHaveProperty("truncated");
  });
});

describe("containsCommentText", () => {
  it("finds text in nested replies", () => {
    expect(containsCommentText({ comment: { replies: [{ text: "hi" }] } })).toBe(true);
    expect(containsCommentText({ rows: [{ label: "Open", count: 2 }] })).toBe(false);
  });
});

describe("errorResult", () => {
  it("returns isError with the contract error shape and a one-line summary", () => {
    const result = errorResult(
      new SuperflowApiError({
        status: 409,
        code: "ambiguous",
        message: "Acme matches 2 projects.",
        hint: "Pick one.",
        candidates: [
          { id: "prj_1", name: "Acme Dental" },
          { id: "prj_2", name: "Acme Labs" },
        ],
      }),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: {
        code: "ambiguous",
        message: "Acme matches 2 projects.",
        hint: "Pick one.",
        candidates: [
          { id: "prj_1", name: "Acme Dental" },
          { id: "prj_2", name: "Acme Labs" },
        ],
      },
    });
    expect(text(result).split("\n")[0]).toBe(
      "Error (ambiguous): Acme matches 2 projects. Pick one. Candidates: Acme Dental (prj_1), Acme Labs (prj_2).",
    );
  });

  it("wraps unexpected errors as upstream", () => {
    const result = errorResult(new Error("boom"));
    expect((result.structuredContent as { error: { code: string } }).error.code).toBe("upstream");
  });
});

describe("paginationNote", () => {
  it("uses the total when present", () => {
    expect(paginationNote({ items: new Array(25).fill(0), next_cursor: "abc", total: 140 })).toBe(
      "Showing 25 of 140. Call again with cursor=abc for more.",
    );
  });
  it("still says more exist without a total", () => {
    expect(paginationNote({ items: [1, 2], next_cursor: "n" })).toBe("Showing 2. More results exist. Call again with cursor=n for more.");
  });
  it("is empty on the last page", () => {
    expect(paginationNote({ items: [1], next_cursor: null })).toBe("");
  });
});

describe("describeFilters", () => {
  it("names resolved projects and key filters", () => {
    expect(
      describeFilters({
        project: [{ id: "prj_1", name: "Acme Dental" }],
        assignee: [{ id: null, name: "unassigned" }],
        priority: ["high"],
        unanswered: true,
      }),
    ).toBe("in Acme Dental (assignee: unassigned; priority: high)");
    expect(describeFilters(undefined)).toBe("");
  });
});

describe("toCompactComment", () => {
  it("maps a full comment to the compact row", () => {
    expect(toCompactComment(fullComment)).toEqual(compactComment);
  });
  it("truncates long text to 160 characters", () => {
    expect(toCompactComment({ ...fullComment, text: "y".repeat(200) }).text).toBe(`${"y".repeat(160)}...`);
  });
});
