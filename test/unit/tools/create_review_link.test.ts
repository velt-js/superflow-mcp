import { describe, expect, it } from "vitest";
import { reviewLink } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_create_review_link";
const created = { ...reviewLink, note: "Anyone with this link can see the project and comment as a guest." };

describe(TOOL, () => {
  it("creates a link and repeats the API's visibility note", async () => {
    on("post", "/review-links", ok(created, 201));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(data(result)).toEqual(created);
    expect(summaryOf(result)).toBe(
      "Created a review link for Acme Dental: https://acme.com/?sfShare=8a7b6c (lnk_8a7b6c). Anyone with this link can see the project and comment as a guest.",
    );
    const body = recorded[0]?.body as { project: string; idempotency_key: string };
    expect(body.project).toBe("Acme Dental");
    expect(body.idempotency_key).toBeTruthy();
  });

  it("explains the visibility itself when the API sends no note", async () => {
    on("post", "/review-links", ok(reviewLink, 201));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { project: "Acme Dental", idempotency_key: "k-1" }))).toContain(
      "Anyone with the link can open the project's site with the Superflow toolbar",
    );
  });

  it("passes the Velt-internal gate through as forbidden", async () => {
    on("post", "/review-links", fail(403, { code: "forbidden", message: "Review links are not available on this workspace yet." }));
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { project: "Acme Dental" }))).toMatchObject({
      code: "forbidden",
      message: "Review links are not available on this workspace yet.",
    });
  });

  standardErrorCases({ tool: TOOL, args: { project: "Acme" }, method: "post", path: "/review-links", success: ok(created, 201) });
});
