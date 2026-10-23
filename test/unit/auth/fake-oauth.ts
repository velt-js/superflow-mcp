// A fake Superflow OAuth server for the login tests: discovery, registration, the token
// endpoint (code and refresh grants) and revoke, as a `fetch` the auth code is handed.
export interface FakeOAuthServer {
  fetch: typeof fetch;
  calls: Array<{ url: string; method: string; body: string }>;
  /** Codes the server will accept, mapped to the PKCE verifier they need. */
  issueCode(code: string): void;
  state: { refreshValid: boolean; nextAccess: number; lastVerifier?: string; lastChallenge?: string };
}

export const AUTH = "https://auth.example.test";

export function fakeOAuthServer(): FakeOAuthServer {
  const calls: FakeOAuthServer["calls"] = [];
  const codes = new Set<string>();
  const state: FakeOAuthServer["state"] = { refreshValid: true, nextAccess: 1 };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });
    if (url === `${AUTH}/.well-known/oauth-authorization-server`) {
      return json(200, {
        issuer: AUTH,
        authorization_endpoint: `${AUTH}/oauth/authorize`,
        token_endpoint: `${AUTH}/oauth/token`,
        registration_endpoint: `${AUTH}/oauth/register`,
        revocation_endpoint: `${AUTH}/oauth/revoke`,
      });
    }
    if (url === `${AUTH}/oauth/register`) {
      const parsed = JSON.parse(body) as { redirect_uris: string[] };
      if (!parsed.redirect_uris?.[0]?.startsWith("http://127.0.0.1:")) return json(400, { error: "invalid_redirect_uri" });
      return json(201, { client_id: "client-123" });
    }
    if (url === `${AUTH}/oauth/token`) {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "authorization_code") {
        const code = form.get("code") ?? "";
        if (!codes.has(code) || !form.get("code_verifier") || form.get("client_id") !== "client-123") {
          return json(400, { error: "invalid_grant", error_description: "bad code" });
        }
        codes.delete(code);
        state.lastVerifier = form.get("code_verifier") ?? undefined;
        return json(200, { access_token: `sf_at_${state.nextAccess++}`, refresh_token: "sf_rt_1", token_type: "Bearer", expires_in: 3600, scope: "comments:read" });
      }
      if (form.get("grant_type") === "refresh_token") {
        if (!state.refreshValid) return json(400, { error: "invalid_grant" });
        return json(200, { access_token: `sf_at_${state.nextAccess++}`, refresh_token: `sf_rt_${state.nextAccess}`, expires_in: 3600, scope: "comments:read" });
      }
    }
    if (url === `${AUTH}/oauth/revoke`) return json(200, {});
    return json(404, { error: "not_found" });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls, issueCode: (code) => codes.add(code), state };
}
