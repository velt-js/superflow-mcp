export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Config {
  /** Personal access token (sf_pat_...) or OAuth access token (sf_at_...). Never log it. */
  apiKey: string;
  /** API base including the version path, without a trailing slash. */
  baseUrl: string;
  /** When true, write tools are not registered at all. */
  readOnly: boolean;
  logLevel: LogLevel;
}

/**
 * The settings of the stdio bridge (the default way `npx superflow-mcp` runs): the hosted MCP
 * endpoint it forwards to, instead of the REST API the tools would call themselves.
 */
export interface BridgeConfig {
  /** Personal access token (sf_pat_...) or OAuth access token (sf_at_...). Never log it. */
  apiKey: string;
  /** The hosted MCP endpoint, without a trailing slash. */
  mcpUrl: string;
  /** When true, the bridge lists and allows only the tools that read. */
  readOnly: boolean;
  logLevel: LogLevel;
}

/** The REST API, for direct mode (development): the same function as the hosted MCP server serves it. */
export const DEFAULT_BASE_URL = "https://mcp.usesuperflow.ai/v1";
/** The hosted Superflow MCP server the bridge forwards to. */
export const DEFAULT_MCP_URL = "https://mcp.usesuperflow.ai/mcp";
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error", "silent"];

/** A configuration problem. The message is one line, safe to print, and names the variable. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

const TRUE_WORDS = new Set(["true", "1", "yes", "on"]);
const FALSE_WORDS = new Set(["false", "0", "no", "off", ""]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function readBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(value)) return true;
  if (FALSE_WORDS.has(value)) return false;
  throw new ConfigError(`${name} must be true or false, got "${raw}".`);
}

/** An https URL (http only for localhost) with no query string or fragment, without a trailing slash. */
function readUrl(name: string, raw: string | undefined, fallback: string): string {
  const value = raw?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} is not a valid URL: "${value}".`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ConfigError(`${name} must use https (http is allowed only for localhost).`);
  }
  if (url.search || url.hash) {
    throw new ConfigError(`${name} must not contain a query string or fragment.`);
  }
  return url.toString().replace(/\/+$/, "");
}

function readBaseUrl(raw: string | undefined): string {
  return readUrl("SUPERFLOW_API_BASE_URL", raw, DEFAULT_BASE_URL);
}

function readLogLevel(raw: string | undefined): LogLevel {
  const value = (raw?.trim().toLowerCase() || "info") as LogLevel;
  if (!LOG_LEVELS.includes(value)) {
    throw new ConfigError(`SUPERFLOW_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got "${raw}".`);
  }
  return value;
}

/** Variables that no longer do anything, with what to tell someone who still sets them. */
const REMOVED_VARIABLES: Readonly<Record<string, string>> = {
  SUPERFLOW_DEFAULT_PROJECT:
    "SUPERFLOW_DEFAULT_PROJECT is no longer used and can be removed: comments have no numbers, so give a comment by its id (cmt_...) or its link.",
};

/** One warning per removed variable that is still set, for the log at start (stderr). */
export function configWarnings(env: Record<string, string | undefined> = process.env): string[] {
  return Object.entries(REMOVED_VARIABLES)
    .filter(([name]) => env[name] !== undefined && env[name]?.trim() !== "")
    .map(([, warning]) => warning);
}

function readApiKey(env: Record<string, string | undefined>): string {
  const apiKey = env.SUPERFLOW_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      "Not signed in. Run npx superflow-mcp login, or create a key in Superflow under Settings > Integrations > API keys and set SUPERFLOW_API_KEY.",
    );
  }
  if (/\s/.test(apiKey)) {
    throw new ConfigError("SUPERFLOW_API_KEY contains whitespace. Paste the key exactly as Superflow showed it.");
  }
  return apiKey;
}

/**
 * Direct mode, for development only: SUPERFLOW_API_BASE_URL is set, so the tools run in this
 * process and call that REST API themselves instead of going through the hosted MCP server.
 */
export function isDirectMode(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.SUPERFLOW_API_BASE_URL?.trim());
}

/** Reads configuration from environment variables. Throws ConfigError with a one-line message. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    apiKey: readApiKey(env),
    baseUrl: readBaseUrl(env.SUPERFLOW_API_BASE_URL),
    readOnly: readBoolean("SUPERFLOW_READ_ONLY", env.SUPERFLOW_READ_ONLY, false),
    logLevel: readLogLevel(env.SUPERFLOW_LOG_LEVEL),
  };
}

/**
 * Reads the bridge's configuration. The endpoint is SUPERFLOW_MCP_URL, else `fallbackMcpUrl`
 * (the server a saved sign-in came from), else the hosted server. Throws ConfigError with a
 * one-line message, before anything goes over the network.
 */
export function loadBridgeConfig(env: Record<string, string | undefined> = process.env, fallbackMcpUrl: string = DEFAULT_MCP_URL): BridgeConfig {
  return {
    apiKey: readApiKey(env),
    mcpUrl: readUrl("SUPERFLOW_MCP_URL", env.SUPERFLOW_MCP_URL, fallbackMcpUrl),
    readOnly: readBoolean("SUPERFLOW_READ_ONLY", env.SUPERFLOW_READ_ONLY, false),
    logLevel: readLogLevel(env.SUPERFLOW_LOG_LEVEL),
  };
}
