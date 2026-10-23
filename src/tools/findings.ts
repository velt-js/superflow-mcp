// Findings from your own agent (spec addendum "Ingest from their own agent"). An agency's own
// review, run in Claude Code or Cursor with their own prompts, pushes what it found into
// Superflow: each finding becomes an agent comment pinned on its page, under the agency's name.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { okResult } from "../lib/format.ts";
import { defineTool, hints } from "./define.ts";
import { asData, join } from "./helpers.ts";
import { idempotencySchema, projectRefSchema } from "./schemas.ts";

/** Superflow's own rule keys an outside finding should use when its kind matches (the API checks them). */
export const COMMON_RULE_KEYS = [
  "image-alt",
  "image-broken",
  "image-quality",
  "image-stretched",
  "image-crop",
  "broken-link",
  "dead-button",
  "dead-form",
  "staging-link",
  "malformed-link",
  "unlinked-phone",
  "unlinked-email",
  "unlinked-logo",
  "social-link",
  "same-tab-link",
  "new-tab-internal-link",
  "style-mismatch",
  "missing-hover",
  "small-tap-target",
  "horizontal-scroll",
  "cut-off-text",
  "broken-mobile-menu",
] as const;

const findingSchema = z
  .object({
    page_url: z.string().url().describe("The page the finding is on, a full URL on the project's site."),
    title: z.string().min(1).max(200).describe("Short name of the problem, for example \"Missing alt text\"."),
    description: z.string().min(1).max(4000).describe("The problem in plain words: what is wrong and where."),
    severity: z.enum(["critical", "high", "medium", "low", "info"]).describe("critical, high, medium or low. info is dropped."),
    rule_key: z
      .string()
      .min(1)
      .max(64)
      .describe(`The kind of problem. Use Superflow's key when it matches (${COMMON_RULE_KEYS.join(", ")}), so it merges with what Superflow already found; otherwise your own key starting with ext-, for example ext-cookie-banner.`),
    fix_type: z.enum(["content", "design", "code"]).describe("content (copy, alt text, a link in the CMS), design, or code (theme or repository)."),
    confidence: z.number().int().min(0).max(100).optional().describe("0 to 100. Below 50 the finding is dropped."),
    suggestion: z.string().min(1).max(4000).optional().describe("The suggested fix."),
    anchor: z
      .object({
        selector: z.string().min(1).optional().describe("CSS selector of the element."),
        xpath: z.string().min(1).optional().describe("XPath of the element."),
        text: z.string().min(1).optional().describe("The element's text, when there is no selector."),
        occurrence: z.number().int().min(1).optional().describe("Which match of text, starting at 1."),
      })
      .strict()
      .optional()
      .describe("Where on the page. Without it the finding is about the whole page."),
    fingerprint: z.string().min(1).max(256).optional().describe("Your own stable id for this finding. When given, it decides what counts as the same finding next time."),
    external_id: z.string().min(1).max(256).optional().describe("Your id for the finding, stored on the comment."),
  })
  .strict();

interface ImportResult {
  project: { id: string; name: string };
  source: { id: string; name: string; slug: string };
  run_id: string;
  received: number;
  created: number;
  merged: number;
  dropped: number;
  failed: number;
  install: { status: string; installed: boolean; note?: string };
  results: Array<{ index: number; outcome: string; comment_id: string | null; rule_key: string; state?: string; reason?: string }>;
}

export const importFindings = defineTool({
  name: "superflow_import_findings",
  title: "Import findings from your own agent",
  description: [
    "Push what your own review found (your prompts, your agent) into Superflow. Each finding becomes an agent comment pinned on its page under your agent's name (source), so it shows up in superflow_list_comments, the fix list and reports like Superflow's own findings.",
    "Use it at the end of your own review, when the user asks to push the findings into Superflow. Map each finding into the fields below; use Superflow's rule_key when the kind matches so it merges with what Superflow already found. Up to 500 findings per call, 5,000 per project per day.",
    "It only creates or merges, never deletes. The same finding sent again merges into its comment. If one finding is invalid nothing is imported and the error lists every problem by index (findings[3].page_url): fix them all and send the whole batch again.",
    "Not for one comment a person writes: use superflow_create_comment. Not for running Superflow's agents: use superflow_run_agents.",
    'Example: {"project": "Dental Smiles", "source": "stache-review", "source_name": "Stache review", "findings": [{"page_url": "https://dental-smiles.com/about", "title": "Missing alt text", "description": "The hero image has no alt text.", "severity": "high", "rule_key": "image-alt", "fix_type": "content", "confidence": 90, "suggestion": "Set alt to Dr. Patel smiling.", "anchor": {"selector": "img.hero"}}]}',
  ].join("\n"),
  inputSchema: {
    project: projectRefSchema,
    source: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,39}$/)
      .describe("Your agent's id: 2 to 40 lowercase letters, digits and dashes, for example stache-review. Keep it the same across reviews so findings merge."),
    source_name: z.string().min(1).max(60).optional().describe("Display name of your agent, for example \"Stache review\". Default: source."),
    min_confidence: z.number().int().min(0).max(100).optional().describe("Raise the confidence floor above 50 for this call."),
    findings: z.array(findingSchema).min(1).max(500).describe("The findings, at most 500."),
    idempotency_key: idempotencySchema,
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const { project, ...body } = args;
    const result = await api.call<ImportResult>("importFindings", {
      path: { project },
      // Generated once per tool call, so the client's own retries cannot import twice.
      body: { ...body, idempotency_key: args.idempotency_key ?? randomUUID() },
    });
    const counts = `${result.created} created, ${result.merged} merged, ${result.dropped} dropped, ${result.failed} failed`;
    return okResult(
      join(
        `Imported into ${result.project?.name ?? project} as ${result.source?.name ?? args.source}: ${counts}.`,
        result.failed > 0 && "Send the same batch again to retry the failed ones; the rest merge.",
        result.install && !result.install.installed && "The Superflow script is not on the site yet, so the findings show in the portal, not as pins on the live page. Offer superflow_get_install_snippet.",
        `Run ${result.run_id}.`,
      ),
      asData(result),
      { untrusted: false },
    );
  },
});

export const findingTools = [importFindings];
