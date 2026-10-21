// Nightly first-tool-choice check. Gives the model only the server's tool list (from
// tools/list over the in-memory MCP client) and each prompt from test/evals/prompts.json,
// then checks the first tool_use against expect_first_tool. No Superflow API calls are
// made. Exits 1 below 90%.
//
// Needs ANTHROPIC_API_KEY. Run with `pnpm evals:tools`.
import {
  acceptedFirstTools,
  createAnthropic,
  createMessage,
  loadPrompts,
  mapLimit,
  startServer,
  systemPrompt,
  toClaudeTools,
  toolUses,
} from "./lib/evals.ts";

const THRESHOLD = Number(process.env.EVALS_MIN_SCORE ?? 0.9);
const CONCURRENCY = Number(process.env.EVALS_CONCURRENCY ?? 3);

const anthropic = createAnthropic();
const prompts = loadPrompts({ project: "Acme Dental", page_url: "https://acme.com/pricing" });

interface Outcome {
  id: string;
  pass: boolean;
  got: string | null;
  expected: Array<string | null>;
  note?: string;
}

const outcomes = await mapLimit(prompts, CONCURRENCY, async (entry): Promise<Outcome> => {
  const expected = acceptedFirstTools(entry);
  const session = await startServer({
    apiKey: "sf_pat_eval_tool_choice",
    readOnly: entry.read_only ?? false,
    ...(entry.default_project ? { defaultProject: entry.default_project } : {}),
  });
  try {
    const message = await createMessage(anthropic, {
      system: systemPrompt(session, entry.default_project),
      tools: toClaudeTools(session.tools),
      messages: [{ role: "user", content: entry.prompt }],
    });
    if (message.stop_reason === "refusal") {
      return { id: entry.id, pass: false, got: null, expected, note: "refusal" };
    }
    if (message.stop_reason === "max_tokens") {
      return { id: entry.id, pass: false, got: null, expected, note: "max_tokens" };
    }
    const first = toolUses(message)[0]?.name ?? null;
    return { id: entry.id, pass: expected.includes(first), got: first, expected };
  } catch (error) {
    return { id: entry.id, pass: false, got: null, expected, note: error instanceof Error ? error.message : String(error) };
  } finally {
    await session.close();
  }
});

const passed = outcomes.filter((o) => o.pass).length;
for (const o of outcomes) {
  const mark = o.pass ? "PASS" : "FAIL";
  const detail = o.pass ? (o.got ?? "no tool") : `got ${o.got ?? "no tool"}, expected ${o.expected.map((e) => e ?? "no tool").join(" | ")}`;
  console.log(`${mark}  ${o.id.padEnd(40)} ${detail}${o.note ? ` (${o.note})` : ""}`);
}
const score = passed / outcomes.length;
console.log(`\nFirst tool choice: ${passed}/${outcomes.length} (${(score * 100).toFixed(1)}%). Threshold ${(THRESHOLD * 100).toFixed(0)}%.`);
process.exit(score >= THRESHOLD ? 0 : 1);
