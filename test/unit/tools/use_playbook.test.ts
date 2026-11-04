import { describe, expect, it } from "vitest";
import { PLAYBOOKS } from "../../../src/playbooks/generated.ts";
import { connect, recorded, textOf, useMsw } from "../../helpers/harness.ts";

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
    expect(result.structuredContent).toEqual({ name: "fix", title: "Fix, verify, report", clients: expect.any(String) });
    expect(recorded).toHaveLength(0);
  });

  it("lists the playbooks without a name", async () => {
    const h = await connect();
    const result = await h.call(TOOL, {});
    expect(textOf(result)).toContain("- triage: Use when");
    expect((result.structuredContent as { playbooks: unknown[] }).playbooks).toHaveLength(PLAYBOOKS.length);
  });

  it("is available in read-only mode and says the write steps cannot run", async () => {
    const h = await connect({ readOnly: true });
    const result = await h.call(TOOL, { name: "triage" });
    expect(textOf(result)).toContain("this server is read-only, so the write steps in this playbook cannot run here");
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
