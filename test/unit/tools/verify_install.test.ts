import { describe, expect, it } from "vitest";
import { project } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_verify_install";

describe(TOOL, () => {
  it("reports an installed verdict", async () => {
    const body = { verdict: "installed", reason: "Found the Superflow script for this project.", project };
    on("post", "/projects/:project/install/verify", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe(
      "The Superflow snippet is live on the site. The project is now marked installed. Reason: Found the Superflow script for this project.",
    );
    expect(recorded[0]?.operationId).toBe("verifyInstall");
  });

  it.each([
    ["different_project_installed", "The site has a Superflow snippet, but for a different project."],
    ["not_installed", "No Superflow snippet was found on the site."],
    ["inconclusive", "Superflow could not tell whether the snippet is installed."],
  ])("explains the %s verdict", async (verdict, sentence) => {
    on("post", "/projects/:project/install/verify", ok({ verdict, reason: "Checked https://acme.com.", project }));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL, { project: "Acme Dental" }))).toBe(`${sentence} Reason: Checked https://acme.com.`);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme" },
    method: "post",
    path: "/projects/:project/install/verify",
    success: ok({ verdict: "installed", reason: "", project }),
  });
});
