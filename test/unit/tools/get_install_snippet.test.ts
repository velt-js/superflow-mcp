import { describe, expect, it } from "vitest";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_get_install_snippet";
const snippet = {
  script_tag: '<script src="https://cdn.jsdelivr.net/npm/@usesuperflow/toolbar/superflow.min.js?apiKey=key1&projectId=1a2b"></script>',
  platform: "webflow",
  steps: ["Open Site settings > Custom code.", "Paste the script in the Footer code.", "Publish the site."],
  docs_url: "https://docs.usesuperflow.ai/install/webflow",
};

describe(TOOL, () => {
  it("returns the script tag and the platform steps", async () => {
    on("get", "/projects/:project/install", ok(snippet));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", platform: "webflow" });
    expect(data(result)).toEqual(snippet);
    expect(summaryOf(result)).toBe(
      "Install snippet for Acme Dental on webflow: 3 steps. Paste script_tag as the steps say, then check it with superflow_verify_install. Docs: https://docs.usesuperflow.ai/install/webflow",
    );
    expect(recorded[0]?.query).toEqual({ platform: "webflow" });
  });

  it("omits platform when not given", async () => {
    on("get", "/projects/:project/install", ok({ ...snippet, docs_url: null }));
    const h = await connect();
    await h.call(TOOL, { project: "Acme Dental" });
    expect(recorded[0]?.query).toEqual({});
  });

  it("rejects an unknown platform before calling the API", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental", platform: "squarespace" });
    expect(errorOf(result).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({
    tool: TOOL,
    args: { project: "Acme" },
    method: "get",
    path: "/projects/:project/install",
    success: ok(snippet),
  });
});
