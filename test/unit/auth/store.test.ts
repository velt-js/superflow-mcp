import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseCredentialStore, defaultCredentialsFile, fileStore, type Runner, type StoredSession } from "../../../src/auth/store.ts";

const SESSION: StoredSession = {
  version: 1,
  authUrl: "https://auth.example.test",
  apiBaseUrl: "https://api.example.test/v1",
  clientId: "client-123",
  tokenEndpoint: "https://auth.example.test/oauth/token",
  revocationEndpoint: undefined,
  accessToken: "sf_at_1",
  refreshToken: "sf_rt_1",
  expiresAt: 123,
  scope: "comments:read",
};

describe("file store", () => {
  it("round-trips a session in a file only the user can read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-store-"));
    const path = join(dir, "nested", "credentials.json");
    const store = fileStore(path);
    expect(await store.read()).toBeNull();
    await store.write(SESSION);
    expect(await store.read()).toEqual(SESSION);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8")).refreshToken).toBe("sf_rt_1");
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("ignores a file that is not a session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-store-"));
    const store = fileStore(join(dir, "c.json"));
    await (await import("node:fs/promises")).writeFile(join(dir, "c.json"), "{\"version\":2}");
    expect(await store.read()).toBeNull();
  });

  it("puts the file under XDG_CONFIG_HOME, APPDATA, or SUPERFLOW_CREDENTIALS_FILE", () => {
    expect(defaultCredentialsFile({ XDG_CONFIG_HOME: "/x" }, "linux")).toBe(join("/x", "superflow-mcp", "credentials.json"));
    expect(defaultCredentialsFile({ APPDATA: "C:\\\\A" }, "win32")).toContain("superflow-mcp");
    expect(defaultCredentialsFile({ SUPERFLOW_CREDENTIALS_FILE: "/tmp/c.json" }, "linux")).toBe("/tmp/c.json");
  });
});

describe("chooseCredentialStore", () => {
  const runner = (codes: Record<string, number>, calls: string[][] = []): Runner => async (command, args, input) => {
    calls.push([command, ...args, ...(input ? [`<stdin:${input.length}>`] : [])]);
    return { code: codes[command] ?? 127, stdout: "" };
  };

  it("uses the Keychain on macOS", async () => {
    const { store, warning } = await chooseCredentialStore({ env: {}, platform: "darwin", run: runner({ security: 0 }) });
    expect(store.kind).toBe("keychain");
    expect(warning).toBeUndefined();
  });

  it("uses the Secret Service on Linux when secret-tool answers, and sends the secret on stdin", async () => {
    const calls: string[][] = [];
    const { store } = await chooseCredentialStore({ env: {}, platform: "linux", run: runner({ "secret-tool": 0 }, calls) });
    expect(store.kind).toBe("secret-service");
    await store.write(SESSION);
    const write = calls.find((call) => call[1] === "store")!;
    expect(write.join(" ")).not.toContain("sf_rt_1");
    expect(write.at(-1)).toMatch(/^<stdin:\d+>$/);
  });

  it("falls back to the file with a warning when there is no keyring", async () => {
    const { store, warning } = await chooseCredentialStore({ env: { XDG_CONFIG_HOME: "/x" }, platform: "linux", run: runner({}) });
    expect(store.kind).toBe("file");
    expect(warning).toContain("readable only by you");
  });

  it("SUPERFLOW_CREDENTIALS_STORE=file forces the file without a warning", async () => {
    const { store, warning } = await chooseCredentialStore({ env: { SUPERFLOW_CREDENTIALS_STORE: "file" }, platform: "darwin", run: runner({ security: 0 }) });
    expect(store.kind).toBe("file");
    expect(warning).toBeUndefined();
  });
});
