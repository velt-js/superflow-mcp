// CLI entry: read env, build the server, connect stdio. stdout carries the MCP protocol,
// so every log line goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./client/api.ts";
import { ConfigError, DEFAULT_BASE_URL, loadConfig } from "./config.ts";
import { createLogger, redact } from "./lib/logger.ts";
import { createServer } from "./server.ts";
import { toolsFor } from "./tools/index.ts";
import { PACKAGE_NAME, VERSION } from "./version.ts";

const HELP = `${PACKAGE_NAME} ${VERSION}
A local MCP server (stdio) for Superflow comments.

Usage: SUPERFLOW_API_KEY=sf_pat_... npx -y superflow-mcp

Environment:
  SUPERFLOW_API_KEY          Required. Create one in Superflow: Settings > Integrations > API keys.
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

  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : String(error);
    process.stderr.write(`${PACKAGE_NAME}: ${redact(message)}\n`);
    process.exit(1);
  }

  const logger = createLogger({ level: config.logLevel, secrets: [config.apiKey] });
  const client = new ApiClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, logger });
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

main().catch((error: unknown) => {
  process.stderr.write(`${PACKAGE_NAME}: ${redact(error instanceof Error ? error.message : String(error))}\n`);
  process.exit(1);
});
