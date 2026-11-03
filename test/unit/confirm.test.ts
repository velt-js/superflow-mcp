import { describe, expect, it } from "vitest";
import { bulkMode, isConfirmed } from "../../src/lib/confirm.ts";

describe("bulkMode", () => {
  it.each([
    [{}, "dry_run"],
    [{ dry_run: true }, "dry_run"],
    [{ dry_run: true, confirm: true }, "dry_run"],
    [{ dry_run: false }, "needs_confirmation"],
    [{ dry_run: false, confirm: false }, "needs_confirmation"],
    [{ dry_run: false, confirm: true }, "apply"],
  ] as const)("%j is %s", (input, mode) => {
    expect(bulkMode(input)).toBe(mode);
  });
});

describe("isConfirmed", () => {
  it("is true only for an explicit true", () => {
    expect(isConfirmed(true)).toBe(true);
    expect(isConfirmed(false)).toBe(false);
    expect(isConfirmed(undefined)).toBe(false);
  });
});
