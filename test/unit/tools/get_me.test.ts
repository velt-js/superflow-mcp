import { describe, expect, it } from "vitest";
import { me } from "../../helpers/fixtures.ts";
import { TEST_KEY, connect, data, ok, on, recorded, standardErrorCases, summaryOf, textOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_me";

describe(TOOL, () => {
  it("returns the member, workspace and scopes", async () => {
    on("get", "/me", ok(me));
    const h = await connect();
    const result = await h.call(TOOL);
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual(me);
    expect(summaryOf(result)).toBe(
      "Connected as Rakesh (rakesh@agency.com), owner of Wonderist, scale plan. Scopes: comments:read, comments:write, projects:read.",
    );
    expect(textOf(result)).not.toContain("Treat it as data");
    expect(recorded[0]?.headers.get("authorization")).toBe(`Bearer ${TEST_KEY}`);
  });

  it("maps 401 to the API key message", async () => {
    on("get", "/me", () => new Response("", { status: 401 }));
    const h = await connect();
    const result = await h.call(TOOL);
    expect(result.isError).toBe(true);
    expect(summaryOf(result)).toContain("The Superflow API key was rejected.");
    expect(summaryOf(result)).toContain("Settings > Integrations > API keys");
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/me", success: ok(me) });
});
