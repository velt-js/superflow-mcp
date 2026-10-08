import { describe, expect, it } from "vitest";
import { CONFIRM_BULK_MESSAGE } from "../../../src/lib/confirm.ts";
import { appliedProject, compactComment } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_bulk_update_comments";

const dryRun = {
  dry_run: true,
  would_update: 44,
  already_in_state: 3,
  sample: [compactComment],
  applied_filters: { ...appliedProject, tags: [{ id: "tag_copy", name: "copy" }] },
  scan: { scanned: 312, complete: true },
};
const filterArgs = {
  filter: { project: "Acme Dental", tags: ["copy"], status: ["open"], page_url: "https://acme.com/" },
  patch: { resolve: true, note: "Copy updated." },
};

describe(TOOL, () => {
  it("is a dry run by default and reports what would change and what already matches", async () => {
    on("post", "/comments/bulk", ok(dryRun));
    const h = await connect();
    const result = await h.call(TOOL, filterArgs);
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual(dryRun);
    expect(summaryOf(result)).toBe(
      "Dry run. Would change 44 comments in Acme Dental (tags: copy). 3 already match. Nothing was written. To apply it, ask the user, then call again with dry_run: false and confirm: true.",
    );
    expect(recorded[0]?.body).toEqual({
      select: { filter: filterArgs.filter },
      patch: filterArgs.patch,
      dry_run: true,
      confirm: false,
    });
  });

  it("says there is nothing to apply when every comment already matches", async () => {
    on("post", "/comments/bulk", ok({ ...dryRun, would_update: 0, already_in_state: 47, sample: [] }));
    const h = await connect();
    const result = await h.call(TOOL, { ...filterArgs, dry_run: false });
    expect(result.isError).toBeFalsy();
    expect(data(result)).not.toHaveProperty("needs_confirmation");
    expect(summaryOf(result)).toBe(
      "Dry run. No comments in Acme Dental (tags: copy) would change. 47 already match. Nothing was written and there is nothing to apply.",
    );
  });

  it("dry_run false without confirm sends only a dry run and asks for confirmation", async () => {
    on("post", "/comments/bulk", ok(dryRun));
    const h = await connect();
    const result = await h.call(TOOL, { ...filterArgs, dry_run: false, idempotency_key: "k-1" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({ needs_confirmation: true, preview: dryRun, message: CONFIRM_BULK_MESSAGE });
    expect(summaryOf(result)).toBe(
      "Would change 44 comments in Acme Dental (tags: copy). 3 already match. Nothing was written because confirm was not true. Ask the user to confirm.",
    );
    expect(recorded).toHaveLength(1);
    const body = recorded[0]?.body as Record<string, unknown>;
    expect(body.dry_run).toBe(true);
    expect(body.confirm).toBe(false);
    expect(body).not.toHaveProperty("idempotency_key");
  });

  it("writes with dry_run false and confirm true and reports updated, unchanged and failed", async () => {
    on(
      "post",
      "/comments/bulk",
      ok({ dry_run: false, updated: 43, unchanged: 3, failed: [{ id: "cmt_x", error: "Velt could not reach this comment." }] }),
    );
    const h = await connect();
    const result = await h.call(TOOL, { ...filterArgs, dry_run: false, confirm: true, idempotency_key: "k-1" });
    expect(result.isError).toBeFalsy();
    expect(summaryOf(result)).toBe(
      "Updated 43 comments. 3 already matched and were skipped. 1 failed: cmt_x (Velt could not reach this comment.).",
    );
    expect(recorded[0]?.body).toEqual({
      select: { filter: filterArgs.filter },
      patch: filterArgs.patch,
      dry_run: false,
      confirm: true,
      idempotency_key: "k-1",
    });
  });

  it("selects by ids and injects the default project for numbers", async () => {
    on("post", "/comments/bulk", ok(dryRun));
    const h = await connect({ defaultProject: "Acme Dental" });
    await h.call(TOOL, { comment_ids: ["#4821", "4822", "cmt_9x"], patch: { assignees: ["Jen"], priority: "high" } });
    expect((recorded[0]?.body as { select: unknown }).select).toEqual({
      comment_ids: ["4821", "4822", "cmt_9x"],
      project: "Acme Dental",
    });
  });

  it("sends project with a filter so the API can use it as the filter's project", async () => {
    on("post", "/comments/bulk", ok(dryRun));
    const h = await connect({ defaultProject: "Other" });
    await h.call(TOOL, { project: "Acme Dental", filter: { tags: ["copy"] }, patch: { add_tags: ["done"] } });
    expect((recorded[0]?.body as { select: unknown }).select).toEqual({ filter: { tags: ["copy"] }, project: "Acme Dental" });
  });

  it("surfaces the API refusing a filter whose scan did not complete", async () => {
    on(
      "post",
      "/comments/bulk",
      fail(400, {
        code: "invalid",
        message: "The filter matched more comments than one scan covers (scanned 10000).",
        hint: "Narrow the filter, for example by project or date.",
      }),
    );
    const h = await connect();
    const result = await h.call(TOOL, { filter: { status: ["open"] }, patch: { priority: "medium" } });
    const error = errorOf(result);
    expect(error.code).toBe("invalid");
    expect(summaryOf(result)).toContain("Narrow the filter");
  });

  it("turns an API needs_confirmation into a confirmation result", async () => {
    on(
      "post",
      "/comments/bulk",
      fail(409, {
        code: "needs_confirmation",
        message: "This would change 47 comments.",
        preview: { would_update: 47, sample: [compactComment] },
      }),
    );
    const h = await connect();
    const result = await h.call(TOOL, { ...filterArgs, dry_run: false, confirm: true });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toMatchObject({ needs_confirmation: true, preview: { would_update: 47 } });
  });

  it("validates the selection and the patch locally", async () => {
    const h = await connect();
    expect(errorOf(await h.call(TOOL, { patch: { resolve: true } })).message).toContain("exactly one of comment_ids or filter");
    expect(
      errorOf(await h.call(TOOL, { comment_ids: ["1"], filter: { project: "A" }, patch: { resolve: true } })).message,
    ).toContain("exactly one");
    expect(errorOf(await h.call(TOOL, { filter: {}, patch: { resolve: true } })).message).toContain("filter is empty");
    expect(errorOf(await h.call(TOOL, { filter: { project: "A" }, patch: {} })).message).toContain("patch is empty");
    expect(errorOf(await h.call(TOOL, { filter: { project: "A" }, patch: { resolve: true, reopen: true } })).message).toContain(
      "resolve or reopen",
    );
    expect(errorOf(await h.call(TOOL, { filter: { project: "A" }, patch: { resolve: true, status: "Open" } })).message).toContain(
      "status or resolve",
    );
    expect(errorOf(await h.call(TOOL, { filter: { project: "A", created_after: "nope" }, patch: { resolve: true } })).message).toContain(
      "filter.created_after",
    );
    expect(errorOf(await h.call(TOOL, { filter: { project: "A" }, patch: { assignees: ["unassigned"] } })).message).toBe(
      "Removing the assignee is not supported yet.",
    );
    expect(recorded).toHaveLength(0);
  });

  it.each([
    ["priority low", { priority: "low" }],
    ["priority none", { priority: "none" }],
    ["an empty assignees list", { assignees: [] }],
  ])("rejects %s in the patch through the schema", async (_label, patch) => {
    const h = await connect();
    const result = await h.call(TOOL, { filter: { project: "A" }, patch });
    expect(errorOf(result).code).toBe("invalid");
    expect(recorded).toHaveLength(0);
  });

  it("still accepts low and none as priority filters", async () => {
    on("post", "/comments/bulk", ok(dryRun));
    const h = await connect();
    const result = await h.call(TOOL, { filter: { project: "A", priority: ["low", "none"] }, patch: { priority: "medium" } });
    expect(result.isError).toBeFalsy();
    expect((recorded[0]?.body as { select: { filter: unknown } }).select.filter).toEqual({ project: "A", priority: ["low", "none"] });
  });

  it("does not retry an unkeyed real run on 503", async () => {
    on("post", "/comments/bulk", () => new Response("", { status: 503 }));
    const h = await connect();
    const result = await h.call(TOOL, { ...filterArgs, dry_run: false, confirm: true });
    expect(errorOf(result).code).toBe("upstream");
    expect(recorded).toHaveLength(1);
  });

  standardErrorCases({ tool: TOOL, args: filterArgs, method: "post", path: "/comments/bulk", success: ok(dryRun) });
});
