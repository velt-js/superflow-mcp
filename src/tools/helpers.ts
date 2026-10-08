// Small helpers shared by the tool modules.

export type Data = Record<string, unknown>;

/** API JSON goes straight to structuredContent. */
export const asData = (value: unknown): Data => value as Data;

/** Drops undefined values so request bodies only carry what the caller set. */
export function compact<T extends Data>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Joins summary sentences, skipping empty and false parts. */
export function join(...parts: Array<string | null | undefined | false>): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" ");
}

/** "a, b, c" with at most `max` names, then ", ...". */
export function nameList(names: readonly string[], max = 5): string {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown}, ...` : shown;
}

/** "12" for numbers, "unknown" for null or undefined. */
export function count(value: number | null | undefined): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : "unknown";
}

/** "5 of 10" or "5 of unlimited". */
export function ofTotal(used: number | null | undefined, total: number | null | undefined): string {
  return `${count(used)} of ${total === null ? "unlimited" : count(total)}`;
}
