// API key tools: list, create and revoke the caller's own keys (GET/POST/DELETE /api-keys).
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type { ApiKey, CreatedApiKey, ListEnvelope, Me, RevokedApiKey } from "../client/types.ts";
import { CONFIRM_CREATE_API_KEY_MESSAGE, CONFIRM_REVOKE_API_KEY_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, errorResult, okResult, plural } from "../lib/format.ts";
import { NPX_COMMAND } from "../target.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, join } from "./helpers.ts";
import { confirmSchema } from "./schemas.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PORTAL_KEYS = "Superflow under Settings > Integrations > API keys";

function describeKey(key: ApiKey): string {
  const name = key.kind === "oauth" ? `${key.client_name ?? "an app"} sign-in` : `"${key.label}"`;
  return `${key.id} ${name}${key.current ? " (this key)" : ""}${key.expires_at ? `, expires ${key.expires_at.slice(0, 10)}` : ""}`;
}

/**
 * Why POST /api-keys would refuse this key, from GET /me, or null when it would go through.
 * The same rules and codes as the API, so a preview never asks the user to confirm a key that
 * cannot be made. A sign-in is checked first: no scope makes it able to create keys.
 */
function createRefusal(me: Me, scopes: readonly string[], expiresInDays: number | undefined, now: number): SuperflowApiError | null {
  const held = me.scopes ?? [];
  if (me.key?.kind === "oauth") {
    return new SuperflowApiError({
      status: 403,
      code: "forbidden",
      message: "This session uses a sign-in, not an API key, and a sign-in cannot create API keys: the key would outlive the sign-in.",
      hint: `Create the key in ${PORTAL_KEYS}, or use a personal API key (sf_pat_) that has workspace:write.`,
    });
  }
  if (!held.includes("workspace:write")) {
    return new SuperflowApiError({
      status: 403,
      code: "forbidden",
      message: "This key does not have the workspace:write scope, which creating an API key needs.",
      hint: `Create the key in ${PORTAL_KEYS}, or use a key that has workspace:write. Scopes cannot be added to an existing key.`,
    });
  }
  const extra = [...new Set(scopes.map((scope) => scope.trim()))].filter((scope) => !held.includes(scope));
  if (extra.length > 0) {
    return new SuperflowApiError({
      status: 403,
      code: "forbidden",
      message: `This key cannot create a key with ${extra.join(", ")}: it does not have ${extra.length === 1 ? "that scope" : "those scopes"} itself.`,
      hint: `A new key can only have scopes this key has: ${held.join(", ")}. Leave the others out, or create the key in ${PORTAL_KEYS}.`,
    });
  }
  const expiresAt = me.key?.expires_at ? Date.parse(me.key.expires_at) : Number.NaN;
  if (Number.isFinite(expiresAt)) {
    const daysLeft = Math.floor((expiresAt - now) / MS_PER_DAY);
    const date = new Date(expiresAt).toISOString().slice(0, 10);
    if (daysLeft < 1) {
      return new SuperflowApiError({
        status: 400,
        code: "invalid",
        message: `This key expires on ${date}, in less than a day, and a new key cannot outlive the key that creates it.`,
        hint: `Create the key in ${PORTAL_KEYS}, or use a key that does not expire so soon.`,
      });
    }
    if (expiresInDays === undefined || expiresInDays > daysLeft) {
      return new SuperflowApiError({
        status: 400,
        code: "invalid",
        message: `A new key cannot outlive the key that creates it. This key expires on ${date} (${plural(daysLeft, "day")} left), so ${expiresInDays === undefined ? "the new key needs an expiry too" : `${plural(expiresInDays, "day")} is too long`}.`,
        hint: `Pass expires_in_days of at most ${daysLeft}. For a key that lasts longer, create it in ${PORTAL_KEYS}.`,
      });
    }
  }
  return null;
}

export const listApiKeys = defineTool({
  name: "superflow_list_api_keys",
  title: "List API keys",
  description: [
    `List your own API keys and app sign-ins (Claude, Cursor, ${NPX_COMMAND} login) in this workspace: label, scopes, last use, expiry. Tokens are never shown.`,
    "Use it to find a key id before revoking it with superflow_revoke_api_key, or to check what has access. Other people's keys are not listed. For the scopes of the key in use now, use superflow_get_me.",
    "Example: {}",
  ].join("\n"),
  inputSchema: {},
  annotations: READ_HINTS,
  write: false,
  async run(_args, { api }) {
    const list = await api.call<ListEnvelope<ApiKey>>("listApiKeys");
    const items = list.items ?? [];
    const shown = items.slice(0, 5).map(describeKey).join("; ");
    return okResult(`${plural(items.length, "key")}${shown ? `: ${shown}${items.length > 5 ? "; ..." : ""}` : ""}.`, asData(list));
  },
});

export const createApiKey = defineTool({
  name: "superflow_create_api_key",
  title: "Create an API key",
  description: [
    `Create an API key (sf_pat_...) for this workspace, for CI or another tool. It needs an API key with workspace:write: a sign-in (${NPX_COMMAND} login, Claude, Cursor) cannot create keys. The new key's scopes must be ones this key already has, and it cannot outlive this key.`,
    "The token is returned once, in this conversation: tell the user to save it now (for example as SUPERFLOW_API_KEY in their CI secrets) and not to paste it anywhere public.",
    "Without confirm: true nothing is created: you get a preview, or an error saying why the key cannot be created. Call again with confirm: true only after the user says yes to a preview. Do not retry a create that succeeded: each call makes another key. To see the keys you have use superflow_list_api_keys.",
    'Example: {"label": "GitHub Actions", "scopes": ["comments:read", "projects:read"], "expires_in_days": 90}',
  ].join("\n"),
  inputSchema: {
    label: z.string().trim().min(1).max(100).describe("A name for the key, for example where it will be used."),
    scopes: z
      .array(z.string().min(1))
      .min(1)
      .max(32)
      .describe("Scopes, for example comments:read. Only scopes this key has. superflow_get_me lists them."),
    expires_in_days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("Days until it stops working, 1 to 365. Omit for no expiry (allowed only when this key never expires)."),
    confirm: confirmSchema("create the key"),
  },
  annotations: hints(false, false, false, false),
  write: true,
  async run(args, { api }) {
    const body = { label: args.label, scopes: args.scopes, ...(args.expires_in_days !== undefined ? { expires_in_days: args.expires_in_days } : {}) };
    if (!isConfirmed(args.confirm)) {
      // Preview: one read. A key the API would refuse comes back as that refusal, not a preview.
      const me = await api.call<Me>("getMe");
      const now = Date.now();
      const refusal = createRefusal(me, args.scopes, args.expires_in_days, now);
      if (refusal) return errorResult(refusal);
      const expiry =
        args.expires_in_days !== undefined
          ? `, expiring in ${plural(args.expires_in_days, "day")} (${new Date(now + args.expires_in_days * MS_PER_DAY).toISOString().slice(0, 10)})`
          : ", with no expiry";
      return confirmationResult(
        `A key "${args.label}" with ${args.scopes.join(", ")}${expiry} would be created. Nothing was created. Ask the user to confirm.`,
        { preview: body, message: CONFIRM_CREATE_API_KEY_MESSAGE },
      );
    }
    const created = await api.call<CreatedApiKey>("createApiKey", { body });
    const summary = join(
      `Created API key ${created.key.id} "${created.key.label}": ${created.token}`,
      "This is the only time the token is shown. Ask the user to save it now; revoke it with superflow_revoke_api_key if it leaks.",
    );
    return okResult(summary, asData(created));
  },
});

export const revokeApiKey = defineTool({
  name: "superflow_revoke_api_key",
  title: "Revoke an API key",
  description: [
    "Revoke one of your API keys or app sign-ins. Anything using it stops working at once. Revoking the key this session uses ends the session.",
    "Without confirm: true nothing is revoked: you get the key as a preview. Call again with confirm: true only after the user says yes.",
    "Get key ids from superflow_list_api_keys.",
    'Example: {"key": "key_3f2a9c"}',
  ].join("\n"),
  inputSchema: {
    key: z.string().min(1).describe("Key id (key_...), from superflow_list_api_keys."),
    confirm: confirmSchema("revoke the key"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    const ref = args.key.trim();
    if (isConfirmed(args.confirm)) {
      const result = await api.call<RevokedApiKey>("revokeApiKey", { path: { key: ref } });
      return okResult(
        result.current ? `Revoked ${result.id}, the key this session uses. The next call will be refused.` : `Revoked ${result.id}. It no longer works.`,
        asData(result),
      );
    }
    const list = await api.call<ListEnvelope<ApiKey>>("listApiKeys");
    const key = (list.items ?? []).find((item) => item.id === ref || item.id === `key_${ref}`);
    if (!key) {
      return errorResult(
        new SuperflowApiError({ status: 404, code: "not_found", message: `No active key ${ref} of yours.`, hint: "List your keys with superflow_list_api_keys." }),
      );
    }
    return confirmationResult(`${describeKey(key)} would be revoked. Nothing was revoked. Ask the user to confirm.`, {
      preview: key,
      message: CONFIRM_REVOKE_API_KEY_MESSAGE,
    });
  },
});

export const apiKeyTools = [listApiKeys, createApiKey, revokeApiKey];
