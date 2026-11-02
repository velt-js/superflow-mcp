// Where `superflow-mcp login` keeps the sign-in: the macOS Keychain, the Linux Secret
// Service (secret-tool), or, when neither is available, a file only the user can read.
// SUPERFLOW_CREDENTIALS_STORE=file forces the file; SUPERFLOW_CREDENTIALS_FILE moves it.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** One signed-in session. Holds secrets: never log it. */
export interface StoredSession {
  version: 1;
  authUrl: string;
  apiBaseUrl: string;
  clientId: string;
  tokenEndpoint: string;
  revocationEndpoint: string | undefined;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
}

export interface CredentialStore {
  readonly kind: "keychain" | "secret-service" | "file";
  /** Where it lives, for messages ("the macOS Keychain", a file path). */
  readonly location: string;
  read(): Promise<StoredSession | null>;
  write(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

/** Runs a program; resolves with its exit code and stdout. Never rejects. */
export type Runner = (command: string, args: string[], input?: string) => Promise<{ code: number; stdout: string }>;

export const runProgram: Runner = (command, args, input) =>
  new Promise((resolve) => {
    let stdout = "";
    try {
      const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.on("error", () => resolve({ code: 127, stdout: "" }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
      child.stdin.end(input ?? "");
    } catch {
      resolve({ code: 127, stdout: "" });
    }
  });

const SERVICE = "superflow-mcp";
const ACCOUNT = "default";

function parseSession(raw: string): StoredSession | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (value?.version !== 1 || typeof value.accessToken !== "string" || typeof value.refreshToken !== "string") return null;
    if (typeof value.clientId !== "string" || typeof value.tokenEndpoint !== "string" || typeof value.apiBaseUrl !== "string") return null;
    return value as StoredSession;
  } catch {
    return null;
  }
}

/** Default file: $XDG_CONFIG_HOME (or ~/.config) on macOS and Linux, %APPDATA% on Windows. */
export function defaultCredentialsFile(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  if (env.SUPERFLOW_CREDENTIALS_FILE?.trim()) return env.SUPERFLOW_CREDENTIALS_FILE.trim();
  const base =
    platform === "win32"
      ? env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming")
      : env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "superflow-mcp", "credentials.json");
}

export function fileStore(path: string): CredentialStore {
  return {
    kind: "file",
    location: path,
    async read() {
      try {
        return parseSession(await readFile(path, "utf8"));
      } catch {
        return null;
      }
    },
    async write(session) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      // Write a new file next to it, then rename it over the old one: a reader in another
      // process (two MCP clients sharing one sign-in) sees the old session or the new one,
      // never half a file. The new file is created 0600, so the mode holds on every write.
      const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        await chmod(temp, 0o600).catch(() => undefined);
        await rename(temp, path);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}

/**
 * `security -i` reads its commands from stdin, one per line, and stops reading a line at
 * about 4 KB (a longer one is cut and its rest runs as a second command). Stay under it.
 */
export const KEYCHAIN_LINE_LIMIT = 4000;

/** The line `security -i` runs to save a session: the value as hex (-X), so it needs no quoting. */
export function keychainWriteCommand(session: StoredSession): string {
  const hex = Buffer.from(JSON.stringify(session), "utf8").toString("hex");
  return `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -l "Superflow MCP" -X ${hex}\n`;
}

function keychainStore(run: Runner): CredentialStore {
  return {
    kind: "keychain",
    location: "the macOS Keychain",
    async read() {
      const result = await run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
      return result.code === 0 ? parseSession(result.stdout.trim()) : null;
    },
    async write(session) {
      // Never `-w <value>`: an argument is visible to every process that lists processes (ps,
      // endpoint agents). `security -i` takes the whole command on stdin instead. -U updates
      // an existing item. A session too long for one line goes to the file (withFileFallback).
      const command = keychainWriteCommand(session);
      if (command.length > KEYCHAIN_LINE_LIMIT) throw new Error("The sign-in is too long for one macOS Keychain command.");
      const result = await run("security", ["-i"], command);
      if (result.code !== 0) throw new Error("Could not save the sign-in to the macOS Keychain.");
    },
    async clear() {
      await run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
    },
  };
}

function secretServiceStore(run: Runner): CredentialStore {
  const attributes = ["service", SERVICE, "account", ACCOUNT];
  return {
    kind: "secret-service",
    location: "the Secret Service keyring",
    async read() {
      const result = await run("secret-tool", ["lookup", ...attributes]);
      return result.code === 0 ? parseSession(result.stdout.trim()) : null;
    },
    async write(session) {
      // secret-tool reads the secret from stdin, so it never appears in a process list.
      const result = await run("secret-tool", ["store", "--label=Superflow MCP", ...attributes], JSON.stringify(session));
      if (result.code !== 0) throw new Error("Could not save the sign-in to the Secret Service keyring.");
    },
    async clear() {
      await run("secret-tool", ["clear", ...attributes]);
    },
  };
}

/**
 * A keyring that falls back to the file. `login` saves to the file when the keyring refuses
 * a write (locked, no session bus), so every later reader must look there too, or that
 * sign-in is lost on the next start and `logout` cannot remove it.
 * - read: both; when both hold a session, the one that expires later (a refresh the keyring
 *   refused went to the file, and the keyring's copy is the stale one); a tie goes to the keyring;
 * - write: the keyring, else the file, and then the keyring's old copy is removed (best effort)
 *   so it cannot shadow the new one;
 * - clear: both.
 * `location` names the store the session was last read from or written to.
 */
export function withFileFallback(primary: CredentialStore, file: CredentialStore): CredentialStore {
  let current: CredentialStore = primary;
  return {
    kind: primary.kind,
    get location() {
      return current.location;
    },
    async read() {
      const [fromPrimary, fromFile] = await Promise.all([
        primary.read().catch(() => null),
        file.read().catch(() => null),
      ]);
      if (fromPrimary && (!fromFile || fromPrimary.expiresAt >= fromFile.expiresAt)) {
        current = primary;
        return fromPrimary;
      }
      if (fromFile) current = file;
      return fromFile;
    },
    async write(session) {
      try {
        await primary.write(session);
        current = primary;
        // A file left from an earlier fallback is now older than the keyring's copy: drop it.
        await file.clear().catch(() => undefined);
      } catch {
        await file.write(session);
        current = file;
        await primary.clear().catch(() => undefined);
      }
    },
    async clear() {
      await Promise.allSettled([primary.clear(), file.clear()]);
    },
  };
}

/**
 * The store to use. `auto` (default): the Keychain on macOS, the Secret Service on Linux
 * when `secret-tool` works, else the file. A keyring is wrapped in `withFileFallback`.
 * `warning` is set when the file is used only because no keyring was available, so `login`
 * can say so.
 */
export async function chooseCredentialStore(params: {
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  run?: Runner;
}): Promise<{ store: CredentialStore; warning?: string }> {
  const platform = params.platform ?? process.platform;
  const run = params.run ?? runProgram;
  const mode = (params.env.SUPERFLOW_CREDENTIALS_STORE ?? "auto").trim().toLowerCase();
  const file = fileStore(defaultCredentialsFile(params.env, platform));
  if (mode === "file") return { store: file };
  if (platform === "darwin") {
    const probe = await run("security", ["-h"]);
    if (probe.code !== 127) return { store: withFileFallback(keychainStore(run), file) };
  }
  if (platform === "linux") {
    // `search` on an attribute nothing has exits 0 or 1 when the keyring answers, 127 when
    // secret-tool is missing; any other code means there is no keyring session.
    const probe = await run("secret-tool", ["search", "service", `${SERVICE}-probe`]);
    if (probe.code === 0 || probe.code === 1) return { store: withFileFallback(secretServiceStore(run), file) };
  }
  return {
    store: file,
    warning: `No system keyring was found, so the sign-in is saved in ${file.location}, readable only by you.`,
  };
}
