// The OAuth 2.1 calls `superflow-mcp login` makes against Superflow's authorization server
// (the MCP host): discovery (RFC 8414), dynamic client registration (RFC 7591), the code
// exchange with PKCE, refresh and revoke. Every request goes through `oauthRequest` in
// src/client/api.ts. Codes and tokens are never logged.
import { oauthRequest } from "../client/api.ts";
import { USER_AGENT } from "../version.ts";

export const DEFAULT_AUTH_URL = "https://mcp.usesuperflow.ai";

/** A login or refresh problem. The message is one line, safe to print. */
export class AuthError extends Error {
  override name = "AuthError";
  /** The OAuth `error` code when the server sent one (for example `invalid_grant`). */
  readonly oauthError: string | undefined;
  constructor(message: string, oauthError?: string) {
    super(message);
    this.oauthError = oauthError;
  }
}

export interface AuthServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string | undefined;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** https everywhere, http only on loopback (a local server in development). */
export function isAllowedEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  } catch {
    return false;
  }
}

function endpoint(body: Record<string, unknown> | null, key: string): string | undefined {
  const value = body?.[key];
  return typeof value === "string" && isAllowedEndpoint(value) ? value : undefined;
}

/** Reads the authorization server's metadata from `<authUrl>/.well-known/oauth-authorization-server`. */
export async function discover(params: { authUrl: string; fetch?: typeof fetch }): Promise<AuthServerMetadata> {
  if (!isAllowedEndpoint(params.authUrl)) {
    throw new AuthError(`The sign-in address must use https: ${params.authUrl}`);
  }
  const base = params.authUrl.replace(/\/+$/, "");
  let result;
  try {
    result = await oauthRequest({ url: `${base}/.well-known/oauth-authorization-server`, method: "GET", ...(params.fetch ? { fetch: params.fetch } : {}) });
  } catch {
    throw new AuthError(`Could not reach Superflow's sign-in server at ${new URL(base).host}. Check the network and try again.`);
  }
  const authorizationEndpoint = endpoint(result.body, "authorization_endpoint");
  const tokenEndpoint = endpoint(result.body, "token_endpoint");
  const registrationEndpoint = endpoint(result.body, "registration_endpoint");
  if (result.status !== 200 || !authorizationEndpoint || !tokenEndpoint || !registrationEndpoint) {
    throw new AuthError(`${new URL(base).host} did not answer with Superflow's sign-in details (HTTP ${result.status}).`);
  }
  return { authorizationEndpoint, tokenEndpoint, registrationEndpoint, revocationEndpoint: endpoint(result.body, "revocation_endpoint") };
}

function oauthFailure(action: string, status: number, body: Record<string, unknown> | null): AuthError {
  const code = typeof body?.error === "string" ? body.error : undefined;
  const description = typeof body?.error_description === "string" ? body.error_description : "";
  return new AuthError(`${action} failed (HTTP ${status}${code ? `, ${code}` : ""})${description ? `: ${description}` : "."}`, code);
}

/** Registers this CLI as a public client for one loopback redirect URI. */
export async function registerClient(params: { metadata: AuthServerMetadata; redirectUri: string; fetch?: typeof fetch }): Promise<string> {
  const result = await oauthRequest({
    url: params.metadata.registrationEndpoint,
    method: "POST",
    json: {
      client_name: `Superflow MCP (${USER_AGENT})`,
      redirect_uris: [params.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    ...(params.fetch ? { fetch: params.fetch } : {}),
  });
  const clientId = result.body?.client_id;
  if (result.status < 200 || result.status >= 300 || typeof clientId !== "string" || !clientId) {
    throw oauthFailure("Registering superflow-mcp with Superflow", result.status, result.body);
  }
  return clientId;
}

function toTokenSet(body: Record<string, unknown> | null, now: number): TokenSet | null {
  const accessToken = body?.access_token;
  const refreshToken = body?.refresh_token;
  if (typeof accessToken !== "string" || !accessToken || typeof refreshToken !== "string" || !refreshToken) return null;
  const expiresIn = typeof body?.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  return { accessToken, refreshToken, expiresAt: now + expiresIn * 1000, scope: typeof body?.scope === "string" ? body.scope : "" };
}

/** Exchanges the authorization code for tokens (PKCE verifier, exact redirect URI). */
export async function exchangeCode(params: {
  metadata: AuthServerMetadata;
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  fetch?: typeof fetch;
  now?: number;
}): Promise<TokenSet> {
  const result = await oauthRequest({
    url: params.metadata.tokenEndpoint,
    method: "POST",
    form: {
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: params.verifier,
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
    },
    ...(params.fetch ? { fetch: params.fetch } : {}),
  });
  const tokens = result.status === 200 ? toTokenSet(result.body, params.now ?? Date.now()) : null;
  if (!tokens) throw oauthFailure("Finishing the sign-in", result.status, result.body);
  return tokens;
}

/** Trades a refresh token for a new pair. The old refresh token stops working. */
export async function refreshTokens(params: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  fetch?: typeof fetch;
  now?: number;
}): Promise<TokenSet> {
  const result = await oauthRequest({
    url: params.tokenEndpoint,
    method: "POST",
    form: { grant_type: "refresh_token", refresh_token: params.refreshToken, client_id: params.clientId },
    ...(params.fetch ? { fetch: params.fetch } : {}),
  });
  const tokens = result.status === 200 ? toTokenSet(result.body, params.now ?? Date.now()) : null;
  if (!tokens) throw oauthFailure("Renewing the Superflow sign-in", result.status, result.body);
  return tokens;
}

/** Revokes a token (and with it the whole sign-in). Best effort: the server always answers 200. */
export async function revokeToken(params: { revocationEndpoint: string; token: string; clientId: string; fetch?: typeof fetch }): Promise<void> {
  await oauthRequest({
    url: params.revocationEndpoint,
    method: "POST",
    form: { token: params.token, client_id: params.clientId },
    ...(params.fetch ? { fetch: params.fetch } : {}),
  });
}
