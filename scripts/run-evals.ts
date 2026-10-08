// Nightly end-to-end evals against staging. For each prompt in test/evals/prompts.json the
// model runs a tool loop whose tool calls go through the real server (in-memory MCP
// transport) to the real API. The tool sequence is recorded and the prompt's checks are
// applied. Writes are NOT executed unless EVALS_ALLOW_WRITES=true: the model gets a stub
// result instead, so a nightly run cannot change staging data by accident.
//
// Needs ANTHROPIC_API_KEY, SUPERFLOW_TEST_API_KEY and SUPERFLOW_API_BASE_URL.
// SUPERFLOW_TEST_PROJECT fills {project} in prompts; SUPERFLOW_TEST_PAGE_URL fills {page_url}.
// Writes a JSON report to evals-output/run-evals.json. Exits 1 below EVALS_MIN_SCORE (0.8).
import { mkdirSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { WRITE_TOOL_NAMES } from "../src/tools/index.ts";
import {
  acceptedFirstTools,
  createAnthropic,
  createMessage,
  includes,
  isNonEmpty,
  loadPrompts,
  mapLimit,
  startServer,
  systemPrompt,
  textOf,
  toClaudeTools,
  toolUses,
  valueAt,
} from "./lib/evals.ts";
import type { Check, EvalPrompt } from "./lib/evals.ts";

const MAX_TURNS = 8;
const THRESHOLD = Number(process.env.EVALS_MIN_SCORE ?? 0.8);
const CONCURRENCY = Number(process.env.EVALS_CONCURRENCY ?? 2);
const ALLOW_WRITES = process.env.EVALS_ALLOW_WRITES === "true";

for (const name of ["ANTHROPIC_API_KEY", "SUPERFLOW_TEST_API_KEY", "SUPERFLOW_API_BASE_URL"]) {
  if (!process.env[name]) {
    console.error(`${name} is not set.`);
    process.exit(2);
  }
}

const anthropic = createAnthropic();
const prompts = loadPrompts({
  project: process.env.SUPERFLOW_TEST_PROJECT ?? "Acme Dental",
  page_url: process.env.SUPERFLOW_TEST_PAGE_URL ?? "https://acme.com/pricing",
});

interface Step {
  tool: string;
  input: Record<string, unknown>;
  executed: boolean;
  is_error: boolean;
  structured: unknown;
}

interface Outcome {
  id: string;
  pass: boolean;
  failures: string[];
  steps: Step[];
  stop_reason: string | null;
  final_text: string;
}

function runCheck(check: Check, steps: Step[]): string | undefined {
  if ("arg_includes" in check) {
    const ok = steps.some((s) => s.tool === check.tool && includes(s.input, check.arg_includes));
    return ok ? undefined : `no ${check.tool} call with ${JSON.stringify(check.arg_includes)}`;
  }
  if ("result_path_nonempty" in check) {
    const ok = steps.some((s) => s.executed && !s.is_error && isNonEmpty(valueAt(s.structured, check.result_path_nonempty)));
    return ok ? undefined : `no tool result with a non-empty ${check.result_path_nonempty}`;
  }
  if ("tool_not_called" in check) {
    return steps.some((s) => s.tool === check.tool_not_called) ? `${check.tool_not_called} was called` : undefined;
  }
  if ("no_confirmed_writes" in check) {
    const bad = steps.find((s) => s.input.confirm === true);
    return bad ? `${bad.tool} was called with confirm: true without the user's yes` : undefined;
  }
  if ("tool_before" in check) {
    const later = steps.findIndex((s) => s.tool === check.then);
    if (later === -1) return undefined;
    const earlier = steps.findIndex((s) => s.tool === check.tool_before);
    return earlier !== -1 && earlier < later ? undefined : `${check.then} was called before ${check.tool_before}`;
  }
  return "unknown check";
}

async function runOne(entry: EvalPrompt): Promise<Outcome> {
  const session = await startServer({
    apiKey: process.env.SUPERFLOW_TEST_API_KEY ?? "",
    baseUrl: process.env.SUPERFLOW_API_BASE_URL,
    readOnly: entry.read_only ?? false,
    ...(entry.default_project ? { defaultProject: entry.default_project } : {}),
  });
  const steps: Step[] = [];
  const failures: string[] = [];
  let stopReason: string | null = null;
  let finalText = "";
  try {
    const tools = toClaudeTools(session.tools);
    const system = systemPrompt(session, entry.default_project);
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: entry.prompt }];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const message = await createMessage(anthropic, { system, tools, messages });
      stopReason = message.stop_reason;
      // Check the stop reason before reading content: a refusal can cut a tool_use short.
      if (message.stop_reason === "refusal") {
        failures.push("the model refused");
        break;
      }
      if (message.stop_reason === "max_tokens") {
        failures.push("hit max_tokens");
        break;
      }
      const uses = toolUses(message);
      if (message.stop_reason !== "tool_use" || uses.length === 0) {
        finalText = message.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        break;
      }
      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        const input = (use.input ?? {}) as Record<string, unknown>;
        const isWrite = WRITE_TOOL_NAMES.includes(use.name);
        if (isWrite && !ALLOW_WRITES) {
          steps.push({ tool: use.name, input, executed: false, is_error: false, structured: null });
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: "Eval mode: write tools are not executed. Assume the call succeeded and continue.",
          });
          continue;
        }
        const result = (await session.client.callTool({ name: use.name, arguments: input })) as CallToolResult;
        steps.push({
          tool: use.name,
          input,
          executed: true,
          is_error: result.isError === true,
          structured: result.structuredContent ?? null,
        });
        results.push({ type: "tool_result", tool_use_id: use.id, content: textOf(result), is_error: result.isError === true });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (error) {
    failures.push(`error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await session.close();
  }

  const first = steps[0]?.tool ?? null;
  const accepted = acceptedFirstTools(entry);
  if (!accepted.includes(first)) {
    failures.push(`first tool ${first ?? "none"}, expected ${accepted.map((a) => a ?? "none").join(" | ")}`);
  }
  for (const tool of entry.expect_tools_any_order ?? []) {
    if (!steps.some((s) => s.tool === tool)) failures.push(`${tool} was never called`);
  }
  for (const check of entry.check ?? []) {
    const problem = runCheck(check, steps);
    if (problem) failures.push(problem);
  }
  return { id: entry.id, pass: failures.length === 0, failures, steps, stop_reason: stopReason, final_text: finalText };
}

const outcomes = await mapLimit(prompts, CONCURRENCY, runOne);
const passed = outcomes.filter((o) => o.pass).length;
for (const o of outcomes) {
  console.log(`${o.pass ? "PASS" : "FAIL"}  ${o.id.padEnd(40)} ${o.steps.map((s) => s.tool.replace("superflow_", "")).join(" > ") || "(no tools)"}`);
  for (const failure of o.failures) console.log(`        ${failure}`);
}
const score = passed / outcomes.length;
console.log(`\nEnd-to-end evals: ${passed}/${outcomes.length} (${(score * 100).toFixed(1)}%). Threshold ${(THRESHOLD * 100).toFixed(0)}%.`);

mkdirSync("evals-output", { recursive: true });
writeFileSync(
  "evals-output/run-evals.json",
  JSON.stringify({ score, passed, total: outcomes.length, allow_writes: ALLOW_WRITES, outcomes }, null, 2),
);
process.exit(score >= THRESHOLD ? 0 : 1);
