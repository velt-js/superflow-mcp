// Member and guest admin tools: invite and remove members, list, invite and remove guests.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type {
  InviteResponse,
  ListEnvelope,
  Member,
  RemoveGuestResponse,
  RemoveMemberPreview,
  RemoveMemberResponse,
} from "../client/types.ts";
import { CONFIRM_REMOVE_GUEST_MESSAGE, CONFIRM_REMOVE_MEMBER_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, okResult, plural } from "../lib/format.ts";
import { findOne } from "../lib/match.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, join, nameList, ofTotal } from "./helpers.ts";
import { confirmSchema, idempotencySchema, inviteEmailsSchema, projectRefSchema } from "./schemas.ts";

const SKIP_REASONS: Record<string, string> = {
  already_member: "already a member",
  already_guest: "already a guest",
  duplicate: "listed twice",
};

/** "Invited 2 members: a, b. Skipped 1: c (already a member). Member seats: 5 of 10 used (was 3)." */
function inviteSummary(result: InviteResponse, kind: "member" | "guest", where: string): string {
  const invited = result.invited ?? [];
  const skipped = result.skipped ?? [];
  const unsent = invited.filter((invite) => !invite.sent).map((invite) => invite.email);
  const seats = result.seats;
  return join(
    invited.length > 0
      ? `Invited ${plural(invited.length, kind)}${where}: ${nameList(invited.map((i) => i.email), 10)}.`
      : `Nobody new was invited${where}.`,
    skipped.length > 0 &&
      `Skipped ${skipped.length}: ${skipped
        .slice(0, 10)
        .map((s) => `${s.email} (${SKIP_REASONS[s.reason] ?? s.reason})`)
        .join(", ")}.`,
    unsent.length > 0 && `The invite email could not be sent to ${nameList(unsent, 10)}. Tell the user so they can let those people know.`,
    seats?.after &&
      `${kind === "member" ? "Member" : "Guest"} seats: ${ofTotal(seats.after.used, seats.after.total)} used${
        seats.before && seats.before.used !== seats.after.used ? ` (was ${seats.before.used})` : ""
      }.`,
  );
}

export const inviteMember = defineTool({
  name: "superflow_invite_member",
  title: "Invite members",
  description: [
    "Invite people to the Superflow workspace as members (your team). Members see and work on every project. This sends each person a real invite email right away, and each new member takes a member seat.",
    "Emails that already belong to members are skipped, not invited again (and nothing is sent to them). Up to 10 emails per call.",
    "For clients and reviewers who should see one project only use superflow_invite_guest. Ask the user before inviting anyone.",
    'Example: {"emails": ["jen@agency.com"]}',
  ].join("\n"),
  inputSchema: {
    emails: inviteEmailsSchema("People to invite as members"),
    idempotency_key: idempotencySchema,
  },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api }) {
    const result = await api.call<InviteResponse>("inviteMembers", {
      // Generated once per tool call, so the client's own retries cannot send the email twice.
      body: { emails: args.emails, idempotency_key: args.idempotency_key ?? randomUUID() },
    });
    return okResult(inviteSummary(result, "member", ""), asData(result));
  },
});

function memberLabel(member: RemoveMemberPreview["member"] | undefined, fallback: string): string {
  if (!member) return fallback;
  return `${member.name ?? member.id}${member.email ? ` (${member.email})` : ""}`;
}

export const removeMember = defineTool({
  name: "superflow_remove_member",
  title: "Remove a member",
  description: [
    "Remove a member from the workspace: they lose access to every project, and their unused invite links stop working. Only the workspace owner can do this, and neither the owner nor you can be removed.",
    "Open comments assigned to them stay assigned unless you pass reassign_to (another member); up to 200 are moved.",
    "Without confirm: true nothing is removed: you get the member and how many open comments are assigned to them as a preview. Call again with confirm: true only after the user says yes.",
    "To take a guest off one project use superflow_remove_guest.",
    'Example: {"member": "jen@agency.com", "reassign_to": "rakesh@agency.com"}',
  ].join("\n"),
  inputSchema: {
    member: z.string().min(1).describe("Member to remove: name, email or id (usr_...)."),
    reassign_to: z
      .string()
      .min(1)
      .optional()
      .describe("Another member (name, email or id) who takes over the removed member's open assigned comments."),
    confirm: confirmSchema("remove the member"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      const result = await api.call<RemoveMemberResponse>("removeMember", {
        path: { member: args.member },
        query: { confirm: true, reassign_to: args.reassign_to },
      });
      const still = result.still_assigned ?? 0;
      const summary = join(
        `Removed member ${args.member} (${result.id ?? "unknown id"}) from the workspace.`,
        (result.reassigned ?? 0) > 0 && `Reassigned ${plural(result.reassigned, "open comment")} to ${args.reassign_to}.`,
        still > 0 &&
          `${plural(still, "open comment")} still assigned to the removed member. Reassign them with superflow_bulk_update_comments or in Superflow.`,
      );
      return okResult(summary, asData(result));
    }
    // Preview: the API answers 409 needs_confirmation with { member, open_assigned_count } when
    // confirm is not sent. There is no other read for that count under the same scope.
    try {
      const result = await api.call<RemoveMemberResponse>("removeMember", {
        path: { member: args.member },
        query: { reassign_to: args.reassign_to },
      });
      return okResult(
        `The API removed member ${args.member} without asking for confirmation. Tell the user it is done.`,
        asData(result),
      );
    } catch (error) {
      if (!(error instanceof SuperflowApiError) || error.code !== "needs_confirmation") throw error;
      const preview = (error.preview ?? {}) as Partial<RemoveMemberPreview>;
      const open = preview.open_assigned_count;
      const atLeast = preview.scan?.complete === false ? "at least " : "";
      const assigned =
        typeof open === "number"
          ? `${atLeast}${plural(open, "open comment")} ${open === 1 && !atLeast ? "is" : "are"} assigned to them`
          : "Their open assigned comments could not be counted";
      const where = args.reassign_to ? ` and would move to ${args.reassign_to}` : typeof open === "number" && open > 0 ? " and would stay assigned to them" : "";
      return confirmationResult(
        `Member ${memberLabel(preview.member, args.member)} would be removed from the workspace. ${assigned}${where}. Nothing was removed. Ask the user to confirm.`,
        { preview: error.preview ?? null, message: CONFIRM_REMOVE_MEMBER_MESSAGE },
      );
    }
  },
});

export const listGuests = defineTool({
  name: "superflow_list_guests",
  title: "List guests",
  description: [
    "List the guests of one project: clients and reviewers invited to that project only, with when they were invited.",
    "Use it before inviting (to avoid duplicates) or before removing a guest.",
    "For your team plus a project's guests use superflow_list_members with project.",
    'Example: {"project": "Acme Dental"}',
  ].join("\n"),
  inputSchema: { project: projectRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = await api.call<ListEnvelope<Member>>("listProjectGuests", { path: { project: args.project } });
    const items = list.items ?? [];
    const names = items.map((g) => (g.email ? `${g.name} (${g.email})` : g.name));
    const summary = `${plural(items.length, "guest")} on project "${args.project}"${names.length ? `: ${nameList(names, 8)}` : ""}.`;
    return okResult(summary, asData(list));
  },
});

export const inviteGuest = defineTool({
  name: "superflow_invite_guest",
  title: "Invite guests",
  description: [
    "Invite clients or reviewers as guests of one project. Guests see and comment on that project only. This sends each person a real invite email right away.",
    "Emails that are already guests of the project, or members, are skipped (and nothing is sent to them). Up to 10 emails per call.",
    "For teammates who should see every project use superflow_invite_member. Ask the user before inviting anyone.",
    'Example: {"project": "Acme Dental", "emails": ["dana@acme.com"]}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    emails: inviteEmailsSchema("People to invite as guests"),
    idempotency_key: idempotencySchema,
  },
  annotations: hints(false, false, false, true),
  write: true,
  async run(args, { api }) {
    const result = await api.call<InviteResponse>("inviteGuests", {
      path: { project: args.project },
      // Generated once per tool call, so the client's own retries cannot send the email twice.
      body: { emails: args.emails, idempotency_key: args.idempotency_key ?? randomUUID() },
    });
    return okResult(inviteSummary(result, "guest", ` to ${args.project}`), asData(result));
  },
});

export const removeGuest = defineTool({
  name: "superflow_remove_guest",
  title: "Remove a guest",
  description: [
    "Remove a guest from one project. They lose access to this project only and keep any other projects they were invited to.",
    "Without confirm: true nothing is removed: you get the guest as a preview to show the user. Call again with confirm: true only after the user says yes.",
    "To remove a teammate from the workspace use superflow_remove_member.",
    'Example: {"project": "Acme Dental", "guest": "dana@acme.com"}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    guest: z.string().min(1).describe("Guest to remove: email, name or id (gst_...)."),
    confirm: confirmSchema("remove the guest from the project"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      const result = await api.call<RemoveGuestResponse>("removeGuest", {
        path: { project: args.project, guest: args.guest },
        query: { confirm: true },
      });
      return okResult(`Removed guest ${args.guest} (${result.id ?? "unknown id"}) from project ${args.project}.`, asData(result));
    }
    // Preview: one read. Nothing that could remove is sent without confirm.
    const list = await api.call<ListEnvelope<Member>>("listProjectGuests", { path: { project: args.project } });
    const guest = findOne(list.items ?? [], args.guest, {
      prefix: "gst_",
      namePrefix: true,
      noun: "guest",
      where: `project "${args.project}"`,
      notFoundHint: "List the guests with superflow_list_guests. Teammates are members: remove them with superflow_remove_member.",
    });
    return confirmationResult(
      `Guest ${guest.name}${guest.email ? ` (${guest.email})` : ""} would be removed from project ${args.project}. Nothing was removed. Ask the user to confirm.`,
      { preview: guest, message: CONFIRM_REMOVE_GUEST_MESSAGE },
    );
  },
});

export const memberTools = [inviteMember, removeMember, listGuests, inviteGuest, removeGuest];
