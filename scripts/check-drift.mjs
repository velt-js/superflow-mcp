// Drift checks between the OpenAPI snapshot, the generated client and the live API.
//
// 1. Offline (always): regenerate operations.ts from openapi/openapi.json and fail
//    if the committed file differs. Fix with `pnpm generate:client`.
// 2. Live (only when SUPERFLOW_DRIFT_BASE_URL is set): fetch <base>/openapi.json and
//    fail if it differs semantically (sorted keys) from the snapshot.
import { readFileSync } from "node:fs";
import { OUTPUT_PATH, collectOperations, readSpec, renderOperations } from "./generate-client.mjs";

let failed = false;

function fail(message) {
  failed = true;
  console.error(`drift: ${message}`);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function describeOperationDiff(snapshot, live) {
  const index = (spec) => new Map(collectOperations(spec).map((op) => [op.operationId, JSON.stringify(op)]));
  const a = index(snapshot);
  const b = index(live);
  const notes = [];
  for (const [id, value] of a) {
    if (!b.has(id)) notes.push(`missing in live API: ${id}`);
    else if (b.get(id) !== value) notes.push(`changed: ${id}\n    snapshot: ${value}\n    live:     ${b.get(id)}`);
  }
  for (const id of b.keys()) if (!a.has(id)) notes.push(`new in live API: ${id}`);
  return notes;
}

// 1. Offline.
const snapshot = readSpec();
const expected = renderOperations(snapshot);
let actual = "";
try {
  actual = readFileSync(OUTPUT_PATH, "utf8");
} catch {
  actual = "";
}
if (actual !== expected) {
  fail("src/client/generated/operations.ts is out of date with openapi/openapi.json. Run `pnpm generate:client` and commit the result.");
} else {
  console.log(`drift: generated client matches the snapshot (${collectOperations(snapshot).length} operations).`);
}
if (snapshot["x-provisional"] === true) {
  console.log("drift: note: openapi/openapi.json is still the provisional snapshot (x-provisional: true).");
}

// 2. Live.
const base = process.env.SUPERFLOW_DRIFT_BASE_URL?.trim();
if (base) {
  const url = `${base.replace(/\/+$/, "")}/openapi.json`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      fail(`GET ${url} returned HTTP ${response.status}.`);
    } else {
      const live = await response.json();
      if (JSON.stringify(canonical(live)) !== JSON.stringify(canonical(snapshot))) {
        const notes = describeOperationDiff(snapshot, live);
        fail(
          `the live OpenAPI document at ${url} differs from openapi/openapi.json.` +
            (notes.length ? `\n  ${notes.join("\n  ")}` : "\n  Operations match; schemas or metadata differ.") +
            "\n  Copy the live document into openapi/openapi.json, run `pnpm generate:client`, and review the diff.",
        );
      } else {
        console.log(`drift: live OpenAPI document at ${url} matches the snapshot.`);
      }
    }
  } catch (error) {
    fail(`could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
} else {
  console.log("drift: SUPERFLOW_DRIFT_BASE_URL is not set, skipping the live check.");
}

process.exit(failed ? 1 : 0);
