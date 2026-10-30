import { describe, expect, it } from "vitest";
import { CONFIRM_REMOVE_GUEST_MESSAGE } from "../../../src/lib/confirm.ts";
import { guest, list } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw, writes } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_remove_guest";
const other = { ...guest, id: "gst_6", name: "Dana Other", email: "dana@other.com" };

describe(TOOL, () => {
  it("without confirm, only lists the guests and returns the guest as a preview", async () => {
    on("get", "/projects/:project/guests", ok(list([guest, other])));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", guest: "DANA@acme.com" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({ needs_confirmation: true, preview: guest, message: CONFIRM_REMOVE_GUEST_MESSAGE });
    expect(summaryOf(result)).toBe(
      "Guest Dana Client (dana@acme.com) would be removed from project Acme Dental. Nothing was removed. Ask the user to confirm.",
    );
    expect(writes()).toEqual([]);
  });

  it("finds a guest by raw id or a unique name prefix", async () => {
    on("get", "/projects/:project/guests", ok(list([guest, other])));
    const h = await connect();
    expect((data(await h.call(TOOL, { project: "Acme Dental", guest: "5" })).preview as { id: string }).id).toBe("gst_5");
    expect((data(await h.call(TOOL, { project: "Acme Dental", guest: "dana o" })).preview as { id: string }).id).toBe("gst_6");
    expect(writes()).toEqual([]);
  });

  it("returns ambiguous candidates for a shared name prefix, and not_found for a stranger", async () => {
    on("get", "/projects/:project/guests", ok(list([guest, other])));
    const h = await connect();
    const ambiguous = errorOf(await h.call(TOOL, { project: "Acme Dental", guest: "Dana" }));
    expect(ambiguous.code).toBe("ambiguous");
    expect(ambiguous.candidates).toEqual([
      { id: "gst_5", name: "Dana Client" },
      { id: "gst_6", name: "Dana Other" },
    ]);
    const missing = errorOf(await h.call(TOOL, { project: "Acme Dental", guest: "jen@agency.com" }));
    expect(missing.code).toBe("not_found");
    expect(missing.hint).toContain("superflow_remove_member");
    expect(writes()).toEqual([]);
  });

  it("removes with confirm: true", async () => {
    on("delete", "/projects/:project/guests/:guest", ok({ removed: true, id: "gst_5", project: "prj_1a2b" }));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", guest: "dana@acme.com", confirm: true });
    expect(summaryOf(result)).toBe("Removed guest dana@acme.com (gst_5) from project Acme Dental.");
    expect(recorded.map((r) => [r.method, r.path, r.query])).toEqual([
      ["DELETE", "/projects/Acme%20Dental/guests/dana%40acme.com", { confirm: "true" }],
    ]);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", guest: "dana@acme.com", confirm: true },
    method: "delete",
    path: "/projects/:project/guests/:guest",
    success: ok({ removed: true, id: "gst_5", project: "prj_1a2b" }),
  });
});
