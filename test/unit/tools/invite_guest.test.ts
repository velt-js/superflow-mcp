import { describe, expect, it } from "vitest";
import { guestInvite } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_invite_guest";

describe(TOOL, () => {
  it("invites guests to the project and flags emails that were not sent", async () => {
    on("post", "/projects/:project/guests", ok(guestInvite, 201));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", emails: ["dana@acme.com", "lee@acme.com"] });
    expect(data(result)).toEqual(guestInvite);
    expect(summaryOf(result)).toBe(
      "Invited 2 guests to Acme Dental: dana@acme.com, lee@acme.com. The invite email could not be sent to lee@acme.com. Tell the user so they can let those people know. Guest seats: 4 of unlimited used (was 2).",
    );
    expect(recorded[0]?.path).toBe("/projects/Acme%20Dental/guests");
    expect(recorded[0]?.body).toMatchObject({ emails: ["dana@acme.com", "lee@acme.com"] });
  });

  it("needs at least one email", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { project: "Acme Dental", emails: [] })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme", emails: ["dana@acme.com"] },
    method: "post",
    path: "/projects/:project/guests",
    success: ok(guestInvite, 201),
  });
});
