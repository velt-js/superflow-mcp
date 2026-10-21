// Date filters accept ISO 8601 or a relative token (CONTRACT section 4). The API
// resolves them; the package only checks the shape so a typo fails fast and clearly.

export const RELATIVE_WORDS = ["today", "yesterday", "this_week", "last_week"] as const;
const RELATIVE_SPAN = /^[1-9]\d{0,3}[hdwm]$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const DATE_HELP =
  "Use an ISO date like 2026-10-01 or 2026-10-01T09:00:00Z, or a relative token: 24h, 7d, 2w, 1m, today, yesterday, this_week, last_week.";

export function isValidDateFilter(value: string): boolean {
  const v = value.trim();
  if ((RELATIVE_WORDS as readonly string[]).includes(v)) return true;
  if (RELATIVE_SPAN.test(v)) return true;
  if (!ISO_DATE.test(v)) return false;
  return Number.isFinite(Date.parse(v.replace(" ", "T")));
}

export const DATE_FILTER_KEYS = [
  "created_after",
  "created_before",
  "updated_after",
  "updated_before",
  "resolved_after",
  "resolved_before",
] as const;

/** Returns a one-line problem description for the first invalid date filter, or undefined. */
export function findInvalidDate(input: Record<string, unknown>, prefix = ""): string | undefined {
  for (const key of DATE_FILTER_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !isValidDateFilter(value)) {
      return `${prefix}${key} "${String(value)}" is not a date Superflow understands. ${DATE_HELP}`;
    }
  }
  return undefined;
}

/** Validates a plain string as a relative token or ISO date, for prompt arguments. */
export function describeDateProblem(name: string, value: string): string | undefined {
  return isValidDateFilter(value) ? undefined : `${name} "${value}" is not a date Superflow understands. ${DATE_HELP}`;
}
