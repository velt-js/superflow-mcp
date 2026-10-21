import type { LogLevel } from "../config.ts";

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

// Superflow tokens (personal access, OAuth access and refresh) and any bearer header value.
const TOKEN_PATTERN = /\bsf_(?:pat|at|rt)_[A-Za-z0-9._~+/=-]*/g;
const BEARER_PATTERN = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;

/** Replaces anything that looks like a Superflow token, plus the given secrets, with a placeholder. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  }
  return out.replace(TOKEN_PATTERN, "sf_[redacted]").replace(BEARER_PATTERN, "$1 [redacted]");
}

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  level: LogLevel;
  /** Exact values to scrub from every line (the API key). */
  secrets?: readonly string[];
  /** Where lines go. Defaults to stderr: stdout belongs to the MCP protocol. */
  write?: (line: string) => void;
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = RANK[options.level];
  const secrets = options.secrets ?? [];
  const write = options.write ?? ((line: string) => void process.stderr.write(line));

  const emit = (level: Exclude<LogLevel, "silent">, message: string, fields?: Record<string, unknown>) => {
    if (RANK[level] < threshold) return;
    let line = `[superflow-mcp] ${level}: ${message}`;
    if (fields && Object.keys(fields).length > 0) {
      let rendered: string;
      try {
        rendered = JSON.stringify(fields);
      } catch {
        rendered = "[unserializable fields]";
      }
      line += ` ${rendered}`;
    }
    write(`${redact(line, secrets)}\n`);
  };

  return {
    level: options.level,
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}

/** A logger that drops everything. Handy for tests and scripts. */
export const silentLogger: Logger = createLogger({ level: "silent", write: () => {} });
