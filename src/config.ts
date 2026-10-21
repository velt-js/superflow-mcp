export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Config {
  /** Personal access token (sf_pat_...) or OAuth access token (sf_at_...). Never log it. */
  apiKey: string;
  /** API base including the version path, without a trailing slash. */
  baseUrl: string;
  /** Project used for bare comment numbers (#4821) when a tool call gives no project. */
  defaultProject: string | undefined;
  /** When true, write tools are not registered at all. */
  readOnly: boolean;
  logLevel: LogLevel;
}

export const DEFAULT_BASE_URL = "https://api.usesuperflow.ai/v1";
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

function readBaseUrl(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`SUPERFLOW_API_BASE_URL is not a valid URL: "${value}".`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ConfigError("SUPERFLOW_API_BASE_URL must use https (http is allowed only for localhost).");
  }
  if (url.search || url.hash) {
    throw new ConfigError("SUPERFLOW_API_BASE_URL must not contain a query string or fragment.");
  }
  return url.toString().replace(/\/+$/, "");
}

function readLogLevel(raw: string | undefined): LogLevel {
  const value = (raw?.trim().toLowerCase() || "info") as LogLevel;
  if (!LOG_LEVELS.includes(value)) {
    throw new ConfigError(`SUPERFLOW_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got "${raw}".`);
  }
  return value;
}

/** Reads configuration from environment variables. Throws ConfigError with a one-line message. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const apiKey = env.SUPERFLOW_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      "SUPERFLOW_API_KEY is not set. Create a key in Superflow under Settings > Integrations > API keys and set SUPERFLOW_API_KEY.",
    );
  }
  if (/\s/.test(apiKey)) {
    throw new ConfigError("SUPERFLOW_API_KEY contains whitespace. Paste the key exactly as Superflow showed it.");
  }
  return {
    apiKey,
    baseUrl: readBaseUrl(env.SUPERFLOW_API_BASE_URL),
    defaultProject: env.SUPERFLOW_DEFAULT_PROJECT?.trim() || undefined,
    readOnly: readBoolean("SUPERFLOW_READ_ONLY", env.SUPERFLOW_READ_ONLY, false),
    logLevel: readLogLevel(env.SUPERFLOW_LOG_LEVEL),
  };
}
