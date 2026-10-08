import { describe, expect, it } from "vitest";
import { project, projectFull } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_create_project";
const created = {
  ...projectFull,
  install_status: "not_installed",
  open_comment_count: 0,
  total_comment_count: 0,
  guest_invites: [{ email: "dana@acme.com", sent: true }],
};

describe(TOOL, () => {
  it("creates the project with guests and a generated idempotency key", async () => {
    on("post", "/projects", ok(created, 201));
    const h = await connect();
    const result = await h.call(TOOL, {
      name: "Acme Dental",
      site_url: "https://acme.com",
      platform: "webflow",
      guests: ["dana@acme.com"],
    });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual(created);
    expect(summaryOf(result)).toBe(
      `Created project Acme Dental for https://acme.com (prj_1a2b). Invited 1 guest. Next: get the script tag with superflow_get_install_snippet. Link: ${project.url}`,
    );
    const body = recorded[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ name: "Acme Dental", site_url: "https://acme.com", platform: "webflow", guests: ["dana@acme.com"] });
    expect(typeof body.idempotency_key).toBe("string");
    expect(body).not.toHaveProperty("copy_settings_from");
  });

  it("keeps a given idempotency key and says when an invite email was not sent", async () => {
    on("post", "/projects", ok({ ...created, guest_invites: [{ email: "dana@acme.com", sent: false }] }, 201));
    const h = await connect();
    const result = await h.call(TOOL, {
      name: "Acme Dental",
      site_url: "acme.com",
      guests: ["dana@acme.com"],
      copy_settings_from: "Acme Labs",
      idempotency_key: "k-1",
    });
    expect(recorded[0]?.body).toMatchObject({ idempotency_key: "k-1", copy_settings_from: "Acme Labs" });
    expect(summaryOf(result)).toContain("Invited 0 guests. The invite email could not be sent to dana@acme.com.");
  });

  it("retries a 503 because the request carries an idempotency key", async () => {
    on("post", "/projects", () => Response.json({ error: { code: "upstream", message: "Busy.", hint: "", candidates: [] } }, { status: 503 }), ok(created, 201));
    const h = await connect();
    const result = await h.call(TOOL, { name: "Acme Dental", site_url: "https://acme.com" });
    expect(result.isError).toBeFalsy();
    expect(recorded).toHaveLength(2);
    expect((recorded[0]?.body as { idempotency_key: string }).idempotency_key).toBe(
      (recorded[1]?.body as { idempotency_key: string }).idempotency_key,
    );
  });

  it("surfaces an existing project for the same domain as the candidate", async () => {
    on("post", "/projects", fail(409, {
      code: "ambiguous",
      message: "A project for acme.com already exists in this workspace.",
      candidates: [{ id: "prj_1a2b", name: "Acme Dental", url: project.url }],
    }));
    const h = await connect();
    const result = await h.call(TOOL, { name: "Acme", site_url: "https://acme.com" });
    expect(errorOf(result).candidates).toEqual([{ id: "prj_1a2b", name: "Acme Dental", url: project.url }]);
    expect(summaryOf(result)).toContain("Candidates: Acme Dental (prj_1a2b).");
  });

  it("rejects a bad guest email before calling the API", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { name: "Acme", site_url: "https://acme.com", guests: ["not-an-email"] });
    expect(errorOf(result).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { name: "Acme Dental", site_url: "https://acme.com" },
    method: "post",
    path: "/projects",
    success: ok(created, 201),
  });
});
