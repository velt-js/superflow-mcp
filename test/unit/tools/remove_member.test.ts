import { describe, expect, it } from "vitest";
import { CONFIRM_REMOVE_MEMBER_MESSAGE } from "../../../src/lib/confirm.ts";
import { member } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_remove_member";
const needsConfirmation = fail(409, {
  code: "needs_confirmation",
  message: "Removing a member needs confirm=true.",
  preview: { member, open_assigned_count: 7 },
});

describe(TOOL, () => {
  it("without confirm, never sends confirm and returns the API's preview", async () => {
    on("delete", "/members/:member", needsConfirmation);
    const h = await connect();
    const result = await h.call(TOOL, { member: "jen@agency.com", reassign_to: "rakesh@agency.com" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({
      needs_confirmation: true,
      preview: { member, open_assigned_count: 7 },
      message: CONFIRM_REMOVE_MEMBER_MESSAGE,
    });
    expect(summaryOf(result)).toBe(
      "Member Jen (jen@agency.com) would be removed from the workspace. 7 open comments are assigned to them and would move to rakesh@agency.com. Nothing was removed. Ask the user to confirm.",
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.query).toEqual({ reassign_to: "rakesh@agency.com" });
    expect(recorded[0]?.query).not.toHaveProperty("confirm");
  });

  it("says comments stay assigned when no reassign_to is given", async () => {
    on("delete", "/members/:member", needsConfirmation);
    const h = await connect();
    const result = await h.call(TOOL, { member: "Jen", confirm: false });
    expect(summaryOf(result)).toContain("7 open comments are assigned to them and would stay assigned to them.");
    expect(recorded[0]?.query).toEqual({});
  });

  it("says the count is a minimum when the API's scan stopped early", async () => {
    on("delete", "/members/:member", fail(409, {
      code: "needs_confirmation",
      message: "Removing a member needs confirm=true.",
      preview: { member, open_assigned_count: 40, scan: { scanned: 10000, complete: false } },
    }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { member: "Jen" }))).toContain("at least 40 open comments are assigned to them");
  });

  it("passes the API's refusals through: 403 for a non-owner or the owner, 400 for yourself", async () => {
    on(
      "delete",
      "/members/:member",
      fail(403, { code: "forbidden", message: "Only the workspace owner can remove members." }),
      fail(400, { code: "invalid", message: "You cannot remove yourself." }),
    );
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { member: "jen@agency.com" }))).toMatchObject({
      code: "forbidden",
      message: "Only the workspace owner can remove members.",
    });
    expect(errorOf(await h.call(TOOL, { member: "me" }))).toMatchObject({ code: "invalid", message: "You cannot remove yourself." });
  });

  it("removes with confirm: true and reports reassigned and still assigned comments", async () => {
    on("delete", "/members/:member", ok({ removed: true, id: "usr_2", reassigned: 5, still_assigned: 2 }));
    const h = await connect();
    const result = await h.call(TOOL, { member: "jen@agency.com", reassign_to: "Rakesh", confirm: true });
    expect(summaryOf(result)).toBe(
      "Removed member jen@agency.com (usr_2) from the workspace. Reassigned 5 open comments to Rakesh. 2 open comments still assigned to the removed member. Reassign them with superflow_bulk_update_comments or in Superflow.",
    );
    expect(recorded[0]?.query).toEqual({ confirm: "true", reassign_to: "Rakesh" });
  });

  standardErrorCases({
    tool: TOOL,
    args: { member: "Jen", confirm: true },
    method: "delete",
    path: "/members/:member",
    success: ok({ removed: true, id: "usr_2", reassigned: 0, still_assigned: 0 }),
  });
});
