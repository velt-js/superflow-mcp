// Client-side lookups for confirm previews. A destructive tool without confirm: true only
// reads, so it finds the item to show the user in a list the API returned. The rules mirror
// the API's resolver (CONTRACT section 3) closely enough for a preview; the real write still
// resolves the reference on the server.
import { SuperflowApiError } from "../client/api.ts";

export interface Matchable {
  id: string;
  name: string;
  email?: string | null;
}

export interface MatchOptions {
  /** The id prefix, for example "sts_", so a raw id matches too. */
  prefix: string;
  /** Also match a unique name prefix (people), after exact names. */
  namePrefix?: boolean;
}

export type MatchResult<T> = { kind: "one"; item: T } | { kind: "none" } | { kind: "many"; items: T[] };

/** Finds one item by prefixed id, raw id, email, or name (case-insensitive). */
export function matchRef<T extends Matchable>(items: readonly T[], ref: string, options: MatchOptions): MatchResult<T> {
  const value = ref.trim();
  const lower = value.toLowerCase();
  const byId = items.find((item) => item.id === value || item.id === `${options.prefix}${value}`);
  if (byId) return { kind: "one", item: byId };
  const byEmail = items.filter((item) => typeof item.email === "string" && item.email.toLowerCase() === lower);
  if (byEmail.length > 0) return byEmail.length === 1 ? { kind: "one", item: byEmail[0] as T } : { kind: "many", items: byEmail };
  const byName = items.filter((item) => item.name.toLowerCase() === lower);
  if (byName.length === 1) return { kind: "one", item: byName[0] as T };
  if (byName.length > 1) return { kind: "many", items: byName };
  if (options.namePrefix && lower !== "") {
    const byPrefix = items.filter((item) => item.name.toLowerCase().startsWith(lower));
    if (byPrefix.length === 1) return { kind: "one", item: byPrefix[0] as T };
    if (byPrefix.length > 1) return { kind: "many", items: byPrefix };
  }
  return { kind: "none" };
}

export interface FindOptions extends MatchOptions {
  /** What is being looked up, for messages: "status", "tag", "guest". */
  noun: string;
  /** Where it was looked up, for messages: 'project "Acme Dental"' or "the workspace". */
  where: string;
  /** Hint for a miss. */
  notFoundHint: string;
}

/** Like matchRef, but throws the API's not_found or ambiguous error so the tool returns it. */
export function findOne<T extends Matchable>(items: readonly T[], ref: string, options: FindOptions): T {
  const result = matchRef(items, ref, options);
  if (result.kind === "one") return result.item;
  if (result.kind === "many") {
    throw new SuperflowApiError({
      status: 409,
      code: "ambiguous",
      message: `"${ref}" matches ${result.items.length} ${options.noun}s in ${options.where}.`,
      hint: "Pick one of the candidates and call again with its id.",
      candidates: result.items.slice(0, 10).map((item) => ({ id: item.id, name: item.name })),
    });
  }
  throw new SuperflowApiError({
    status: 404,
    code: "not_found",
    message: `No ${options.noun} "${ref}" in ${options.where}.`,
    hint: options.notFoundHint,
  });
}
