import { describe, expect, it } from "vitest";
import { findInvalidDate, isValidDateFilter } from "../../src/lib/dates.ts";

describe("isValidDateFilter", () => {
  it.each(["24h", "7d", "2w", "1m", "today", "yesterday", "this_week", "last_week", "2026-10-01", "2026-10-01T09:00:00Z", "2026-10-01T09:00:00.123+02:00", "2026-10-01T09:00"])(
    "accepts %s",
    (value) => {
      expect(isValidDateFilter(value)).toBe(true);
    },
  );

  it.each(["", "0d", "7 days", "last tuesday", "2026-13-45", "10/01/2026", "tomorrow", "1y", "-7d"])("rejects %s", (value) => {
    expect(isValidDateFilter(value)).toBe(false);
  });
});

describe("findInvalidDate", () => {
  it("names the first bad field and lists the valid forms", () => {
    const message = findInvalidDate({ created_after: "7d", updated_before: "soon" });
    expect(message).toContain('updated_before "soon"');
    expect(message).toContain("this_week");
  });

  it("returns undefined when every date is valid or absent", () => {
    expect(findInvalidDate({ created_after: "2w", project: "x" })).toBeUndefined();
  });

  it("supports a prefix for nested filters", () => {
    expect(findInvalidDate({ resolved_after: "x" }, "filter.")).toContain("filter.resolved_after");
  });
});
