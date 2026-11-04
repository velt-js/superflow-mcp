import { describe, expect, it } from "vitest";
import { AuthError, discover, exchangeCode, isAllowedEndpoint, refreshTokens, registerClient } from "../../../src/auth/oauth.ts";
import { challengeFor, createState, createVerifier } from "../../../src/auth/pkce.ts";
import { AUTH, fakeOAuthServer } from "./fake-oauth.ts";

describe("pkce", () => {
  it("makes a 43-character verifier and the RFC 7636 S256 challenge", () => {
    const verifier = createVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // RFC 7636 appendix B test vector.
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(createState()).not.toBe(createState());
  });
});

describe("oauth calls", () => {
  it("discovers the endpoints, registers a loopback client and exchanges a code", async () => {
    const server = fakeOAuthServer();
    const metadata = await discover({ authUrl: AUTH, fetch: server.fetch });
    expect(metadata.tokenEndpoint).toBe(`${AUTH}/oauth/token`);
    const clientId = await registerClient({ metadata, redirectUri: "http://127.0.0.1:5555/callback", fetch: server.fetch });
    expect(clientId).toBe("client-123");
    expect(JSON.parse(server.calls[1]!.body)).toMatchObject({ token_endpoint_auth_method: "none", redirect_uris: ["http://127.0.0.1:5555/callback"] });
    server.issueCode("code-1");
    const tokens = await exchangeCode({ metadata, code: "code-1", verifier: "v".repeat(43), clientId, redirectUri: "http://127.0.0.1:5555/callback", fetch: server.fetch, now: 1000 });
    expect(tokens).toEqual({ accessToken: "sf_at_1", refreshToken: "sf_rt_1", expiresAt: 1000 + 3_600_000, scope: "comments:read" });
    expect(new URLSearchParams(server.calls[2]!.body).get("grant_type")).toBe("authorization_code");
  });

  it("refuses an http sign-in server that is not on this machine", async () => {
    expect(isAllowedEndpoint("http://evil.example/oauth")).toBe(false);
    expect(isAllowedEndpoint("http://127.0.0.1:8080/oauth")).toBe(true);
    await expect(discover({ authUrl: "http://auth.example.test" })).rejects.toBeInstanceOf(AuthError);
  });

  it("reports invalid_grant on a refused refresh", async () => {
    const server = fakeOAuthServer();
    server.state.refreshValid = false;
    await expect(refreshTokens({ tokenEndpoint: `${AUTH}/oauth/token`, refreshToken: "old", clientId: "client-123", fetch: server.fetch })).rejects.toMatchObject({ oauthError: "invalid_grant" });
  });
});
