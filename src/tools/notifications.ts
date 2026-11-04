// Notification settings tools: the caller's own email digest, inbox and email levels.
import { z } from "zod";
import type { NotificationSettings } from "../client/types.ts";
import { invalidInput, okResult } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, join } from "./helpers.ts";
import { DIGEST_CADENCES, NOTIFICATION_LEVELS } from "./schemas.ts";

const LEVEL_NOTE = "all: every comment on your projects. mine: only threads that involve you. none: nothing.";

function settingsSummary(settings: NotificationSettings, lead: string): string {
  const digest = settings.email_digest;
  return join(
    lead,
    digest && `Email digest: ${digest.enabled ? `on, ${digest.cadence}` : "off"}.`,
    settings.inbox && `Inbox: ${settings.inbox}.`,
    settings.email && `Email: ${settings.email}.`,
  );
}

export const getNotificationSettings = defineTool({
  name: "superflow_get_notification_settings",
  title: "Get my notification settings",
  description: [
    "Show your own notification settings in this workspace: the email digest (on or off; daily, weekly or monthly) and which comment notifications reach your Superflow inbox and your email.",
    `Levels: ${LEVEL_NOTE}`,
    "It shows only your settings, never a teammate's. To change them use superflow_update_notification_settings.",
    "Example: {}",
  ].join("\n"),
  inputSchema: {},
  annotations: READ_HINTS,
  write: false,
  async run(_args, { api }) {
    const settings = await api.call<NotificationSettings>("getNotificationSettings");
    return okResult(settingsSummary(settings, "Your notification settings."), asData(settings));
  },
});

export const updateNotificationSettings = defineTool({
  name: "superflow_update_notification_settings",
  title: "Update my notification settings",
  description: [
    "Change your own notification settings in this workspace. Only the fields you pass change, and only for you, never for teammates.",
    `Levels for inbox and email: ${LEVEL_NOTE} The digest time of day cannot be set: there is one schedule for everyone.`,
    "To see the current settings use superflow_get_notification_settings.",
    'Example: {"email_digest": {"enabled": true, "cadence": "weekly"}, "email": "mine"}',
  ].join("\n"),
  inputSchema: {
    email_digest: z
      .object({
        enabled: z.boolean().optional().describe("true: send the digest. false: stop it."),
        cadence: z.enum(DIGEST_CADENCES).optional().describe("How often: daily, weekly or monthly."),
      })
      .optional()
      .describe("The summary email of comment activity."),
    inbox: z.enum(NOTIFICATION_LEVELS).optional().describe(`Notifications in your Superflow inbox. ${LEVEL_NOTE}`),
    email: z.enum(NOTIFICATION_LEVELS).optional().describe(`Notification emails. ${LEVEL_NOTE}`),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const digest = args.email_digest ? compact(args.email_digest) : {};
    const hasDigest = Object.keys(digest).length > 0;
    if (!hasDigest && args.inbox === undefined && args.email === undefined) {
      return invalidInput("Nothing to change. Give email_digest, inbox or email.");
    }
    const settings = await api.call<NotificationSettings>("updateNotificationSettings", {
      body: compact({ email_digest: hasDigest ? digest : undefined, inbox: args.inbox, email: args.email }),
    });
    return okResult(settingsSummary(settings, "Updated your notification settings."), asData(settings));
  },
});

export const notificationTools = [getNotificationSettings, updateNotificationSettings];
