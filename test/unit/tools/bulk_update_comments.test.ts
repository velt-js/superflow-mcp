import { describe, expect, it } from "vitest";
import { CONFIRM_BULK_MESSAGE } from "../../../src/lib/confirm.ts";
import { appliedProject, compactComment } from "../../helpers/fixtures.ts";
import { connect, data, errorOf, fail, ok, on, recorded, standardErrorCases, summaryOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_bulk_update_comments";

const dryRun = {
  dry_run: true,
  would_update: 47,
  sample: [compactComment],
  applied_filters: { ...appliedProject, tags: [{ id: "tag_copy", name: "copy" }] },
};
const filterArgs = {
  filter: { project: "Acme Dental", tags: ["copy"], status: ["open"], page_url: "https://acme.com/" },
  patch: { resolve: true, note: "Copy updated." },
};

describe(TOOL, () => {
  it("is a dry run by default", async () => {
    on("post", "/comments/bulk", ok(dryRun));
    const h = await connect();
    const result = await h.call(TOOL, filterArgs);
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual(dryRun);
    expect(summaryOf(result)).toBe(
      "Dry run: 47 comments in Acme Dental (tags: copy) would change. Nothing was written. To apply it, ask the user, then call again with dry_run: false and confirm: true.",
    );
    expect(recorded[0]?.body).toEqual({
      select: { filter: filterArgs.filter },
      patch: filterArgs.patch,
      dry_run: true,
      confirm: false,
    });
  });

  it("dry_run false without confirm sends only a dry run and asks for confirmation", async () => {
    on("post", "/comments/bulk", ok(dryRun));
    const h = await connect();
    const result = await h.call(TOOL, { ...filterArgs, dry_run: false, idempotency_key: "k-1" });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toEqual({ needs_confirmation: true, preview: dryRun, message: CONFIRM_BULK_MESSAGE });
    expect(summaryOf(result)).toContain("Nothing was written because confirm was not true.");
    expect(recorded).toHaveLength(1);
    const body = recorded[0]?.body as Record<string, unknown>;
    expect(body.dry_run).toBe(true);
    expect(body.confirm).toBe(false);
    expect(body).not.toHaveProperty("idempotency_key");
  });

  it("writes with dry_run false and confirm true", async () => {
    on("post", "/comments/bulk", ok({ dry_run: false, updated: 46, failed: [{ id: "cmt_x", error: "Velt could not reach this comment." }] }));
    const h = await connect();
    const result = await h.call(TOOL, { ...filterArgs, dry_run: false, confirm: true, idempotency_key: "k-1" });
    expect(result.isError).toBeFalsy();
    expect(summaryOf(result)).toBe("Updated 46 comments. 1 failed: cmt_x (Velt could not reach this comment.).");
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
    expect(recorded).toHaveLength(0);
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
