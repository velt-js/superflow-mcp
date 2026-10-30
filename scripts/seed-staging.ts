// Creates N comments through POST /comments for performance testing.
//
// Refuses unless SUPERFLOW_API_BASE_URL's host contains "staging" or is localhost or
// 127.0.0.1, and throttles to at most 8 requests per second.
//
// Usage:
//   SUPERFLOW_API_KEY=sf_pat_... SUPERFLOW_API_BASE_URL=https://...staging.../v1 \
//     pnpm seed:staging --project "Perf Test" --page-url https://example.com/ --count 500
import { parseArgs } from "node:util";
import { ApiClient } from "../src/client/api.ts";
import { loadConfig } from "../src/config.ts";
import { createLogger } from "../src/lib/logger.ts";

const MAX_PER_SECOND = 8;
const PRIORITIES = ["none", "low", "medium", "high", "critical"] as const;

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    "page-url": { type: "string" },
    count: { type: "string", default: "100" },
    tag: { type: "string", default: "perf-seed" },
  },
});

const config = loadConfig(process.env);
const host = new URL(config.baseUrl).hostname;
if (!(host.includes("staging") || host === "localhost" || host === "127.0.0.1")) {
  console.error(`Refusing to seed ${host}. This script only runs against staging or localhost.`);
  process.exit(1);
}
if (!values.project || !values["page-url"]) {
  console.error("Pass --project and --page-url.");
  process.exit(1);
}
const count = Number(values.count);
if (!Number.isInteger(count) || count < 1 || count > 10_000) {
  console.error("--count must be a whole number from 1 to 10000.");
  process.exit(1);
}

const logger = createLogger({ level: config.logLevel, secrets: [config.apiKey] });
const api = new ApiClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, logger });
const interval = 1000 / MAX_PER_SECOND;
const runId = Date.now().toString(36);
let created = 0;
let failed = 0;

for (let i = 0; i < count; i++) {
  const started = Date.now();
  try {
    await api.call("createComment", {
      body: {
        project: values.project,
        page_url: values["page-url"],
        text: `Seeded comment ${i + 1} of ${count} (run ${runId}).`,
        priority: PRIORITIES[i % PRIORITIES.length],
        tags: [values.tag ?? "perf-seed"],
        idempotency_key: `seed-${runId}-${i}`,
      },
    });
    created++;
  } catch (error) {
    failed++;
    console.error(`comment ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if ((i + 1) % 50 === 0) console.log(`${i + 1}/${count} (created ${created}, failed ${failed})`);
  const wait = interval - (Date.now() - started);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

console.log(`Done: created ${created}, failed ${failed}, tag "${values.tag}".`);
process.exit(failed > 0 ? 1 : 0);
