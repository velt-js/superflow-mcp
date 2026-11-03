// The stdio bridge (src/bridge.ts) against a fake hosted server over real localhost HTTP: what it
// forwards, what passes through unchanged, auth renewal, read-only mode and failures.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { type Bridge, BridgeError, type BridgeOptions, isReadTool, startBridge, staticToken } from "../../src/bridge.ts";
import { SESSION_ENDED_MESSAGE, type TokenProvider, UNAUTHORIZED_MESSAGE } from "../../src/client/api.ts";
import { USER_AGENT } from "../../src/version.ts";
import { FAKE_INSTRUCTIONS, FAKE_ME, FAKE_PROJECTS, type FakeHosted, startFakeHosted } from "../helpers/fake-hosted.ts";

const KEY = "sf_pat_bridge_test_0123456789";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fake(tokens: string[] = [KEY]): Promise<FakeHosted> {
  const hosted = await startFakeHosted(tokens);
  cleanups.push(() => hosted.close());
  return hosted;
}

/** The bridge, and a local MCP client connected to it the way stdio would be. */
async function bridged(hosted: FakeHosted, options: Partial<BridgeOptions> = {}): Promise<{ bridge: Bridge; client: Client }> {
  const bridge = await startBridge({ url: hosted.url, tokens: staticToken(KEY), signedIn: false, readOnly: false, ...options });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "bridge-test", version: "0.0.0" });
  await Promise.all([bridge.server.connect(remote), client.connect(local)]);
  cleanups.push(async () => {
    await client.close();
    await bridge.close();
  });
  return { bridge, client };
}

/** A client that talks to the fake directly, to compare with what the bridge hands on. */
async function direct(hosted: FakeHosted): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(hosted.url), { requestInit: { headers: { Authorization: `Bearer ${KEY}` } } });
  const client = new Client({ name: "direct-test", version: "0.0.0" });
  await client.connect(transport);
  cleanups.push(() => client.close());
  return client;
}

function errorOf(result: CallToolResult): { code: string; message: string; hint: string } {
  return (result.structuredContent as { error: { code: string; message: string; hint: string } }).error;
}

async function rejection(promise: Promise<unknown>): Promise<Error & { code?: unknown }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { code?: unknown };
  }
  throw new Error("expected a rejection");
}

describe("bridge forwarding", () => {
  it("hands on the hosted server's name, version, instructions and capabilities", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted);
    expect(client.getServerVersion()).toMatchObject({ name: "superflow-mcp", version: "9.9.9" });
    expect(client.getInstructions()).toBe(FAKE_INSTRUCTIONS);
    const capabilities = client.getServerCapabilities() ?? {};
    expect(Object.keys(capabilities).sort()).toEqual(["completions", "prompts", "resources", "tools"]);
  });

  it("forwards tools/list and tools/call, and passes results through unchanged", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted);
    const reference = await direct(hosted);
    expect(await client.listTools()).toEqual(await reference.listTools());
    const result = (await client.callTool({ name: "superflow_list_projects", arguments: { limit: 5 } })) as CallToolResult;
    expect(result).toEqual(await reference.callTool({ name: "superflow_list_projects", arguments: { limit: 5 } }));
    expect(result.structuredContent).toEqual(FAKE_PROJECTS);
  });

  it("passes a tool's error result through unchanged", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted);
    const reference = await direct(hosted);
    const result = await client.callTool({ name: "superflow_failing", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result).toEqual(await reference.callTool({ name: "superflow_failing", arguments: {} }));
  });

  it("passes a JSON-RPC error through with the hosted server's own code and message", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted);
    const reference = await direct(hosted);
    const expected = await rejection(reference.getPrompt({ name: "nope" }));
    const actual = await rejection(client.getPrompt({ name: "nope" }));
    expect(actual.code).toBe(expected.code);
    expect(actual.message).toBe(expected.message);
  });

  it("forwards prompts, resources, resource templates and completions", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted);
    expect((await client.listPrompts()).prompts.map((prompt) => prompt.name)).toEqual(["triage"]);
    const prompt = await client.getPrompt({ name: "triage", arguments: { project: "Acme Dental" } });
    expect(prompt.messages[0]?.content).toEqual({ type: "text", text: "Triage Acme Dental." });
    expect((await client.listResources()).resources.map((resource) => resource.uri)).toEqual(["superflow://workspace"]);
    expect((await client.listResourceTemplates()).resourceTemplates.map((template) => template.uriTemplate)).toEqual(["superflow://projects/{project}"]);
    const read = await client.readResource({ uri: "superflow://workspace" });
    const content = read.contents[0];
    expect(content && "text" in content ? JSON.parse(content.text) : undefined).toEqual(FAKE_ME);
    const completion = await client.complete({ ref: { type: "ref/prompt", name: "triage" }, argument: { name: "project", value: "Acme S" } });
    expect(completion.completion.values).toEqual(["Acme Shop"]);
  });

  it("sends the bearer token and names itself to the hosted server", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted);
    await client.callTool({ name: "superflow_get_me", arguments: {} });
    const posts = hosted.requests.filter((request) => request.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    for (const request of posts) {
      expect(request.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(request.headers["user-agent"]).toBe(USER_AGENT);
      expect(request.headers["x-superflow-client"]).toBe(USER_AGENT);
      expect(request.headers["x-superflow-read-only"]).toBeUndefined();
    }
  });
});

describe("bridge auth", () => {
  it("a sign-in renews its token once after a 401, and the request goes again", async () => {
    const hosted = await fake(["sf_at_old"]);
    let current = "sf_at_old";
    let refreshes = 0;
    const tokens: TokenProvider = {
      token: async () => current,
      refresh: async () => {
        refreshes += 1;
        current = "sf_at_new";
        return current;
      },
    };
    const { client } = await bridged(hosted, { tokens, signedIn: true });
    // The server stops accepting the old token (it expired) and accepts the renewed one.
    hosted.validTokens.clear();
    hosted.validTokens.add("sf_at_new");
    const result = (await client.callTool({ name: "superflow_get_me", arguments: {} })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(FAKE_ME);
    expect(refreshes).toBe(1);
    expect(hosted.count("tools/call")).toBe(2);
    expect(hosted.requests.at(-1)?.headers.authorization).toBe("Bearer sf_at_new");
  });

  it("a sign-in that cannot renew says to run login, and tries once", async () => {
    const hosted = await fake(["sf_at_old"]);
    let refreshes = 0;
    const tokens: TokenProvider = {
      token: async () => "sf_at_old",
      refresh: async () => {
        refreshes += 1;
        return null;
      },
    };
    const { client } = await bridged(hosted, { tokens, signedIn: true });
    hosted.validTokens.clear();
    const result = (await client.callTool({ name: "superflow_get_me", arguments: {} })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toMatchObject({ code: "unauthorized", message: SESSION_ENDED_MESSAGE });
    expect(refreshes).toBe(1);
    expect(hosted.count("tools/call")).toBe(1);
  });

  it("an API key the server refuses: a clear message, nothing sent twice", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted);
    hosted.validTokens.clear();
    const result = (await client.callTool({ name: "superflow_get_me", arguments: {} })) as CallToolResult;
    expect(errorOf(result)).toMatchObject({ code: "unauthorized", message: UNAUTHORIZED_MESSAGE });
    expect(errorOf(result).hint).toContain("npx superflow-mcp login");
    expect(hosted.count("tools/call")).toBe(1);
    const listError = await rejection(client.listTools());
    expect(listError.message).toContain("API key was rejected");
  });

  it("refuses to start with a key or sign-in the server refuses, and says why", async () => {
    const hosted = await fake(["sf_pat_other"]);
    const key = await rejection(startBridge({ url: hosted.url, tokens: staticToken(KEY), signedIn: false, readOnly: false }));
    expect(key).toBeInstanceOf(BridgeError);
    expect((key as BridgeError).code).toBe("unauthorized");
    expect((key as BridgeError).describe()).toContain("SUPERFLOW_API_KEY");
    const session = await rejection(startBridge({ url: hosted.url, tokens: staticToken("sf_at_x"), signedIn: true, readOnly: false }));
    expect(session.message).toBe(SESSION_ENDED_MESSAGE);
    // One initialize each: a 401 is not a cold start, so nothing goes again.
    expect(hosted.count("initialize")).toBe(2);
  });
});

describe("bridge failures and timeouts", () => {
  it("never sends a tool call twice, and says a failed one may have gone through", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted);
    hosted.failNext("tools/call", 503);
    const result = (await client.callTool({ name: "superflow_delete_comment", arguments: { comment: "cmt_1", confirm: true } })) as CallToolResult;
    expect(errorOf(result).code).toBe("upstream");
    expect(errorOf(result).message).toContain("HTTP 503");
    expect(errorOf(result).hint).toContain("may still have gone through");
    expect(hosted.count("tools/call")).toBe(1);
  });

  it("sends a list again once after a 503 (a cold start)", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted);
    hosted.failNext("tools/list", 503);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    expect(hosted.count("tools/list")).toBe(2);
  });

  it("connects again once when the first initialize fails with a 5xx", async () => {
    const hosted = await fake();
    hosted.failNext("initialize", 502);
    const { client } = await bridged(hosted);
    expect(client.getInstructions()).toBe(FAKE_INSTRUCTIONS);
    expect(hosted.count("initialize")).toBe(2);
  });

  it("a tool call past the timeout comes back as an error that says it may have gone through", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted, { toolTimeoutMs: 300 });
    const result = (await client.callTool({ name: "superflow_slow", arguments: { ms: 1500 } })) as CallToolResult;
    expect(errorOf(result).message).toContain("did not answer within");
    expect(errorOf(result).hint).toContain("may still have gone through");
    expect(hosted.count("tools/call")).toBe(1);
  });

  it("says when the hosted server cannot be reached", async () => {
    const hosted = await fake();
    const url = hosted.url;
    await hosted.close();
    const error = await rejection(startBridge({ url, tokens: staticToken(KEY), signedIn: false, readOnly: false }));
    expect(error).toBeInstanceOf(BridgeError);
    expect((error as BridgeError).code).toBe("upstream");
    expect(error.message).toContain("Could not reach the Superflow MCP server at 127.0.0.1");
  });
});

describe("bridge read-only mode", () => {
  it("lists only the tools that read, says so in the instructions, and asks the server for read-only", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted, { readOnly: true });
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["custom_read_tool", "superflow_failing", "superflow_get_me", "superflow_list_projects", "superflow_slow"]);
    expect(client.getInstructions()).toBe(`${FAKE_INSTRUCTIONS}\nThis server is read-only: write tools are not available.`);
    for (const request of hosted.requests.filter((r) => r.method === "POST")) expect(request.headers["x-superflow-read-only"]).toBe("true");
  });

  it("refuses a write tool without sending it, a known one and one only the hosted server knows", async () => {
    const hosted = await fake();
    const { client } = await bridged(hosted, { readOnly: true });
    const known = (await client.callTool({ name: "superflow_delete_comment", arguments: { comment: "cmt_1", confirm: true } })) as CallToolResult;
    expect(errorOf(known)).toMatchObject({ code: "forbidden" });
    expect(errorOf(known).message).toContain("read-only (SUPERFLOW_READ_ONLY=true)");
    // Called before any tools/list: the bridge reads the hosted list to judge it.
    const unknown = (await client.callTool({ name: "custom_write_tool", arguments: {} })) as CallToolResult;
    expect(errorOf(unknown).code).toBe("forbidden");
    expect(hosted.count("tools/call")).toBe(0);
    const read = (await client.callTool({ name: "custom_read_tool", arguments: {} })) as CallToolResult;
    expect(read.content).toEqual([{ type: "text", text: "read" }]);
    expect(hosted.count("tools/call")).toBe(1);
  });

  it("judges a tool by the package's own list first, then by the hosted readOnlyHint", () => {
    expect(isReadTool({ name: "superflow_list_comments" })).toBe(true);
    expect(isReadTool({ name: "superflow_delete_comment", annotations: { readOnlyHint: true } })).toBe(false);
    expect(isReadTool({ name: "newer_tool", annotations: { readOnlyHint: true } })).toBe(true);
    expect(isReadTool({ name: "newer_tool" })).toBe(false);
  });
});
