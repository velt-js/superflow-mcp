import { describe, expect, it } from "vitest";
import { includes, loadPrompts, startServer, toClaudeTools, valueAt } from "../../scripts/lib/evals.ts";
import { TOOL_NAMES } from "../../src/tools/index.ts";

describe("eval prompts", () => {
  const prompts = loadPrompts({ project: "Acme Dental", page_url: "https://acme.com/pricing" });

  it("has 40 prompts with unique ids, filled placeholders and known tools", () => {
    expect(prompts).toHaveLength(40);
    expect(new Set(prompts.map((p) => p.id)).size).toBe(40);
    for (const entry of prompts) {
      expect(entry.prompt, entry.id).not.toMatch(/\{(project|page_url)\}/);
      const firsts = Array.isArray(entry.expect_first_tool) ? entry.expect_first_tool : [entry.expect_first_tool];
      for (const name of firsts) if (name !== null) expect(TOOL_NAMES, entry.id).toContain(name);
      for (const name of entry.expect_tools_any_order ?? []) expect(TOOL_NAMES, entry.id).toContain(name);
      for (const check of entry.check ?? []) {
        if ("tool" in check) expect(TOOL_NAMES, entry.id).toContain(check.tool);
        if ("tool_not_called" in check) expect(TOOL_NAMES, entry.id).toContain(check.tool_not_called);
      }
    }
  });

  it("includes the eight done prompts from the spec", () => {
    expect(prompts.filter((p) => p.id.startsWith("done-"))).toHaveLength(8);
  });

  it("includes ten Phase 2 admin prompts", () => {
    expect(prompts.filter((p) => p.id.startsWith("p2-"))).toHaveLength(10);
  });
});

describe("eval helpers", () => {
  it("matches arguments by deep partial inclusion", () => {
    expect(includes({ status: ["open", "In progress"], project: "Acme" }, { status: ["open"] })).toBe(true);
    expect(includes({ patch: { priority: "high", note: "x" } }, { patch: { priority: "HIGH" } })).toBe(true);
    expect(includes({ status: ["resolved"] }, { status: ["open"] })).toBe(false);
    expect(includes({ unanswered: true }, { unanswered: false })).toBe(false);
  });

  it("reads nested paths", () => {
    expect(valueAt({ a: { b: [1] } }, "a.b")).toEqual([1]);
    expect(valueAt({}, "a.b")).toBeUndefined();
  });

  it("converts the server's tools/list to Claude tool definitions", async () => {
    const session = await startServer({ apiKey: "sf_pat_eval", readOnly: true });
    const tools = toClaudeTools(session.tools);
    await session.close();
    expect(tools).toHaveLength(19);
    for (const tool of tools) {
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema).not.toHaveProperty("$schema");
      expect(tool.description).toContain("Example:");
    }
  });
});
