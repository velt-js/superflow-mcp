// Review link tools: list, create and revoke public review links (preview shares).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type { ListEnvelope, ReviewLink, RevokeReviewLinkResponse } from "../client/types.ts";
import { CONFIRM_REVOKE_REVIEW_LINK_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, errorResult, okResult, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, join } from "./helpers.ts";
import { confirmSchema, idempotencySchema, projectRefSchema } from "./schemas.ts";

const VISIBILITY_NOTE =
  "Anyone with the link can open the project's site with the Superflow toolbar and see and add comments as a guest, without an invite.";

export const listReviewLinks = defineTool({
  name: "superflow_list_review_links",
  title: "List review links",
  description: [
    "List the active review links: public links that let anyone open a project's site with the Superflow toolbar and comment as a guest.",
    "Use it to see which projects are shared this way, or to get a link id before revoking it.",
    'Example: {"project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema.optional().describe("Only this project's link (name, site URL or id). Omit for every project."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = await api.call<ListEnvelope<ReviewLink>>("listReviewLinks", { query: { project: args.project } });
    const items = list.items ?? [];
    const shown = items
      .slice(0, 5)
      .map((link) => `${link.id} (${link.url})`)
      .join(", ");
    return okResult(
      `${plural(items.length, "active review link")}${shown ? `: ${shown}${items.length > 5 ? ", ..." : ""}` : ""}.`,
      asData(list),
    );
  },
});

export const createReviewLink = defineTool({
  name: "superflow_create_review_link",
  title: "Create a review link",
  description: [
    `Create a public review link for a project. ${VISIBILITY_NOTE} The project becomes visible to anyone who has the link.`,
    "Creating links is only available to Velt-internal accounts for now: other callers get a forbidden error. A project has at most one active link; creating again returns it. While the link is active the project is in preview, which blocks archiving, install checks and settings changes.",
    "Ask the user before creating one, and tell them who will be able to see the project. To invite specific people instead use superflow_invite_guest. To stop sharing use superflow_revoke_review_link.",
    'Example: {"project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    idempotency_key: idempotencySchema,
  },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api }) {
    const link = await api.call<ReviewLink>("createReviewLink", {
      // Generated once per tool call, so the client's own retries cannot create two links.
      body: { project: args.project, idempotency_key: args.idempotency_key ?? randomUUID() },
    });
    const summary = join(`Created a review link for ${args.project}: ${link.url} (${link.id}).`, link.note ?? VISIBILITY_NOTE);
    return okResult(summary, asData(link));
  },
});

export const revokeReviewLink = defineTool({
  name: "superflow_revoke_review_link",
  title: "Revoke a review link",
  description: [
    "Revoke a review link so it stops working. Anyone using it loses access. Safe to repeat.",
    "Without confirm: true nothing is revoked: you get the link and its project as a preview. Call again with confirm: true only after the user says yes.",
    "Get link ids from superflow_list_review_links.",
    'Example: {"link": "lnk_8a7b6c"}',
  ].join("\n"),
  inputSchema: {
    link: z.string().min(1).describe("Review link id (lnk_...), from superflow_list_review_links."),
    confirm: confirmSchema("revoke the link"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    const ref = args.link.trim();
    if (isConfirmed(args.confirm)) {
      const result = await api.call<RevokeReviewLinkResponse>("revokeReviewLink", { path: { link: ref } });
      return okResult(`Revoked review link ${result.id ?? ref}. It no longer works.`, asData(result));
    }
    // Preview: one read. Nothing that could revoke is sent without confirm.
    const list = await api.call<ListEnvelope<ReviewLink>>("listReviewLinks");
    const link = (list.items ?? []).find((item) => item.id === ref || item.id === `lnk_${ref}`);
    if (!link) {
      return errorResult(
        new SuperflowApiError({
          status: 404,
          code: "not_found",
          message: `No active review link ${ref}.`,
          hint: "List the active links with superflow_list_review_links. A revoked link is already gone.",
        }),
      );
    }
    return confirmationResult(
      `Review link ${link.id} (${link.url}) for project ${link.project_id} would be revoked. Nothing was revoked. Ask the user to confirm.`,
      { preview: link, message: CONFIRM_REVOKE_REVIEW_LINK_MESSAGE },
    );
  },
});

export const reviewLinkTools = [listReviewLinks, createReviewLink, revokeReviewLink];
