// Fails when an em dash (U+2014) or en dash (U+2013) appears in source, docs or examples.
// Use periods, commas or colons instead.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TARGETS = [
  "src",
  "docs",
  "examples",
  "scripts",
  "test",
  "openapi",
  ".github",
  "README.md",
  "CLAUDE.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);
const TEXT_EXTENSIONS = /\.(?:ts|mts|cts|js|mjs|cjs|json|md|yml|yaml|txt)$/;
const DASHES = /[\u2013\u2014]/;

function* walk(path) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return;
  }
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walk(join(path, entry));
    }
  } else if (TEXT_EXTENSIONS.test(path)) {
    yield path;
  }
}

const problems = [];
for (const target of TARGETS) {
  for (const file of walk(join(ROOT, target))) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (DASHES.test(line)) {
        const kind = line.includes("\u2014") ? "em dash" : "en dash";
        problems.push(`${relative(ROOT, file)}:${index + 1}: ${kind}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

if (problems.length > 0) {
  console.error(`check-copy: found ${problems.length} line(s) with an em or en dash. Use periods, commas or colons.`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("check-copy: no em or en dashes.");
