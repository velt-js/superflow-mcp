import { describe, expect, it } from "vitest";
import { PLAYBOOKS } from "../../../src/playbooks/generated.ts";
import { connect, recorded, summaryOf, textOf, useMsw } from "../../helpers/harness.ts";

useMsw();

const TOOL = "superflow_use_playbook";

describe(TOOL, () => {
  it("returns the playbook as text to follow, and calls no API", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { name: "fix" });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text.startsWith("Playbook: Fix, verify, report. Follow these steps in order.")).toBe(true);
    expect(text).toContain(PLAYBOOKS.find((p) => p.name === "fix")!.body);
    const fix = PLAYBOOKS.find((p) => p.name === "fix")!;
    // Claude Code shows the model structuredContent, so it carries the summary and the whole body.
    expect(result.structuredContent).toEqual({
      summary: "Playbook: Fix, verify, report. Follow these steps in order.",
      name: "fix",
      title: "Fix, verify, report",
      clients: expect.any(String),
      playbook: fix.body,
    });
    expect(Object.keys(result.structuredContent ?? {})[0]).toBe("summary");
    expect(recorded).toHaveLength(0);
  });

  it("lists the playbooks without a name", async () => {
    const h = await connect();
    const result = await h.call(TOOL, {});
    expect(textOf(result)).toContain("- triage: Use when");
    expect((result.structuredContent as { playbooks: unknown[] }).playbooks).toHaveLength(PLAYBOOKS.length);
    expect((result.structuredContent as { summary: string }).summary).toBe(summaryOf(result));
    expect(Object.keys(result.structuredContent ?? {})[0]).toBe("summary");
  });

  it("is available in read-only mode and says the write steps cannot run", async () => {
    const h = await connect({ readOnly: true });
    const result = await h.call(TOOL, { name: "triage" });
    expect(textOf(result)).toContain("this server is read-only, so the write steps in this playbook cannot run here");
    const playbook = (result.structuredContent as { playbook: string }).playbook;
    expect(playbook.startsWith(PLAYBOOKS.find((p) => p.name === "triage")!.body)).toBe(true);
    expect(playbook).toContain("this server is read-only, so the write steps in this playbook cannot run here");
  });

  it("refuses an unknown playbook through the schema", async () => {
    const h = await connect();
    const result = await h.call(TOOL, { name: "nope" });
    expect(result.isError).toBe(true);
  });

  it("the description says when to call it, for every playbook", async () => {
    const h = await connect();
    const { tools } = await h.client.listTools();
    const description = tools.find((tool) => tool.name === TOOL)?.description ?? "";
    for (const playbook of PLAYBOOKS) expect(description).toContain(`${playbook.when} (${playbook.name})`);
    expect(tools[0]?.name).toBe(TOOL);
  });
});
