import { describe, expect, it } from "vitest";
import { CONFIRM_REVOKE_REVIEW_LINK_MESSAGE } from "../../../src/lib/confirm.ts";
import { list, reviewLink } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_revoke_review_link";

describe(TOOL, () => {
  it("without confirm, reads the active links and returns the link as a preview", async () => {
    on("get", "/review-links", ok(list([reviewLink])));
    const h = await connect();
    const result = await h.call(TOOL, { link: "8a7b6c" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({ needs_confirmation: true, preview: reviewLink, message: CONFIRM_REVOKE_REVIEW_LINK_MESSAGE });
    expect(summaryOf(result)).toBe(
      "Review link lnk_8a7b6c (https://acme.com/?sfShare=8a7b6c) for project prj_1a2b would be revoked. Nothing was revoked. Ask the user to confirm.",
    );
    expect(writes()).toEqual([]);
  });

  it("returns not_found for a link that is not active", async () => {
    on("get", "/review-links", ok(list([reviewLink])));
    const h = await connect();
    const error = errorOf(await h.call(TOOL, { link: "lnk_gone" }));
    expect(error.code).toBe("not_found");
    expect(writes()).toEqual([]);
  });

  it("revokes with confirm: true, and says when it was already revoked", async () => {
    on("delete", "/review-links/:link", ok({ revoked: true, id: "lnk_8a7b6c", changed: true }), ok({ revoked: true, id: "lnk_8a7b6c", changed: false }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { link: "lnk_8a7b6c", confirm: true }))).toBe("Revoked review link lnk_8a7b6c. It no longer works.");
    expect(summaryOf(await h.call(TOOL, { link: "lnk_8a7b6c", confirm: true }))).toBe(
      "Review link lnk_8a7b6c was already revoked. Nothing changed.",
    );
    expect(recorded.map((r) => r.method)).toEqual(["DELETE", "DELETE"]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { link: "lnk_8a7b6c", confirm: true },
    method: "delete",
    path: "/review-links/:link",
    success: ok({ revoked: true, id: "lnk_8a7b6c" }),
  });
});
