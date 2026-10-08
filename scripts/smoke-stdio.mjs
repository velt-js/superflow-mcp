// Smoke test for the built CLI over real stdio. Run `pnpm build` first.
// 1. With SUPERFLOW_API_KEY set, it answers initialize + tools/list; prints the tool count.
// 2. Without SUPERFLOW_API_KEY, it exits non-zero with one stderr line naming the variable.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const EXPECTED_TOOLS = Number(process.env.SMOKE_EXPECTED_TOOLS ?? 21);
const TIMEOUT_MS = 15_000;

function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (key.startsWith("SUPERFLOW_") && !(key in extra)) delete env[key];
  }
  return env;
}

function listTools() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY], {
      env: cleanEnv({ SUPERFLOW_API_KEY: "sf_pat_test", SUPERFLOW_LOG_LEVEL: "error" }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no tools/list answer within ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    let buffer = "";
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
        } else if (message.id === 2) {
          clearTimeout(timer);
          child.stdin.end();
          child.kill();
          if (message.error) reject(new Error(`tools/list failed: ${JSON.stringify(message.error)}`));
          else resolve({ tools: message.result.tools, stderr });
        }
      }
    });
    child.on("error", reject);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0.0.0" } },
      })}\n`,
    );
  });
}

function runWithoutKey() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY], { env: cleanEnv({}), stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the CLI did not exit without SUPERFLOW_API_KEY"));
    }, TIMEOUT_MS);
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, stdout });
    });
  });
}

let ok = true;

const { tools } = await listTools();
console.log(`tools/list over stdio returned ${tools.length} tools.`);
if (tools.length !== EXPECTED_TOOLS) {
  ok = false;
  console.error(`expected ${EXPECTED_TOOLS} tools`);
}

const missing = await runWithoutKey();
const lines = missing.stderr.trim().split("\n").filter(Boolean);
console.log(`without SUPERFLOW_API_KEY: exit ${missing.code}, stderr: ${lines.join(" | ")}`);
if (missing.code === 0 || lines.length !== 1 || !lines[0].includes("SUPERFLOW_API_KEY") || missing.stdout !== "") {
  ok = false;
  console.error("expected a non-zero exit, nothing on stdout, and one stderr line naming SUPERFLOW_API_KEY");
}

process.exit(ok ? 0 : 1);
