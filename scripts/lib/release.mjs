// The pure parts of scripts/publish.mjs, importable by the unit tests: version picking, the
// package.json a target publishes with, and the check that a build holds only its own origin.
import { TARGETS } from "./targets.mjs";

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** [major, minor, patch] of a plain x.y.z version. Prereleases are refused: CI never makes one. */
export function parseVersion(version) {
  const match = VERSION.exec(String(version ?? "").trim());
  if (!match) throw new Error(`"${version}" is not a plain x.y.z version.`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when a is lower, 0 when equal, positive when a is higher. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/** 0.1.4 becomes 0.1.5. */
export function bumpPatch(version) {
  const [major, minor, patch] = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * The version to publish. Nothing published yet (`latest` null, the npm 404): package.json's
 * version. Otherwise the higher of package.json's version and the latest published patch + 1,
 * so a bump in package.json (a minor or major) wins and every other push takes the next patch.
 */
export function pickVersion(packageVersion, latest) {
  parseVersion(packageVersion);
  if (latest === null || latest === undefined || latest === "") return packageVersion;
  const next = bumpPatch(latest);
  return compareVersions(packageVersion, next) >= 0 ? packageVersion : next;
}

/** package.json as `target` publishes it: its name, version, publishConfig and description. */
export function packageJsonFor(pkg, targetName, version) {
  const target = TARGETS[targetName];
  if (!target) throw new Error(`Unknown target "${targetName}".`);
  const publishConfig = { access: target.access };
  if (target.provenance) publishConfig.provenance = true;
  const description = String(pkg.description ?? "");
  return {
    ...pkg,
    name: target.npmPackage,
    version,
    description: target.descriptionSuffix && !description.endsWith(target.descriptionSuffix) ? description + target.descriptionSuffix : description,
    publishConfig,
  };
}

/**
 * Problems with a build of `targetName`, given the text of every file in dist: it must hold its
 * own origin and npm name and no other target's origin. An empty list means it is fine.
 */
export function distProblems(files, targetName) {
  const target = TARGETS[targetName];
  const problems = [];
  const all = Object.values(files).join("\n");
  if (!all.includes(target.origin)) problems.push(`dist does not contain the ${targetName} origin ${target.origin}.`);
  if (!all.includes(target.npmPackage)) problems.push(`dist does not name ${target.npmPackage}.`);
  for (const [name, other] of Object.entries(TARGETS)) {
    if (name === targetName) continue;
    for (const [file, text] of Object.entries(files)) {
      if (text.includes(other.origin)) problems.push(`${file} contains the ${name} origin ${other.origin}.`);
    }
  }
  return problems;
}
