// CLI entry: read env, start the server, connect stdio. stdout carries the MCP protocol, so
// every log line goes to stderr.
//
// By default the server is a bridge to the hosted Superflow MCP server (src/bridge.ts): the
// tools run there, with the user's key or sign-in. SUPERFLOW_API_BASE_URL switches to direct
// mode, for development: the tools run in this process against that REST API.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { login, loginHelp } from "./auth/login.ts";
import { AuthError, DEFAULT_AUTH_URL, revokeToken } from "./auth/oauth.ts";
import { normalizeScopes } from "./auth/scopes.ts";
import { chooseCredentialStore, type CredentialStore, type StoredSession } from "./auth/store.ts";
import { SessionTokenProvider } from "./auth/token-provider.ts";
import { BridgeError, callHostedTool, staticToken, startBridge } from "./bridge.ts";
import { ApiClient, SuperflowApiError } from "./client/api.ts";
import { ConfigError, DEFAULT_BASE_URL, DEFAULT_MCP_URL, configWarnings, isDirectMode, loadBridgeConfig, loadConfig } from "./config.ts";
import { createLogger, type Logger, redact } from "./lib/logger.ts";
import { createServer } from "./server.ts";
import { toolsFor } from "./tools/index.ts";
import { PACKAGE_NAME, VERSION } from "./version.ts";

const HELP = `${PACKAGE_NAME} ${VERSION}
A local MCP server (stdio) for Superflow. It forwards to the hosted Superflow MCP server,
so you get the same tools as the hosted connector, with your own key or sign-in.

Usage:
  npx -y superflow-mcp login     Sign in (or sign up) in the browser. Saves the sign-in.
                                 login --help lists its options, --scope among them.
  npx -y superflow-mcp           Run the server (what your MCP client starts).
  npx -y superflow-mcp logout    Sign out and remove the saved sign-in.

Environment:
  SUPERFLOW_API_KEY          An API key (sf_pat_...). Wins over a saved sign-in; use it in CI.
                             Create one in Superflow: Settings > Integrations > API keys.
  SUPERFLOW_MCP_URL          The hosted MCP server to forward to. Default ${DEFAULT_MCP_URL}
  SUPERFLOW_AUTH_URL         Sign-in server for login. Default ${DEFAULT_AUTH_URL}
  SUPERFLOW_CREDENTIALS_STORE  auto (Keychain or Secret Service, else a file) or file.
  SUPERFLOW_READ_ONLY        true to hide every write tool. Default false.
  SUPERFLOW_LOG_LEVEL        debug, info, warn, error or silent. Default info. Logs go to stderr.
  SUPERFLOW_API_BASE_URL     Development only: run the tools here against this REST API
                             (for example ${DEFAULT_BASE_URL}) instead of the hosted server.
`;

type Store = CredentialStore;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(argv[0] === "login" ? loginHelp() : HELP);
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
  let store: Store | null = null;
  if (!process.env.SUPERFLOW_API_KEY?.trim()) {
    store = (await chooseCredentialStore({ env: process.env })).store;
    session = await store.read();
  }
  if (isDirectMode(process.env)) await runDirect(session, store);
  else await runBridge(session, store);
}

function exitWith(message: string): never {
  process.stderr.write(`${PACKAGE_NAME}: ${redact(message)}\n`);
  process.exit(1);
}

/** Closes the server and exits when the client goes away. */
function onShutdown(logger: Logger, close: () => Promise<void>): void {
  let closing = false;
  const shutdown = async (reason: string) => {
    if (closing) return;
    closing = true;
    logger.debug("shutting down", { reason });
    try {
      await close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.stdin.on("close", () => void shutdown("stdin closed"));
}

/** The hosted endpoint a saved sign-in belongs to: the server it signed in with, at /mcp. */
function sessionMcpUrl(session: StoredSession | null): string {
  return session?.authUrl ? `${session.authUrl.replace(/\/+$/, "")}/mcp` : DEFAULT_MCP_URL;
}

/** The default: a bridge that forwards every request to the hosted Superflow MCP server. */
async function runBridge(session: StoredSession | null, store: Store | null): Promise<void> {
  const env = session ? { ...process.env, SUPERFLOW_API_KEY: session.accessToken } : process.env;
  let config;
  try {
    config = loadBridgeConfig(env, sessionMcpUrl(session));
  } catch (error) {
    exitWith(error instanceof ConfigError ? error.message : String(error));
  }

  // The provider's tokens change on every refresh, so the logger asks it for the current ones.
  let tokenProvider: SessionTokenProvider | undefined;
  const startSecrets = session ? [session.accessToken, session.refreshToken] : [config.apiKey];
  const logger = createLogger({ level: config.logLevel, secrets: () => (tokenProvider ? [...tokenProvider.secrets(), ...startSecrets] : startSecrets) });
  for (const warning of configWarnings(process.env)) logger.warn(warning);
  tokenProvider = session && store ? new SessionTokenProvider({ session, store, logger }) : undefined;

  let bridge;
  try {
    bridge = await startBridge({
      url: config.mcpUrl,
      tokens: tokenProvider ?? staticToken(config.apiKey),
      signedIn: Boolean(tokenProvider),
      readOnly: config.readOnly,
      logger,
    });
  } catch (error) {
    exitWith(error instanceof BridgeError ? error.describe() : `Could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  onShutdown(logger, bridge.close);
  await bridge.server.connect(new StdioServerTransport());
  const hosted = bridge.hostedInfo ? ` (${bridge.hostedInfo.name} ${bridge.hostedInfo.version})` : "";
  logger.info(
    `${PACKAGE_NAME} ${VERSION} ready on stdio${config.readOnly ? " (read-only)" : ""}: forwarding to ${new URL(config.mcpUrl).host}${hosted}.`,
  );
}

/** Development only (SUPERFLOW_API_BASE_URL is set): the tools run here against that REST API. */
async function runDirect(session: StoredSession | null, store: Store | null): Promise<void> {
  const env = session
    ? { ...process.env, SUPERFLOW_API_KEY: session.accessToken, SUPERFLOW_API_BASE_URL: process.env.SUPERFLOW_API_BASE_URL || session.apiBaseUrl }
    : process.env;

  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    exitWith(error instanceof ConfigError ? error.message : String(error));
  }

  let tokenProvider: SessionTokenProvider | undefined;
  const startSecrets = session ? [session.accessToken, session.refreshToken] : [config.apiKey];
  const logger = createLogger({ level: config.logLevel, secrets: () => (tokenProvider ? [...tokenProvider.secrets(), ...startSecrets] : startSecrets) });
  logger.warn(
    `SUPERFLOW_API_BASE_URL is set, so the tools run here against ${new URL(config.baseUrl).host} (development mode). Unset it to use the hosted Superflow MCP server.`,
  );
  for (const warning of configWarnings(process.env)) logger.warn(warning);
  tokenProvider = session && store ? new SessionTokenProvider({ session, store, logger }) : undefined;
  const client = new ApiClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, logger, ...(tokenProvider ? { tokenProvider } : {}) });
  const server = createServer({ config, client, logger });
  onShutdown(logger, () => server.close());

  await server.connect(new StdioServerTransport());
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
  const rawScope = readFlag(args, "--scope");
  const requested = rawScope === undefined ? undefined : normalizeScopes(rawScope);
  if (requested && !requested.scope) {
    print(`${PACKAGE_NAME}: --scope names no scopes. Run npx -y superflow-mcp login --help to see them.`);
    process.exit(1);
  }
  if (requested?.unknown.length) print(`Superflow does not know ${requested.unknown.join(", ")}; the consent screen ignores ${requested.unknown.length === 1 ? "it" : "them"}.`);
  const scope = requested?.scope;
  const { store, warning } = await chooseCredentialStore({ env: process.env });
  try {
    const result = await login({ authUrl, apiBaseUrl, store, print, env: process.env, ...(scope ? { scope } : {}) });
    print(`Signed in to Superflow${await whoSignedIn(result.session)}. Saved in ${result.savedTo}.`);
    for (const note of [warning, result.warning]) if (note) print(note);
    print("Your MCP client can now start superflow-mcp without SUPERFLOW_API_KEY.");
  } catch (error) {
    const message = error instanceof AuthError || error instanceof SuperflowApiError ? error.message : String(error instanceof Error ? error.message : error);
    print(`${PACKAGE_NAME}: ${redact(message)}`);
    process.exit(1);
  }
}

/** " as dana@acme.com in Acme", read through the server the sign-in will use; "" when it cannot tell. */
async function whoSignedIn(session: StoredSession): Promise<string> {
  type Me = { member?: { email?: string }; organization?: { name?: string } };
  let me: Me | undefined;
  try {
    if (isDirectMode(process.env)) {
      me = await new ApiClient({ apiKey: session.accessToken, baseUrl: session.apiBaseUrl }).call<Me>("getMe");
    } else {
      const url = process.env.SUPERFLOW_MCP_URL?.trim() || sessionMcpUrl(session);
      const result = await callHostedTool({ url, tokens: staticToken(session.accessToken), requestTimeoutMs: 30_000 }, "superflow_get_me");
      if (result && !result.isError) me = result.structuredContent as Me | undefined;
    }
  } catch {
    me = undefined;
  }
  if (!me) return "";
  return ` as ${me.member?.email ?? "you"}${me.organization?.name ? ` in ${me.organization.name}` : ""}`;
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
      print("Could not reach Superflow to end the sign-in there. You can revoke it in Superflow under Settings > Integrations > API keys > Connected AI apps.");
    }
  }
  await store.clear();
  print(`Signed out. Removed the sign-in from ${store.location}.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${PACKAGE_NAME}: ${redact(error instanceof Error ? error.message : String(error))}\n`);
  process.exit(1);
});
