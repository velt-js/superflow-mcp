// Page admin tools: get one page, add a page, remove a page.
import { z } from "zod";
import type { AddedPage, Page, RemovePageResponse } from "../client/types.ts";
import { CONFIRM_REMOVE_PAGE_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, count, join } from "./helpers.ts";
import { confirmSchema, httpUrlSchema, projectRefSchema } from "./schemas.ts";

/** The API removes a page only when it has at most this many comments (CONTRACT-P2 section 3). */
export const REMOVE_PAGE_COMMENT_CAP = 200;

const pageRefSchema = z
  .string()
  .min(1)
  .describe('Page: its full URL ("https://acme.com/pricing"), its path ("/pricing") or its id (pg_...).');

function pageCounts(page: Page): string {
  if (page.total_comment_count === null && page.open_comment_count === null) return "comment counts unknown";
  return `${count(page.open_comment_count)} open of ${count(page.total_comment_count)} comments`;
}

export const getPage = defineTool({
  name: "superflow_get_page",
  title: "Get a page",
  description: [
    "Get one page of a project with its open and total comment counts and when it was last commented on.",
    'Give the page by full URL, path ("/pricing") or id. Use it to check one page.',
    "To see every page use superflow_list_pages. For the comments on the page use superflow_list_comments with page_url.",
    'Example: {"project": "Acme Dental", "page": "https://acme.com/pricing"}',
  ].join("\n"),
  inputSchema: { project: projectRefSchema, page: pageRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const page = await api.call<Page>("getPage", { path: { project: args.project, page: args.page } });
    const summary = join(
      `Page ${page.url ?? args.page}${page.title ? ` ("${page.title}")` : ""} in ${args.project}: ${pageCounts(page)}.`,
      page.last_comment_at && `Last comment ${page.last_comment_at}.`,
    );
    return okResult(summary, asData(page));
  },
});

export const addPage = defineTool({
  name: "superflow_add_page",
  title: "Add a page",
  description: [
    "Add a page to a project's page list so it shows in Superflow before anyone comments on it, for example to plan a review or a launch checklist.",
    "The URL must be on the project's domain or one of its extra domains. Safe to repeat: an existing page comes back with created false.",
    "Pages also appear by themselves when someone comments on them. To see the pages use superflow_list_pages.",
    'Example: {"project": "Acme Dental", "url": "https://acme.com/pricing", "title": "Pricing"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    url: httpUrlSchema.describe("Full URL of the page with http or https, on the project's domain."),
    title: z.string().min(1).max(300).optional().describe("Page title to show. Defaults to the URL."),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const page = await api.call<AddedPage>("addPage", {
      path: { project: args.project },
      body: compact({ url: args.url, title: args.title }),
    });
    const summary =
      page.created === false
        ? `Page ${page.url ?? args.url} already exists in ${args.project}. Nothing changed.`
        : `Added page ${page.url ?? args.url} to ${args.project}${page.id ? ` (${page.id})` : ""}.`;
    return okResult(summary, asData(page));
  },
});

export const removePage = defineTool({
  name: "superflow_remove_page",
  title: "Remove a page",
  description: [
    `Remove a page from a project and delete every comment on it (at most ${REMOVE_PAGE_COMMENT_CAP}). The comments can be restored one by one with superflow_restore_comment for 30 days.`,
    "Without confirm: true nothing is removed: you get the page and its comment count as a preview to show the user. Call again with confirm: true only after the user says yes.",
    "To delete a single comment use superflow_delete_comment. To resolve the page's comments instead use superflow_bulk_update_comments.",
    'Example: {"project": "Acme Dental", "page": "https://acme.com/old-pricing"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    page: pageRefSchema,
    confirm: confirmSchema("remove the page and delete its comments"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      const result = await api.call<RemovePageResponse>("removePage", {
        path: { project: args.project, page: args.page },
        query: { confirm: true },
      });
      const deleted = result.comments_deleted ?? 0;
      const summary = join(
        `Removed page ${result.id ?? args.page} from ${args.project} and deleted ${plural(deleted, "comment")}.`,
        deleted > 0 &&
          `They can be restored with superflow_restore_comment${result.restore_until ? ` until ${result.restore_until}` : " for 30 days"}.`,
      );
      return okResult(summary, asData(result));
    }
    // Preview: one read. Nothing that could remove is sent without confirm.
    const page = await api.call<Page>("getPage", { path: { project: args.project, page: args.page } });
    const total = page.total_comment_count;
    if (typeof total === "number" && total > REMOVE_PAGE_COMMENT_CAP) {
      return invalidInput(
        `Page ${page.url ?? args.page} has ${total} comments. Superflow removes a page only when it has ${REMOVE_PAGE_COMMENT_CAP} comments or fewer.`,
        "Resolve the comments with superflow_bulk_update_comments instead, or delete some first.",
      );
    }
    const comments = typeof total === "number" ? plural(total, "comment") : "an unknown number of comments";
    return confirmationResult(
      `Page ${page.url ?? args.page} in ${args.project} would be removed and its ${comments} deleted (restorable for 30 days). Nothing was removed. Ask the user to confirm.`,
      { preview: { page, comment_count: total ?? null }, message: CONFIRM_REMOVE_PAGE_MESSAGE },
    );
  },
});

export const pageTools = [getPage, addPage, removePage];
