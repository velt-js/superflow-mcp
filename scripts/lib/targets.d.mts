export type TargetName = "prod" | "staging";

export interface Target {
  readonly npmPackage: string;
  readonly origin: string;
  readonly credentialStore: string;
  readonly access: "public" | "restricted";
  readonly provenance: boolean;
  readonly descriptionSuffix: string;
}

export declare const TARGETS: Readonly<Record<TargetName, Target>>;

export declare function resolveTarget(value: string | undefined): TargetName;
