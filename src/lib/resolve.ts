// Client-side id helpers. The API resolves names, URLs, emails and numbers; the
// package only normalizes comment numbers, injects the default project for them,
// and encodes path parameters.

const NUMBER_PATTERN = /^#?\s*(\d{1,12})$/;

/** Returns the comment number for "4821" or "#4821", else undefined. */
export function parseCommentNumber(value: string): number | undefined {
  const match = NUMBER_PATTERN.exec(value.trim());
  return match?.[1] ? Number(match[1]) : undefined;
}

export function isCommentNumber(value: string): boolean {
  return parseCommentNumber(value) !== undefined;
}

/** Normalizes a comment reference for a path: "#4821" becomes "4821"; ids pass through trimmed. */
export function normalizeCommentRef(value: string): string {
  const number = parseCommentNumber(value);
  return number !== undefined ? String(number) : value.trim();
}

/**
 * The project to send with a comment reference. A bare number needs a project, so when
 * the caller gave none, SUPERFLOW_DEFAULT_PROJECT is used. Ids never get one injected.
 */
export function projectForComment(
  comment: string,
  project: string | undefined,
  defaultProject: string | undefined,
): string | undefined {
  if (project && project.trim()) return project.trim();
  return isCommentNumber(comment) ? defaultProject : undefined;
}

/** True when any reference in the list is a bare comment number. */
export function anyCommentNumber(values: readonly string[]): boolean {
  return values.some(isCommentNumber);
}

/** URL-encodes one path segment. Names and URLs may contain "/" or spaces. */
export function encodePathParam(value: string): string {
  return encodeURIComponent(value);
}

export interface ParsedReplyId {
  /** Prefixed reply id: rpl_<annotationId>.<commentId>. */
  replyId: string;
  /** Prefixed parent comment id: cmt_<annotationId>. */
  commentId: string;
}

/**
 * Parses a reply id. Accepts the prefixed form (rpl_<annotationId>.<commentId>) or the raw
 * form, splitting at the LAST "." as the contract says. Returns undefined when it has no ".".
 */
export function parseReplyId(value: string): ParsedReplyId | undefined {
  const raw = value.trim().replace(/^rpl_/, "");
  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return undefined;
  const annotationId = raw.slice(0, dot);
  return { replyId: `rpl_${raw}`, commentId: `cmt_${annotationId}` };
}
