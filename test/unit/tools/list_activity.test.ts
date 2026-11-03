import { describe, expect, it } from "vitest";
import { activityEntry, list } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_list_activity";

describe(TOOL, () => {
  it("lists API changes with filters and pagination", async () => {
    const body = list([activityEntry], { next_cursor: "c2" });
    on("get", "/activity", ok(body));
    const h = await connect();
    const result = await h.call(TOOL, { actor: "me", entity: "cmt_8f3k2", action: "updateComment", since: "7d", limit: 10 });
    expect(data(result)).toEqual(body);
    expect(summaryOf(result)).toBe(
      "Found 1 change. Latest: updateComment by Rakesh at 2026-10-08T10:00:00Z. Showing 1. More results exist. Call again with cursor=c2 for more.",
    );
    expect(recorded[0]?.query).toEqual({ actor: "me", entity: "cmt_8f3k2", action: "updateComment", since: "7d", limit: "10" });
  });

  it("defaults the limit to 25", async () => {
    on("get", "/activity", ok(list([])));
    const h = await connect();
    expect(summaryOf(await h.call(TOOL))).toBe("Found 0 changes.");
    expect(recorded[0]?.query).toEqual({ limit: "25" });
  });

  it("rejects a bad date before calling the API", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { since: "a while ago" })).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  standardErrorCases({ tool: TOOL, args: {}, method: "get", path: "/activity", success: ok(list([activityEntry])) });
});
