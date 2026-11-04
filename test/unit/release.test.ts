import { describe, expect, it } from "vitest";
import { bumpPatch, compareVersions, distProblems, packageJsonFor, parseVersion, pickVersion } from "../../scripts/lib/release.mjs";
import { TARGETS } from "../../scripts/lib/targets.mjs";

describe("publish version picking (scripts/lib/release.mjs)", () => {
  it("takes package.json's version when nothing is published yet (the npm 404)", () => {
    expect(pickVersion("0.1.0", null)).toBe("0.1.0");
    expect(pickVersion("0.1.0", undefined)).toBe("0.1.0");
  });

  it("takes the latest published patch + 1 when package.json is not ahead", () => {
    expect(pickVersion("0.1.0", "0.1.0")).toBe("0.1.1");
    expect(pickVersion("0.1.0", "0.1.7")).toBe("0.1.8");
    expect(pickVersion("0.1.0", "0.2.3")).toBe("0.2.4");
  });

  it("takes package.json's version when it is ahead (a minor or major bump wins)", () => {
    expect(pickVersion("0.2.0", "0.1.7")).toBe("0.2.0");
    expect(pickVersion("1.0.0", "0.9.9")).toBe("1.0.0");
    expect(pickVersion("0.1.8", "0.1.7")).toBe("0.1.8");
  });

  it("compares by number, not by text", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(bumpPatch("0.1.9")).toBe("0.1.10");
  });

  it("refuses versions that are not plain x.y.z", () => {
    expect(() => parseVersion("1.0.0-beta.1")).toThrow(/plain x.y.z/);
    expect(() => pickVersion("v1.0.0", null)).toThrow(/plain x.y.z/);
  });
});

describe("the package.json a target publishes with", () => {
  const pkg = { name: "@usesuperflow/mcp", version: "0.1.0", description: "A local stdio MCP server.", publishConfig: { access: "public", provenance: true } };

  it("prod: public with provenance, description unchanged", () => {
    expect(packageJsonFor(pkg, "prod", "0.1.3")).toMatchObject({
      name: "@usesuperflow/mcp",
      version: "0.1.3",
      description: "A local stdio MCP server.",
      publishConfig: { access: "public", provenance: true },
    });
  });

  it("staging: restricted, no provenance (npm refuses it for a private package), description says staging", () => {
    const staged = packageJsonFor(pkg, "staging", "0.1.0");
    expect(staged.name).toBe("@usesuperflow/mcp-staging");
    expect(staged.publishConfig).toEqual({ access: "restricted" });
    expect(staged.description).toBe(`A local stdio MCP server.${TARGETS.staging.descriptionSuffix}`);
    expect(packageJsonFor(staged, "staging", "0.1.0").description).toBe(staged.description);
  });
});

describe("the dist check", () => {
  const prodBuild = { "index.js": `const ORIGIN = "${TARGETS.prod.origin}"; const NAME = "${TARGETS.prod.npmPackage}";` };
  const stagingBuild = { "index.js": `const ORIGIN = "${TARGETS.staging.origin}"; const NAME = "${TARGETS.staging.npmPackage}";` };

  it("passes a build that holds only its own origin", () => {
    expect(distProblems(prodBuild, "prod")).toEqual([]);
    expect(distProblems(stagingBuild, "staging")).toEqual([]);
  });

  it("fails a build of the other target", () => {
    expect(distProblems(prodBuild, "staging")).toEqual(expect.arrayContaining([expect.stringContaining("does not contain the staging origin")]));
    expect(distProblems(stagingBuild, "prod")).toEqual(expect.arrayContaining([expect.stringContaining("does not contain the prod origin")]));
  });

  it("fails a staging build that still holds the prod origin", () => {
    const mixed = { ...stagingBuild, "server.cjs": `fetch("${TARGETS.prod.origin}/v1")` };
    expect(distProblems(mixed, "staging")).toEqual([`server.cjs contains the prod origin ${TARGETS.prod.origin}.`]);
  });
});
