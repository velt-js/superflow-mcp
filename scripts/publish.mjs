// Builds and publishes one npm package: `node scripts/publish.mjs <prod|staging> [--dry-run]`.
//
//   prod     @usesuperflow/mcp, public, with provenance (CI: push to main, publish.yml)
//   staging  @usesuperflow/mcp-staging, restricted to the usesuperflow npm org, no provenance
//            (npm refuses provenance for a private package) (CI: push to staging)
//
// Steps: pick the version (nothing published yet: package.json's version; else the higher of
// package.json's version and the latest published patch + 1), write the target's name,
// version, publishConfig and description into package.json, build with SUPERFLOW_MCP_TARGET,
// check that dist holds this target's origin and no other, then `npm publish` (or
// `npm publish --dry-run`). Writes `name` and `version` to $GITHUB_OUTPUT when it is set.
// package.json is put back afterwards, so a local dry run leaves the tree clean (dist/ then
// holds this target's build).
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { distProblems, packageJsonFor, pickVersion } from "./lib/release.mjs";
import { TARGETS, resolveTarget } from "./lib/targets.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_JSON = join(ROOT, "package.json");
const DIST = join(ROOT, "dist");
const USAGE = "Usage: node scripts/publish.mjs <prod|staging> [--dry-run]";

function fail(message) {
  process.stderr.write(`publish: ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stderr.write(`publish: ${message}\n`);
}

/** The latest published version of `name`, or null when npm has none (a 404). */
function latestPublished(name) {
  const result = spawnSync("npm", ["view", name, "version", "--json"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
  if (result.status === 0) {
    const text = result.stdout.trim();
    if (!text) return null;
    const value = JSON.parse(text);
    return Array.isArray(value) ? String(value.at(-1)) : String(value);
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  // A private package the token cannot read is a 404 too: the publish then fails on npm's
  // side (a version that exists), never silently.
  if (/E404|404 Not Found|is not in this registry/i.test(output)) return null;
  throw new Error(`npm view ${name} failed:\n${output.trim()}`);
}

function readDist() {
  const files = {};
  for (const entry of readdirSync(DIST)) {
    if (/\.(?:c?js|mjs)$/.test(entry)) files[entry] = readFileSync(join(DIST, entry), "utf8");
  }
  return files;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (positional.length !== 1 || args.some((arg) => arg.startsWith("--") && arg !== "--dry-run")) fail(USAGE);
  let targetName;
  try {
    targetName = resolveTarget(positional[0]);
  } catch (error) {
    fail(`${error.message}\n${USAGE}`);
  }
  const target = TARGETS[targetName];
  if (!dryRun && !process.env.NODE_AUTH_TOKEN?.trim()) {
    fail("NODE_AUTH_TOKEN is not set. CI passes the NPM_AUTH_TOKEN secret; set it, or add --dry-run.");
  }

  const original = readFileSync(PACKAGE_JSON, "utf8");
  const pkg = JSON.parse(original);
  try {
    const latest = latestPublished(target.npmPackage);
    const version = pickVersion(pkg.version, latest);
    log(`${target.npmPackage}: latest published ${latest ?? "none"}, package.json ${pkg.version}, publishing ${version}${dryRun ? " (dry run)" : ""}.`);

    writeFileSync(PACKAGE_JSON, `${JSON.stringify(packageJsonFor(pkg, targetName, version), null, 2)}\n`);

    execFileSync("pnpm", ["run", "build"], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, SUPERFLOW_MCP_TARGET: targetName },
      shell: process.platform === "win32",
    });

    const problems = distProblems(readDist(), targetName);
    if (problems.length) throw new Error(`The ${targetName} build is wrong:\n  ${problems.join("\n  ")}`);
    log(`dist holds the ${targetName} origin ${target.origin} and no other.`);

    const publishArgs = ["publish", "--access", target.access];
    // Provenance needs the GitHub OIDC token (id-token: write); a dry run never makes one.
    if (target.provenance && !dryRun) publishArgs.push("--provenance");
    if (dryRun) publishArgs.push("--dry-run");
    log(`npm ${publishArgs.join(" ")}`);
    execFileSync("npm", publishArgs, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });

    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `name=${target.npmPackage}\nversion=${version}\n`);
    }
    log(`${dryRun ? "Dry run done" : "Published"}: ${target.npmPackage}@${version}`);
  } finally {
    writeFileSync(PACKAGE_JSON, original);
  }
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
