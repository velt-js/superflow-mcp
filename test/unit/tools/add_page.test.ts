import { describe, expect, it } from "vitest";
import { emptyPage } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_add_page";

describe(TOOL, () => {
  it("adds a page", async () => {
    on("post", "/projects/:project/pages", ok({ ...emptyPage, created: true }, 201));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", url: "https://acme.com/about", title: "About" });
    expect(data(result)).toEqual({ ...emptyPage, created: true });
    expect(summaryOf(result)).toBe("Added page https://acme.com/about to Acme Dental (pg_8y).");
    expect(recorded[0]?.body).toEqual({ url: "https://acme.com/about", title: "About" });
    expect(recorded[0]?.operationId).toBe("addPage");
  });

  it("says nothing changed for an existing page", async () => {
    on("post", "/projects/:project/pages", ok({ ...emptyPage, created: false }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", url: "https://acme.com/about" });
    expect(summaryOf(result)).toBe("Page https://acme.com/about already exists in Acme Dental. Nothing changed.");
    expect(recorded[0]?.body).toEqual({ url: "https://acme.com/about" });
  });

  it("also reads a { page, created } body", async () => {
    on("post", "/projects/:project/pages", ok({ page: emptyPage, created: false }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { project: "Acme Dental", url: "https://acme.com/about" }))).toContain("already exists");
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", url: "https://acme.com/about" },
    method: "post",
    path: "/projects/:project/pages",
    success: ok({ ...emptyPage, created: true }, 201),
  });
});
