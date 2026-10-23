// Playbooks (spec addendum "Playbooks the server serves"): step-by-step plans for the jobs
// that take several tools in order. The text comes from skills/<name>/SKILL.md through
// `pnpm playbooks`; this tool, the prompts of the same names and the server instructions
// all read the same generated list.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PLAYBOOKS, type Playbook } from "../playbooks/generated.ts";
import { defineTool, READ_HINTS } from "./define.ts";

/** Playbook names, for the input enum (at least one exists: the build fails otherwise). */
export const PLAYBOOK_NAMES = PLAYBOOKS.map((playbook) => playbook.name) as [string, ...string[]];

const READ_ONLY_NOTE =
  "Note: this server is read-only, so the write steps in this playbook cannot run here. Do the read steps, then present every change as a recommendation the user can apply in Superflow.";

/** The playbook text a model follows, with the read-only note when writes are off. */
export function playbookText(playbook: Playbook, readOnly: boolean): string {
  return readOnly ? `${playbook.body}\n\n${READ_ONLY_NOTE}` : playbook.body;
}

function listResult(): CallToolResult {
  const lines = ["Playbooks. Call superflow_use_playbook with a name to get one.", ""];
  for (const playbook of PLAYBOOKS) lines.push(`- ${playbook.name}: ${playbook.description}`);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { playbooks: PLAYBOOKS.map(({ name, title, description, clients }) => ({ name, title, description, clients })) },
  };
}

export const usePlaybook = defineTool({
  name: "superflow_use_playbook",
  title: "Get a playbook",
  description: [
    "Get the step-by-step playbook for a job that takes several Superflow tools in order, then follow it.",
    `Call it first, before any other tool, when the user wants to: ${PLAYBOOKS.map((playbook) => `${playbook.when} (${playbook.name})`).join("; ")}.`,
    "It only reads: it returns the playbook text. Without a name it lists the playbooks.",
    "Not needed for a single lookup or a single change: call that tool directly.",
    'Example: {"name": "triage"}',
  ].join("\n"),
  inputSchema: {
    name: z.enum(PLAYBOOK_NAMES).optional().describe(`The playbook: ${PLAYBOOK_NAMES.join(", ")}. Omit to list them.`),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { config }): Promise<CallToolResult> {
    if (!args.name) return listResult();
    const playbook = PLAYBOOKS.find((entry) => entry.name === args.name)!;
    return {
      content: [{ type: "text", text: `Playbook: ${playbook.title}. Follow these steps in order.\n\n${playbookText(playbook, config.readOnly)}` }],
      structuredContent: { name: playbook.name, title: playbook.title, clients: playbook.clients },
    };
  },
});

export const playbookTools = [usePlaybook];
