// Where `superflow-mcp login` keeps the sign-in: the macOS Keychain, the Linux Secret
// Service (secret-tool), or, when neither is available, a file only the user can read.
// SUPERFLOW_CREDENTIALS_STORE=file forces the file; SUPERFLOW_CREDENTIALS_FILE moves it.
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
      await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
      // writeFile keeps the mode of an existing file; set it every time.
      await chmod(path, 0o600).catch(() => undefined);
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
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
      // -U updates an existing item. The value is passed as an argument, as the
      // `security` tool requires; it is visible to the user's own processes for a moment.
      const result = await run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-l", "Superflow MCP", "-w", JSON.stringify(session)]);
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
 * The store to use. `auto` (default): the Keychain on macOS, the Secret Service on Linux
 * when `secret-tool` works, else the file. `warning` is set when the file is used only
 * because no keyring was available, so `login` can say so.
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
    if (probe.code !== 127) return { store: keychainStore(run) };
  }
  if (platform === "linux") {
    // `search` on an attribute nothing has exits 0 or 1 when the keyring answers, 127 when
    // secret-tool is missing; any other code means there is no keyring session.
    const probe = await run("secret-tool", ["search", "service", `${SERVICE}-probe`]);
    if (probe.code === 0 || probe.code === 1) return { store: secretServiceStore(run) };
  }
  return {
    store: file,
    warning: `No system keyring was found, so the sign-in is saved in ${file.location}, readable only by you.`,
  };
}
