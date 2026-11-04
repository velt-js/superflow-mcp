import type { TargetName } from "./targets.mjs";

export declare function parseVersion(version: string): [number, number, number];
export declare function compareVersions(a: string, b: string): number;
export declare function bumpPatch(version: string): string;
export declare function pickVersion(packageVersion: string, latest: string | null | undefined): string;
export declare function packageJsonFor<T extends Record<string, unknown>>(
  pkg: T,
  targetName: TargetName,
  version: string,
): T & { name: string; version: string; description: string; publishConfig: { access: "public" | "restricted"; provenance?: true } };
export declare function distProblems(files: Record<string, string>, targetName: TargetName): string[];
