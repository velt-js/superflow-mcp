// CLI entry: read env, build the server, connect stdio. stdout carries the MCP protocol,
// so every log line goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { login } from "./auth/login.ts";
import { AuthError, DEFAULT_AUTH_URL, revokeToken } from "./auth/oauth.ts";
import { chooseCredentialStore, type StoredSession } from "./auth/store.ts";
import { SessionTokenProvider } from "./auth/token-provider.ts";
import { ApiClient, SuperflowApiError } from "./client/api.ts";
import { ConfigError, DEFAULT_BASE_URL, loadConfig } from "./config.ts";
import { createLogger, redact } from "./lib/logger.ts";
import { createServer } from "./server.ts";
import { toolsFor } from "./tools/index.ts";
import { PACKAGE_NAME, VERSION } from "./version.ts";

const HELP = `${PACKAGE_NAME} ${VERSION}
A local MCP server (stdio) for Superflow comments.

Usage:
  npx -y superflow-mcp login     Sign in (or sign up) in the browser. Saves the sign-in.
  npx -y superflow-mcp           Run the server (what your MCP client starts).
  npx -y superflow-mcp logout    Sign out and remove the saved sign-in.

Environment:
  SUPERFLOW_API_KEY          An API key (sf_pat_...). Wins over a saved sign-in; use it in CI.
                             Create one in Superflow: Settings > Integrations > API keys.
  SUPERFLOW_AUTH_URL         Sign-in server for login. Default ${DEFAULT_AUTH_URL}
  SUPERFLOW_CREDENTIALS_STORE  auto (Keychain or Secret Service, else a file) or file.
  SUPERFLOW_API_BASE_URL     Default ${DEFAULT_BASE_URL}
  SUPERFLOW_DEFAULT_PROJECT  Project used for bare comment numbers like #4821.
  SUPERFLOW_READ_ONLY        true to hide every write tool. Default false.
  SUPERFLOW_LOG_LEVEL        debug, info, warn, error or silent. Default info. Logs go to stderr.
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }

  if (argv[0] === "login") {
    await runLogin(argv.slice(1));
    return;
  }
  if (argv[0] === "logout") {
    await runLogout();
    return;
  }

  // An API key wins. Without one, use the saved sign-in (and keep its token fresh).
  let session: StoredSession | null = null;
  let store: Awaited<ReturnType<typeof chooseCredentialStore>>["store"] | null = null;
  if (!process.env.SUPERFLOW_API_KEY?.trim()) {
    store = (await chooseCredentialStore({ env: process.env })).store;
    session = await store.read();
  }
  const env = session
    ? { ...process.env, SUPERFLOW_API_KEY: session.accessToken, SUPERFLOW_API_BASE_URL: process.env.SUPERFLOW_API_BASE_URL || session.apiBaseUrl }
    : process.env;

  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : String(error);
    process.stderr.write(`${PACKAGE_NAME}: ${redact(message)}\n`);
    process.exit(1);
  }

  const logger = createLogger({ level: config.logLevel, secrets: session ? [session.accessToken, session.refreshToken] : [config.apiKey] });
  const tokenProvider = session && store ? new SessionTokenProvider({ session, store, logger }) : undefined;
  const client = new ApiClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, logger, ...(tokenProvider ? { tokenProvider } : {}) });
  const server = createServer({ config, client, logger });
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async (reason: string) => {
    if (closing) return;
    closing = true;
    logger.debug("shutting down", { reason });
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.stdin.on("close", () => void shutdown("stdin closed"));

  await server.connect(transport);
  const toolCount = toolsFor({ readOnly: config.readOnly }).length;
  logger.info(
    `${PACKAGE_NAME} ${VERSION} ready on stdio: ${toolCount} tools${config.readOnly ? " (read-only)" : ""}, API ${new URL(config.baseUrl).host}.`,
  );
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

const print = (line: string) => void process.stderr.write(`${line}\n`);

async function runLogin(args: string[]): Promise<void> {
  const authUrl = readFlag(args, "--auth-url") ?? process.env.SUPERFLOW_AUTH_URL?.trim() ?? DEFAULT_AUTH_URL;
  const apiBaseUrl = (readFlag(args, "--api-url") ?? process.env.SUPERFLOW_API_BASE_URL?.trim() ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const scope = readFlag(args, "--scope");
  const { store, warning } = await chooseCredentialStore({ env: process.env });
  try {
    const result = await login({ authUrl, apiBaseUrl, store, print, env: process.env, ...(scope ? { scope } : {}) });
    const client = new ApiClient({ apiKey: result.session.accessToken, baseUrl: apiBaseUrl });
    let who = "";
    try {
      const me = await client.call<{ member?: { email?: string }; organization?: { name?: string } }>("getMe");
      who = ` as ${me.member?.email ?? "you"}${me.organization?.name ? ` in ${me.organization.name}` : ""}`;
    } catch {
      who = "";
    }
    print(`Signed in to Superflow${who}. Saved in ${result.savedTo}.`);
    for (const note of [warning, result.warning]) if (note) print(note);
    print("Your MCP client can now start superflow-mcp without SUPERFLOW_API_KEY.");
  } catch (error) {
    const message = error instanceof AuthError || error instanceof SuperflowApiError ? error.message : String(error instanceof Error ? error.message : error);
    print(`${PACKAGE_NAME}: ${redact(message)}`);
    process.exit(1);
  }
}

async function runLogout(): Promise<void> {
  const { store } = await chooseCredentialStore({ env: process.env });
  const session = await store.read();
  if (!session) {
    print("Not signed in. Nothing to remove.");
    return;
  }
  if (session.revocationEndpoint) {
    try {
      await revokeToken({ revocationEndpoint: session.revocationEndpoint, token: session.refreshToken, clientId: session.clientId });
    } catch {
      print("Could not reach Superflow to end the sign-in there. You can revoke it in Settings > Integrations > Connected apps.");
    }
  }
  await store.clear();
  print(`Signed out. Removed the sign-in from ${store.location}.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${PACKAGE_NAME}: ${redact(error instanceof Error ? error.message : String(error))}\n`);
  process.exit(1);
});
