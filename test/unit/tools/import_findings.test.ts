import { describe, expect, it } from "vitest";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_import_findings";

const finding = {
  page_url: "https://dental-smiles.com/about",
  title: "Missing alt text",
  description: "The hero image has no alt text.",
  severity: "high",
  rule_key: "image-alt",
  fix_type: "content",
  confidence: 90,
  anchor: { selector: "img.hero" },
};

const answer = {
  project: { id: "prj_p1", name: "Dental Smiles" },
  source: { id: "agt_sfx_stache-review", name: "Stache review", slug: "stache-review" },
  run_id: "run_r1",
  received: 40,
  created: 12,
  merged: 28,
  dropped: 0,
  failed: 0,
  install: { status: "installed", installed: true },
  results: [{ index: 0, outcome: "created", comment_id: "cmt_a1", rule_key: "image-alt" }],
};

describe(TOOL, () => {
  it("posts the findings to the project's import route with a generated idempotency key", async () => {
    on("post", "/projects/:project/findings/import", ok(answer));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Dental Smiles", source: "stache-review", source_name: "Stache review", findings: [finding] });
    expect(result.isError).toBeFalsy();
    expect(recorded[0]?.path).toBe("/projects/Dental%20Smiles/findings/import");
    expect(recorded[0]?.body).toMatchObject({ source: "stache-review", source_name: "Stache review", findings: [finding], idempotency_key: expect.any(String) });
    expect(recorded[0]?.body).not.toHaveProperty("project");
    expect(summaryOf(result)).toBe("Imported into Dental Smiles as Stache review: 12 created, 28 merged, 0 dropped, 0 failed. Run run_r1.");
    expect(data(result)).toEqual(answer);
  });

  it("says when the script is not installed, and how to retry failed ones", async () => {
    on("post", "/projects/:project/findings/import", ok({ ...answer, failed: 2, install: { status: "not_installed", installed: false } }));
    const h = await connect();
    const summary = summaryOf(await h.call(TOOL, { project: "p1", source: "stache-review", findings: [finding] }));
    expect(summary).toContain("Send the same batch again to retry the failed ones");
    expect(summary).toContain("superflow_get_install_snippet");
  });

  it("hands back every problem the API listed, so the model can fix the batch in one retry", async () => {
    on("post", "/projects/:project/findings/import", fail(400, {
      code: "invalid",
      message: "Nothing was imported: 2 findings have a problem.",
      hint: "",
      candidates: [],
      issues: [{ field: "findings[1].page_url", reason: "This page is not on the project's site." }, { field: "findings[3].rule_key", reason: "Not a Superflow rule key." }],
    }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "p1", source: "stache-review", findings: [finding, finding, finding, finding] });
    const error = errorOf(result) as { code: string; issues?: Array<{ field: string }> };
    expect(error.code).toBe("invalid");
    expect(error.issues?.map((issue) => issue.field)).toEqual(["findings[1].page_url", "findings[3].rule_key"]);
    expect(summaryOf(result)).toContain("2 problems, listed in error.issues");
  });

  it.each([
    ["a source with capitals", { source: "Stache Review" }],
    ["a missing fix_type", { findings: [{ ...finding, fix_type: undefined }] }],
    ["more than 500 findings", { findings: Array.from({ length: 501 }, () => finding) }],
    ["a page that is not a URL", { findings: [{ ...finding, page_url: "about" }] }],
  ])("rejects %s through the schema without a request", async (_label, change) => {
    const h = await connect();
    const result = await h.call(TOOL, { project: "p1", source: "stache-review", findings: [finding], ...change });
    expect(errorOf(result).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("is a write tool: not registered in read-only mode", async () => {
    const h = await connect({ readOnly: true });
    const { tools } = await h.client.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain(TOOL);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "p1", source: "stache-review", findings: [finding] },
    method: "post",
    path: "/projects/:project/findings/import",
    success: ok(answer),
  });
});
