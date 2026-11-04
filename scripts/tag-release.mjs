// Tags the published commit: `node scripts/tag-release.mjs <tag> <sha>`, run by the publish
// workflows after a real publish (v<version> for @usesuperflow/mcp, staging-v<version> for
// @usesuperflow/mcp-staging). It is the git record of what each npm version was built from.
// Uses the gh CLI with GH_TOKEN (the workflow's token, contents: write). A rerun is fine: a tag
// already on the same commit passes; a tag on another commit fails, so a version is never moved.
import { execFileSync } from "node:child_process";

const [tag, sha] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY;
if (!tag || !/^(staging-)?v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error(`tag-release: not a release tag: ${tag ?? "(none)"}`);
  process.exit(1);
}
if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
  console.error(`tag-release: not a commit: ${sha ?? "(none)"}`);
  process.exit(1);
}
if (!repo) {
  console.error("tag-release: GITHUB_REPOSITORY is not set");
  process.exit(1);
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let existing = null;
try {
  existing = gh(["api", `repos/${repo}/git/ref/tags/${tag}`, "--jq", ".object.sha"]);
} catch {
  existing = null; // 404: not tagged yet
}

if (existing === sha) {
  console.log(`${tag} is already on ${sha}`);
} else if (existing) {
  console.error(`tag-release: ${tag} already points at ${existing}, not ${sha}. Not moving it.`);
  process.exit(1);
} else {
  gh(["api", "-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${sha}`]);
  console.log(`Tagged ${sha} as ${tag}`);
}
