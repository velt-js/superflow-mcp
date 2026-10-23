// API key tools: list, create and revoke the caller's own keys (GET/POST/DELETE /api-keys).
import { z } from "zod";
import { SuperflowApiError } from "../client/api.ts";
import type { ApiKey, CreatedApiKey, ListEnvelope, RevokedApiKey } from "../client/types.ts";
import { CONFIRM_CREATE_API_KEY_MESSAGE, CONFIRM_REVOKE_API_KEY_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, errorResult, okResult, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, join } from "./helpers.ts";
import { confirmSchema } from "./schemas.ts";

function describeKey(key: ApiKey): string {
  const name = key.kind === "oauth" ? `${key.client_name ?? "an app"} sign-in` : `"${key.label}"`;
  return `${key.id} ${name}${key.current ? " (this key)" : ""}${key.expires_at ? `, expires ${key.expires_at.slice(0, 10)}` : ""}`;
}

export const listApiKeys = defineTool({
  name: "superflow_list_api_keys",
  title: "List API keys",
  description: [
    "List your own API keys and app sign-ins (Claude, Cursor, superflow-mcp login) in this workspace: label, scopes, last use, expiry. Tokens are never shown.",
    "Use it to find a key id before revoking it, or to check what has access. Other people's keys are not listed.",
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
    "Create an API key (sf_pat_...) for this workspace, for CI or another tool. Its scopes must be ones this key already has, and it cannot outlive this key.",
    "The token is returned once, in this conversation: tell the user to save it now (for example as SUPERFLOW_API_KEY in their CI secrets) and not to paste it anywhere public.",
    "Without confirm: true nothing is created: you get a preview. Call again with confirm: true only after the user says yes. Do not retry a create that succeeded: each call makes another key.",
    'Example: {"label": "GitHub Actions", "scopes": ["comments:read", "projects:read"], "expires_in_days": 90, "confirm": true}',
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
      return confirmationResult(
        `A key "${args.label}" with ${args.scopes.join(", ")}${args.expires_in_days ? `, expiring in ${args.expires_in_days} days` : ", with no expiry"} would be created. Nothing was created. Ask the user to confirm.`,
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
    'Example: {"key": "key_3f2a9c", "confirm": true}',
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
