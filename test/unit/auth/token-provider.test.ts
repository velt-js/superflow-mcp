import { describe, expect, it } from "vitest";
import type { CredentialStore, StoredSession } from "../../../src/auth/store.ts";
import { SessionTokenProvider } from "../../../src/auth/token-provider.ts";
import { AUTH, fakeOAuthServer } from "./fake-oauth.ts";

function memoryStore(): CredentialStore & { saved: StoredSession[] } {
  const saved: StoredSession[] = [];
  return { kind: "file", location: "memory", saved, read: async () => saved.at(-1) ?? null, write: async (s) => void saved.push(s), clear: async () => void saved.splice(0) };
}

const session = (expiresAt: number): StoredSession => ({
  version: 1,
  authUrl: AUTH,
  apiBaseUrl: "https://api.example.test/v1",
  clientId: "client-123",
  tokenEndpoint: `${AUTH}/oauth/token`,
  revocationEndpoint: `${AUTH}/oauth/revoke`,
  accessToken: "sf_at_old",
  refreshToken: "sf_rt_old",
  expiresAt,
  scope: "comments:read",
});

describe("SessionTokenProvider", () => {
  it("hands out the current token until a minute before it expires", async () => {
    const server = fakeOAuthServer();
    const provider = new SessionTokenProvider({ session: session(10 * 60_000), store: memoryStore(), fetch: server.fetch, now: () => 0 });
    expect(await provider.token()).toBe("sf_at_old");
    expect(server.calls).toHaveLength(0);
  });

  it("refreshes an expiring token, saves the rotated pair, and shares one refresh", async () => {
    const server = fakeOAuthServer();
    const store = memoryStore();
    const provider = new SessionTokenProvider({ session: session(30_000), store, fetch: server.fetch, now: () => 0 });
    const [a, b] = await Promise.all([provider.token(), provider.token()]);
    expect(a).toBe("sf_at_1");
    expect(b).toBe("sf_at_1");
    expect(server.calls).toHaveLength(1);
    expect(new URLSearchParams(server.calls[0]!.body).get("refresh_token")).toBe("sf_rt_old");
    expect(store.saved.at(-1)).toMatchObject({ accessToken: "sf_at_1", refreshToken: "sf_rt_2", expiresAt: 3_600_000 });
  });

  it("uses the pair another process saved when the server refuses our rotated-away refresh token", async () => {
    const server = fakeOAuthServer();
    server.state.refreshValid = false;
    const store = memoryStore();
    await store.write({ ...session(10 * 60_000), accessToken: "sf_at_other", refreshToken: "sf_rt_other" });
    const provider = new SessionTokenProvider({ session: session(0), store, fetch: server.fetch, now: () => 0 });
    expect(await provider.refresh()).toBe("sf_at_other");
    // Not ended: the next call uses the adopted token without asking the server.
    expect(await provider.token()).toBe("sf_at_other");
    expect(server.calls).toHaveLength(1);
  });

  it("refreshes once with the stored refresh token when the adopted pair has expired too", async () => {
    const server = fakeOAuthServer();
    const refusingOld = (async (input: string | URL | Request, init?: RequestInit) => {
      const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
      if (form.get("refresh_token") === "sf_rt_old") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } });
      return server.fetch(input, init);
    }) as typeof fetch;
    const store = memoryStore();
    await store.write({ ...session(0), accessToken: "sf_at_other", refreshToken: "sf_rt_other" });
    const provider = new SessionTokenProvider({ session: session(0), store, fetch: refusingOld, now: () => 0 });
    expect(await provider.refresh()).toBe("sf_at_1");
    expect(new URLSearchParams(server.calls.at(-1)!.body).get("refresh_token")).toBe("sf_rt_other");
    expect(store.saved.at(-1)).toMatchObject({ accessToken: "sf_at_1", refreshToken: "sf_rt_2" });
  });

  it("stops after the server ends the sign-in (invalid_grant)", async () => {
    const server = fakeOAuthServer();
    server.state.refreshValid = false;
    const provider = new SessionTokenProvider({ session: session(0), store: memoryStore(), fetch: server.fetch, now: () => 0 });
    expect(await provider.refresh()).toBeNull();
    expect(await provider.refresh()).toBeNull();
    expect(server.calls).toHaveLength(1);
  });

  it("still ends the sign-in when the store holds the same refused token", async () => {
    const server = fakeOAuthServer();
    server.state.refreshValid = false;
    const store = memoryStore();
    await store.write(session(0));
    const provider = new SessionTokenProvider({ session: session(0), store, fetch: server.fetch, now: () => 0 });
    expect(await provider.refresh()).toBeNull();
    expect(await provider.refresh()).toBeNull();
    expect(server.calls).toHaveLength(1);
  });
});
