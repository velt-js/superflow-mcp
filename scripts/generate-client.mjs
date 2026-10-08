// Reads openapi/openapi.json and writes src/client/generated/operations.ts.
// The output is deterministic: operations are sorted by operationId and query
// parameters by name, so the same snapshot always produces the same file.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SPEC_PATH = fileURLToPath(new URL("../openapi/openapi.json", import.meta.url));
export const OUTPUT_PATH = fileURLToPath(new URL("../src/client/generated/operations.ts", import.meta.url));

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

function resolveRef(spec, value) {
  if (!value || typeof value !== "object" || typeof value.$ref !== "string") return value;
  const ref = value.$ref;
  if (!ref.startsWith("#/")) throw new Error(`Only local $ref values are supported, got ${ref}`);
  let node = spec;
  for (const part of ref.slice(2).split("/")) {
    node = node?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  if (!node) throw new Error(`Unresolved $ref ${ref}`);
  return resolveRef(spec, node);
}

/** Collects every operation in the spec as { operationId, method, path, pathParams, queryParams }. */
export function collectOperations(spec) {
  const operations = [];
  const seen = new Set();
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    const item = resolveRef(spec, rawItem);
    const shared = (item.parameters ?? []).map((p) => resolveRef(spec, p));
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const id = operation.operationId;
      if (typeof id !== "string" || id.length === 0) {
        throw new Error(`${method.toUpperCase()} ${path} has no operationId`);
      }
      if (seen.has(id)) throw new Error(`Duplicate operationId ${id}`);
      seen.add(id);

      const params = new Map();
      for (const param of [...shared, ...(operation.parameters ?? []).map((p) => resolveRef(spec, p))]) {
        params.set(`${param.in}:${param.name}`, param);
      }
      const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      const queryParams = [...params.values()]
        .filter((param) => param.in === "query")
        .map((param) => param.name)
        .sort();
      operations.push({ operationId: id, method: method.toUpperCase(), path, pathParams, queryParams });
    }
  }
  return operations.sort((a, b) => (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0));
}

/** Renders operations.ts for a parsed OpenAPI document. */
export function renderOperations(spec) {
  const operations = collectOperations(spec);
  const lines = [
    "// GENERATED FILE. Do not edit.",
    "// Source: openapi/openapi.json. Regenerate with `pnpm generate:client`.",
    "",
    "export const operations = {",
  ];
  for (const op of operations) {
    lines.push(`  ${op.operationId}: {`);
    lines.push(`    method: ${JSON.stringify(op.method)},`);
    lines.push(`    path: ${JSON.stringify(op.path)},`);
    lines.push(`    pathParams: [${op.pathParams.map((p) => JSON.stringify(p)).join(", ")}],`);
    lines.push(`    queryParams: [${op.queryParams.map((p) => JSON.stringify(p)).join(", ")}],`);
    lines.push("  },");
  }
  lines.push("} as const;");
  lines.push("");
  lines.push("export type OperationId = keyof typeof operations;");
  lines.push("export type Operation = (typeof operations)[OperationId];");
  lines.push("export type HttpMethod = Operation[\"method\"];");
  lines.push("");
  return lines.join("\n");
}

export function readSpec(path = SPEC_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const output = renderOperations(readSpec());
  writeFileSync(OUTPUT_PATH, output);
  console.log(`Wrote ${OUTPUT_PATH.replace(ROOT, "")} (${collectOperations(readSpec()).length} operations).`);
}
