// The scopes `superflow-mcp login` asks for. Without an explicit list the consent screen
// falls back to its own read-heavy default (no comments:write), and a sign-in's scopes cannot
// be widened later, so login always names the scopes this package's tools need.

/** Every scope the Superflow API knows, in the order the backend lists them. */
export const ALL_SCOPES = [
  "workspace:read",
  "workspace:write",
  "projects:read",
  "projects:write",
  "agents:read",
  "agents:run",
  "agents:write",
  "analytics:read",
  "comments:read",
  "comments:write",
  "users:read",
  "users:invite",
  "users:write",
  "integrations:read",
  "integrations:write",
  "ingest",
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

/**
 * Left out of the default: the user asks for them by name with `--scope`.
 * - users:invite sends real invite email to people outside the workspace, and it cannot be recalled.
 * - users:write removes members and guests.
 * - workspace:write creates and revokes API keys (a new key outlives the sign-in), renames the
 *   workspace and changes notification settings.
 * - users:read is reserved: no API route needs it.
 */
export const OPT_IN_SCOPES: readonly Scope[] = ["users:invite", "users:write", "workspace:write", "users:read"];

/** What `superflow-mcp login` asks for without `--scope`. */
export const DEFAULT_LOGIN_SCOPES: readonly Scope[] = ALL_SCOPES.filter((scope) => !OPT_IN_SCOPES.includes(scope));

/**
 * Turns a `--scope` value into the space-separated list OAuth sends. Spaces and commas both
 * separate; repeats are dropped. `unknown` lists names the API does not know (a typo): the
 * consent screen ignores them.
 */
export function normalizeScopes(raw: string): { scope: string; unknown: string[] } {
  const names = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  const known = new Set<string>(ALL_SCOPES);
  return { scope: names.join(" "), unknown: names.filter((name) => !known.has(name)) };
}
