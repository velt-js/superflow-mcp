// Agent tools: list, get, create, update, delete and duplicate agents, and agent packs.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Agent, AgentPack, DeleteAgentResponse, IdName, ListEnvelope, Schedule } from "../client/types.ts";
import { CONFIRM_DELETE_AGENT_MESSAGE, isConfirmed } from "../lib/confirm.ts";
import { confirmationResult, invalidInput, okResult, plural } from "../lib/format.ts";
import { READ_HINTS, defineTool, hints } from "./define.ts";
import { asData, compact, join, nameList } from "./helpers.ts";
import { agentRefSchema, confirmSchema, idempotencySchema, packRefSchema } from "./schemas.ts";

const KIND_LABELS: Record<string, string> = { built_in: "built-in", custom: "custom" };

function kindLabel(agent: Agent): string {
  return KIND_LABELS[agent.kind] ?? agent.kind ?? "agent";
}

function packNames(agent: Agent): string[] {
  return (agent.packs ?? []).map((pack) => pack.name ?? pack.id);
}

/** "Proofreader (agt_1, custom, on, in packs Pre-Launch, Copy QA, in the default run set)." */
export function agentSummary(agent: Agent, lead = "Agent"): string {
  const packs = packNames(agent);
  const parts = [
    agent.id,
    kindLabel(agent),
    agent.enabled ? "on" : "turned off",
    packs.length > 0 ? `in ${packs.length === 1 ? "pack" : "packs"} ${nameList(packs)}` : "in no pack",
    agent.is_default ? "in the default run set" : "",
  ].filter(Boolean);
  return `${lead} ${agent.name} (${parts.join(", ")}).`;
}

/** The ids a schedule names, whether the API sends ids or { id, name } objects. */
function scheduleAgentIds(schedule: Schedule): string[] {
  return (schedule.agents ?? []).map((agent) => (typeof agent === "string" ? agent : agent.id));
}

/** True when a schedule names the agent by id, prefixed (agt_) or raw. */
function scheduleNames(schedule: Schedule, agentId: string): boolean {
  const raw = agentId.replace(/^agt_/, "");
  return scheduleAgentIds(schedule).some((id) => id.replace(/^agt_/, "") === raw);
}

export const listAgents = defineTool({
  name: "superflow_list_agents",
  title: "List agents",
  description: [
    "List the AI review agents in the workspace: Superflow's built-in agents and your custom ones, with whether each is turned on, the packs it is in, and whether it is in the default run set (the agents a run uses when you name none).",
    "Use it to find an agent's id, or to see what a run would use. Filter by kind or by a name fragment to keep the list short.",
    "For one agent's instructions use superflow_get_agent. For packs use superflow_list_agent_packs. To run agents use superflow_estimate_run, then superflow_run_agents.",
    'Example: {"kind": "custom"}',
  ].join("\n"),
  inputSchema: {
    kind: z
      .enum(["built_in", "custom"])
      .optional()
      .describe("Only built_in agents (Superflow's own) or only custom agents (made in this workspace). Filtered by this server."),
    query: z
      .string()
      .min(1)
      .optional()
      .describe("Only agents whose name contains this text, ignoring case. Filtered by this server."),
  },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const list = await api.call<ListEnvelope<Agent>>("listAgents");
    const all = list.items ?? [];
    const query = args.query?.trim().toLowerCase();
    const items = all.filter(
      (agent) => (!args.kind || agent.kind === args.kind) && (!query || (agent.name ?? "").toLowerCase().includes(query)),
    );
    const filtered = items.length !== all.length;
    const custom = items.filter((agent) => agent.kind === "custom").length;
    const off = items.filter((agent) => !agent.enabled).length;
    const defaults = items.filter((agent) => agent.is_default).map((agent) => agent.name);
    const summary = join(
      `Found ${plural(items.length, "agent")}${filtered ? ` (of ${all.length})` : ""}: ${items.length - custom} built-in, ${custom} custom${off > 0 ? `, ${off} turned off` : ""}.`,
      defaults.length > 0 && `In the default run set: ${nameList(defaults, 8)}.`,
    );
    return okResult(summary, { ...asData(list), items, ...(filtered ? { filtered_from: all.length } : {}) });
  },
});

export const getAgent = defineTool({
  name: "superflow_get_agent",
  title: "Get an agent",
  description: [
    "Get one AI review agent: what it checks, whether it is turned on, its packs, and for a custom agent its instructions (built-in agents have none to show).",
    "Use it before changing or copying an agent, or when the user asks what an agent does.",
    "To list agents use superflow_list_agents.",
    'Example: {"agent": "Proofreader"}',
  ].join("\n"),
  inputSchema: { agent: agentRefSchema },
  annotations: READ_HINTS,
  write: false,
  async run(args, { api }) {
    const agent = await api.call<Agent>("getAgent", { path: { agent: args.agent } });
    return okResult(agentSummary(agent), asData(agent));
  },
});

const instructionsSchema = z
  .string()
  .min(1)
  .max(20_000)
  .describe("What the agent should check and report, in plain language. Used word for word as the agent's prompt. Up to 20,000 characters.");

export const createAgent = defineTool({
  name: "superflow_create_agent",
  title: "Create an agent",
  description: [
    "Create a custom AI review agent from plain-language instructions, for example a brand voice checker or a legal disclaimer checker. The instructions are used word for word as the agent's prompt. A workspace can have up to 100 custom agents.",
    "Optionally add it to packs. Creating it spends nothing; runs spend AI credits.",
    "Ask the user before creating. To change an existing agent use superflow_update_agent; to start from a copy use superflow_duplicate_agent. To run it use superflow_estimate_run, then superflow_run_agents.",
    'Example: {"name": "Legal footer", "instructions": "Check that every page footer has the copyright line and links to the privacy policy and terms.", "packs": ["Pre-Launch"]}',
  ].join("\n"),
  inputSchema: {
    name: z.string().min(1).max(200).describe("Agent name, 1 to 200 characters."),
    instructions: instructionsSchema,
    description: z.string().max(1000).optional().describe("Short description shown in the agent list, up to 1,000 characters."),
    packs: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe("Agent packs (names or pck_ ids) to add the new agent to."),
    idempotency_key: idempotencySchema,
  },
  annotations: hints(false, false, false, false),
  write: true,
  async run(args, { api }) {
    const agent = await api.call<Agent>("createAgent", {
      body: compact({
        name: args.name,
        instructions: args.instructions,
        description: args.description,
        packs: args.packs,
        // Generated once per tool call, so the client's own retries cannot create two agents.
        idempotency_key: args.idempotency_key ?? randomUUID(),
      }),
    });
    return okResult(
      join(agentSummary(agent, "Created agent"), "Run it with superflow_estimate_run, then superflow_run_agents."),
      asData(agent),
    );
  },
});

export const updateAgent = defineTool({
  name: "superflow_update_agent",
  title: "Update an agent",
  description: [
    "Change an agent: turn it on or off, or for a custom agent also rename it, change its description or rewrite its instructions. Built-in agents can only be turned on or off.",
    "A turned-off agent is skipped by runs that use the default agents or a pack. Ask the user before rewriting instructions.",
    "To copy an agent use superflow_duplicate_agent. To delete a custom agent use superflow_delete_agent.",
    'Example: {"agent": "Proofreader", "enabled": false}',
  ].join("\n"),
  inputSchema: {
    agent: agentRefSchema,
    name: z.string().min(1).max(200).optional().describe("New name. Custom agents only."),
    description: z.string().max(1000).optional().describe("New description. Custom agents only."),
    instructions: instructionsSchema.optional().describe("New instructions, replacing the old ones. Custom agents only."),
    enabled: z.boolean().optional().describe("true turns the agent on, false turns it off. Works for built-in and custom agents."),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const body = compact({ name: args.name, description: args.description, instructions: args.instructions, enabled: args.enabled });
    if (Object.keys(body).length === 0) return invalidInput("Nothing to change. Give name, description, instructions or enabled.");
    const agent = await api.call<Agent>("updateAgent", { path: { agent: args.agent }, body });
    return okResult(agentSummary(agent, "Updated agent"), asData(agent));
  },
});

export const deleteAgent = defineTool({
  name: "superflow_delete_agent",
  title: "Delete an agent",
  description: [
    "Delete a custom agent for good. It is also taken out of the schedules that name it, and a schedule left with no agents is turned off. Built-in agents cannot be deleted: turn them off with superflow_update_agent.",
    "Without confirm: true nothing is deleted: you get the agent, its packs and the schedules that use it as a preview to show the user. Call again with confirm: true only after the user says yes.",
    "To stop using an agent without deleting it, use superflow_update_agent with enabled: false.",
    'Example: {"agent": "Legal footer"}',
  ].join("\n"),
  inputSchema: {
    agent: agentRefSchema,
    confirm: confirmSchema("delete the agent"),
  },
  annotations: hints(false, true, true, false),
  write: true,
  async run(args, { api }) {
    if (isConfirmed(args.confirm)) {
      const result = await api.call<DeleteAgentResponse>("deleteAgent", {
        path: { agent: args.agent },
        query: { confirm: true },
      });
      const updated = result.schedules_updated ?? 0;
      const disabled = result.schedules_disabled ?? 0;
      return okResult(
        join(
          `Deleted agent ${args.agent} (${result.id ?? "unknown id"}).`,
          updated > 0 && `Took it out of ${plural(updated, "schedule")}${disabled > 0 ? `; ${disabled} had no agents left and ${disabled === 1 ? "was" : "were"} turned off` : ""}.`,
        ),
        asData(result),
      );
    }
    // Preview: reads only. Nothing that could delete is sent without confirm.
    const agent = await api.call<Agent>("getAgent", { path: { agent: args.agent } });
    if (agent.kind !== "custom") {
      return invalidInput(
        `${agent.name} is a built-in agent. Built-in agents cannot be deleted.`,
        "Turn it off with superflow_update_agent and enabled: false.",
      );
    }
    const schedules = await api.call<ListEnvelope<Schedule>>("listSchedules");
    const using = (schedules.items ?? []).filter((schedule) => scheduleNames(schedule, agent.id));
    const packs: IdName[] = agent.packs ?? [];
    const lonely = using.filter((schedule) => scheduleAgentIds(schedule).length === 1).length;
    return confirmationResult(
      join(
        `Agent ${agent.name} (${agent.id}) would be deleted for good.`,
        packs.length > 0 ? `It is in ${plural(packs.length, "pack")}: ${nameList(packNames(agent))}.` : "It is in no pack.",
        using.length > 0
          ? `${plural(using.length, "schedule")} ${using.length === 1 ? "names" : "name"} it${lonely > 0 ? `; ${lonely} would have no agents left and would be turned off` : ""}.`
          : "No schedule names it.",
        "Nothing was deleted. Ask the user to confirm.",
      ),
      { preview: { agent, packs, schedules_using: using }, message: CONFIRM_DELETE_AGENT_MESSAGE },
    );
  },
});

export const duplicateAgent = defineTool({
  name: "superflow_duplicate_agent",
  title: "Duplicate an agent",
  description: [
    "Copy a custom agent, to try a variation without touching the original. The copy gets the same instructions and settings, named \"<name> copy\" unless you give a name. Secrets in an agent's API settings are not copied: the result's note says so when it matters.",
    "Built-in agents cannot be copied: create a custom agent with superflow_create_agent instead.",
    'Example: {"agent": "Legal footer", "name": "Legal footer (EU)"}',
  ].join("\n"),
  inputSchema: {
    agent: agentRefSchema,
    name: z.string().min(1).max(200).optional().describe("Name for the copy. Default \"<name> copy\"."),
  },
  annotations: hints(false, false, false, false),
  write: true,
  async run(args, { api }) {
    const agent = await api.call<Agent>("duplicateAgent", { path: { agent: args.agent }, body: compact({ name: args.name }) });
    return okResult(join(agentSummary(agent, `Copied ${args.agent} as`), agent.note), asData(agent));
  },
});

function packLine(pack: AgentPack): string {
  const notes = [plural(pack.agent_count ?? pack.agent_ids?.length ?? 0, "agent"), pack.system ? "system" : "", pack.is_default_for_runs ? "default for runs" : ""]
    .filter(Boolean)
    .join(", ");
  return `${pack.name} (${notes})`;
}

export const listAgentPacks = defineTool({
  name: "superflow_list_agent_packs",
  title: "List agent packs",
  description: [
    "List agent packs: named groups of agents, such as Superflow's system packs (Copy QA, SEO, Design checks, Performance, Brand checks) and your own. Each pack lists its agent ids, and one pack can be the default for runs.",
    "Use it to pick a pack for superflow_estimate_run and superflow_run_agents, or before changing a pack.",
    "For the agents themselves use superflow_list_agents.",
    "Example: {}",
  ].join("\n"),
  inputSchema: {},
  annotations: READ_HINTS,
  write: false,
  async run(_args, { api }) {
    const list = await api.call<ListEnvelope<AgentPack>>("listAgentPacks");
    const items = list.items ?? [];
    const shown = items.slice(0, 8).map(packLine).join(", ");
    return okResult(`Found ${plural(items.length, "agent pack")}${shown ? `: ${shown}${items.length > 8 ? ", ..." : ""}` : ""}.`, asData(list));
  },
});

export const createAgentPack = defineTool({
  name: "superflow_create_agent_pack",
  title: "Create an agent pack",
  description: [
    "Create an agent pack: a named group of agents you can run together, for example \"Pre-Launch\" with the copy, SEO and accessibility agents.",
    "Ask the user before creating. To change a pack use superflow_update_agent_pack. To run a pack use superflow_estimate_run with pack, then superflow_run_agents.",
    'Example: {"name": "Pre-Launch", "description": "Everything to check before a site goes live.", "agents": ["Proofreader", "SEO basics"]}',
  ].join("\n"),
  inputSchema: {
    name: z.string().min(1).max(200).describe("Pack name."),
    description: z.string().max(1000).optional().describe("Short description of what the pack is for."),
    agents: z.array(z.string().min(1)).min(1).max(100).describe("Agents in the pack: names or agt_ ids. At least one."),
  },
  annotations: hints(false, false, false, false),
  write: true,
  async run(args, { api }) {
    const pack = await api.call<AgentPack>("createAgentPack", {
      body: compact({ name: args.name, description: args.description, agents: args.agents }),
    });
    return okResult(`Created agent pack ${packLine(pack)}, id ${pack.id}.`, asData(pack));
  },
});

export const updateAgentPack = defineTool({
  name: "superflow_update_agent_pack",
  title: "Update an agent pack",
  description: [
    "Change an agent pack: rename it, change its description, add or remove agents, or make it the default for runs (runs and estimates that name no agents and no pack then use it instead of Superflow's default agents).",
    "System packs keep their name and description, but you can add and remove agents.",
    "To create a pack use superflow_create_agent_pack.",
    'Example: {"pack": "Pre-Launch", "add_agents": ["Legal footer"], "is_default_for_runs": true}',
  ].join("\n"),
  inputSchema: {
    pack: packRefSchema,
    name: z.string().min(1).max(200).optional().describe("New name. Not for system packs."),
    description: z.string().max(1000).optional().describe("New description. Not for system packs."),
    add_agents: z.array(z.string().min(1)).min(1).max(100).optional().describe("Agents to add: names or agt_ ids."),
    remove_agents: z.array(z.string().min(1)).min(1).max(100).optional().describe("Agents to remove: names or agt_ ids."),
    is_default_for_runs: z
      .boolean()
      .optional()
      .describe("true: runs and estimates with no agents and no pack use this pack. false: go back to Superflow's default agents."),
  },
  annotations: hints(false, false, true, false),
  write: true,
  async run(args, { api }) {
    const body = compact({
      name: args.name,
      description: args.description,
      add_agents: args.add_agents,
      remove_agents: args.remove_agents,
      is_default_for_runs: args.is_default_for_runs,
    });
    if (Object.keys(body).length === 0) {
      return invalidInput("Nothing to change. Give name, description, add_agents, remove_agents or is_default_for_runs.");
    }
    const pack = await api.call<AgentPack>("updateAgentPack", { path: { pack: args.pack }, body });
    return okResult(`Updated agent pack ${packLine(pack)}, id ${pack.id}.`, asData(pack));
  },
});

export const agentTools = [
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  duplicateAgent,
  listAgentPacks,
  createAgentPack,
  updateAgentPack,
];
