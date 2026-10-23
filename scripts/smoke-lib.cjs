// Smoke test for the library build: a CommonJS host (like the hosted server) requires
// `superflow-mcp/server`, builds the server with its own fetch, and lists and calls tools.
// Run after `pnpm build`.
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const lib = require("superflow-mcp/server");

async function main() {
  for (const name of ["createServer", "ApiClient", "OPENAPI_SHA256", "TOOL_NAMES", "VERSION", "PLAYBOOKS"]) {
    if (!(name in lib)) throw new Error(`superflow-mcp/server does not export ${name}`);
  }
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, client: init?.headers?.["X-Superflow-Client"] });
    return new Response(JSON.stringify({ member: { id: "usr_1", name: "Host", email: "h@x.com", role: "owner" }, organization: { id: "org_1", name: "Org", plan: null }, scopes: ["comments:read"], key: { kind: "oauth", label: null, created_at: null, expires_at: null } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const api = new lib.ApiClient({ apiKey: "in-process", baseUrl: "https://in-process.superflow.invalid/v1", fetch });
  const config = { apiKey: "in-process", baseUrl: "https://in-process.superflow.invalid/v1", defaultProject: undefined, readOnly: true, logLevel: "silent" };
  const server = lib.createServer({ config, client: api, surface: "hosted", renamedTools: { list_workspaces: "superflow_get_me" } });
  const client = new Client({ name: "smoke-lib", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  const { tools } = await client.listTools();
  if (tools.length < 30) throw new Error(`expected the read-only tools, got ${tools.length}`);
  const instructions = client.getInstructions() ?? "";
  if (instructions.includes("SUPERFLOW_")) throw new Error("hosted instructions mention SUPERFLOW_ variables");
  const me = await client.callTool({ name: "superflow_get_me", arguments: {} });
  if (me.isError || calls.length !== 1 || !calls[0].url.endsWith("/v1/me")) throw new Error(`get_me did not go through the host fetch: ${JSON.stringify(calls)}`);
  const renamed = await client.callTool({ name: "list_workspaces", arguments: {} });
  if (!renamed.isError || !JSON.stringify(renamed.content).includes("renamed to superflow_get_me")) throw new Error("a renamed tool did not answer with its new name");
  await client.close();
  console.log(`superflow-mcp/server (CommonJS) ${lib.VERSION}: ${tools.length} read-only tools, hosted wording, host fetch and renames work.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
