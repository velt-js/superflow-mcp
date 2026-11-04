import { describe, expect, it } from "vitest";
import { list, reviewLink } from "../../helpers/fixtures.ts";
import { connect, data, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_review_links";

describe(TOOL, () => {
  it("lists the active links, filtered by project", async () => {
    on("get", "/review-links", ok(list([reviewLink])));
    const h = await connect();
    const result = await h.call(TOOL, { project: "Acme Dental" });
    expect(data(result)).toEqual(list([reviewLink]));
    expect(summaryOf(result)).toBe("1 active review link: lnk_8a7b6c (https://acme.com/?sfShare=8a7b6c).");
    expect(recorded[0]?.query).toEqual({ project: "Acme Dental" });
  });

  it("lists every project's links without a filter", async () => {
    on("get", "/review-links", ok(list([])));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL))).toBe("0 active review links.");
    expect(recorded[0]?.query).toEqual({});
  });

  standardErrorCases({ tool: TOOL, args: { project: "Acme" }, method: "get", path: "/review-links", success: ok(list([reviewLink])) });
});
