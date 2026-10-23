import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, login } from "../../../src/auth/login.ts";
import { challengeFor } from "../../../src/auth/pkce.ts";
import type { CredentialStore, StoredSession } from "../../../src/auth/store.ts";
import { AUTH, fakeOAuthServer } from "./fake-oauth.ts";

function memoryStore(failWrite = false): CredentialStore & { saved: StoredSession[] } {
  const saved: StoredSession[] = [];
  return {
    kind: "keychain",
    location: "memory",
    saved,
    read: async () => saved.at(-1) ?? null,
    write: async (s) => {
      if (failWrite) throw new Error("locked");
      saved.push(s);
    },
    clear: async () => void saved.splice(0),
  };
}

/** Plays the browser: follows the consent approval back to the loopback redirect. */
function browser(server: ReturnType<typeof fakeOAuthServer>, mode: "approve" | "deny" | "wrong-state" = "approve") {
  const seen: string[] = [];
  return {
    seen,
    open: (url: string) => {
      seen.push(url);
      const authorize = new URL(url);
      const redirect = new URL(authorize.searchParams.get("redirect_uri")!);
      if (mode === "wrong-state") {
        redirect.searchParams.set("state", "forged");
        redirect.searchParams.set("code", "stolen");
        void fetch(redirect).then(async () => {
          // After the forged hit, the real approval still arrives.
          server.issueCode("code-1");
          const real = new URL(authorize.searchParams.get("redirect_uri")!);
          real.searchParams.set("state", authorize.searchParams.get("state")!);
          real.searchParams.set("code", "code-1");
          await fetch(real);
        });
        return;
      }
      redirect.searchParams.set("state", authorize.searchParams.get("state")!);
      if (mode === "deny") {
        redirect.searchParams.set("error", "access_denied");
      } else {
        server.issueCode("code-1");
        redirect.searchParams.set("code", "code-1");
      }
      void fetch(redirect);
    },
  };
}

const base = { authUrl: AUTH, apiBaseUrl: "https://api.example.test/v1", print: () => undefined, env: {} };

describe("superflow-mcp login", () => {
  it("signs in through the browser with PKCE and saves the session", async () => {
    const server = fakeOAuthServer();
    const store = memoryStore();
    const tab = browser(server);
    const result = await login({ ...base, store, fetch: server.fetch, open: tab.open, now: () => 0 });

    const authorize = new URL(tab.seen[0]!);
    expect(authorize.origin + authorize.pathname).toBe(`${AUTH}/oauth/authorize`);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    // The verifier sent to the token endpoint matches the challenge sent to the browser.
    expect(challengeFor(server.state.lastVerifier!)).toBe(authorize.searchParams.get("code_challenge"));

    expect(result.session).toMatchObject({ clientId: "client-123", accessToken: "sf_at_1", refreshToken: "sf_rt_1", tokenEndpoint: `${AUTH}/oauth/token`, apiBaseUrl: "https://api.example.test/v1" });
    expect(store.saved).toHaveLength(1);
    expect(result.savedTo).toBe("memory");
  });

  it("ignores a callback with the wrong state and finishes on the real one", async () => {
    const server = fakeOAuthServer();
    const store = memoryStore();
    const result = await login({ ...base, store, fetch: server.fetch, open: browser(server, "wrong-state").open });
    expect(result.session.accessToken).toBe("sf_at_1");
  });

  it("stops with a clear message when the person cancels", async () => {
    const server = fakeOAuthServer();
    await expect(login({ ...base, store: memoryStore(), fetch: server.fetch, open: browser(server, "deny").open })).rejects.toThrow("cancelled");
  });

  it("times out when the browser never comes back", async () => {
    const server = fakeOAuthServer();
    await expect(login({ ...base, store: memoryStore(), fetch: server.fetch, open: () => undefined, timeoutMs: 50 })).rejects.toThrow("timed out");
  });

  it("saves to the file when the keyring refuses, and says so", async () => {
    const server = fakeOAuthServer();
    const dir = (await import("node:fs/promises")).mkdtemp((await import("node:path")).join((await import("node:os")).tmpdir(), "sf-login-"));
    const file = (await import("node:path")).join(await dir, "c.json");
    const result = await login({ ...base, env: { SUPERFLOW_CREDENTIALS_FILE: file }, store: memoryStore(true), fetch: server.fetch, open: browser(server).open });
    expect(result.savedTo).toBe(file);
    expect(result.warning).toContain("refused");
  });

  it("builds the authorize URL with every PKCE parameter", () => {
    const url = new URL(buildAuthorizeUrl({
      metadata: { authorizationEndpoint: `${AUTH}/oauth/authorize`, tokenEndpoint: "", registrationEndpoint: "", revocationEndpoint: undefined },
      clientId: "c", redirectUri: "http://127.0.0.1:1/callback", challenge: "ch", state: "st", scope: "comments:read",
    }));
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "c", redirect_uri: "http://127.0.0.1:1/callback", code_challenge: "ch", code_challenge_method: "S256", state: "st", scope: "comments:read" });
  });
});
