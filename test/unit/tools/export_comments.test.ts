import { describe, expect, it } from "vitest";
import type { ExportResponse } from "../../../src/client/types.ts";
import { UNTRUSTED_NOTICE } from "../../../src/lib/format.ts";
import { appliedProject } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, textOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_export_comments";

const inline: ExportResponse = {
  format: "markdown",
  row_count: 2,
  content: "| # | Text |\n|---|---|\n| 4821 | Button overlaps the nav |\n| 4822 | Typo in hero |",
  download_url: null,
  expires_at: null,
  applied_filters: appliedProject,
  scan: { scanned: 40, complete: true },
};

describe(TOOL, () => {
  it("returns inline content with the untrusted notice", async () => {
    on("get", "/comments/export", ok(inline));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", status: ["resolved"], updated_after: "this_week", format: "markdown" });
    expect(data(result)).toEqual(inline);
    expect(summaryOf(result)).toBe("Exported 2 comments in Acme Dental as markdown. The file content is inline below.");
    expect(textOf(result).split("\n")[1]).toBe(UNTRUSTED_NOTICE);
    expect(recorded[0]?.query).toEqual({
      project: "Acme Dental",
      status: "resolved",
      updated_after: "this_week",
      format: "markdown",
    });
  });

  it("returns a download link for large exports", async () => {
    const big: ExportResponse = {
      ...inline,
      format: "csv",
      row_count: 1200,
      content: null,
      download_url: "https://storage.example.com/export.csv?sig=1",
      expires_at: "2026-10-08T15:00:00Z",
    };
    on("get", "/comments/export", ok(big));
    const h = await connect();
    const result = await h.call(TOOL, { format: "csv" });
    expect(summaryOf(result)).toContain("Download it from https://storage.example.com/export.csv?sig=1 (expires 2026-10-08T15:00:00Z).");
    expect(textOf(result)).not.toContain(UNTRUSTED_NOTICE);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", format: "csv" },
    method: "get",
    path: "/comments/export",
    success: ok(inline),
  });
});
