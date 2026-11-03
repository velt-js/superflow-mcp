// Client-side id helpers. The API resolves names, URLs, emails and comment links; the
// package only trims references and encodes path parameters.

/** Trims a comment reference for a path: a cmt_ id, a raw id or the comment's link pass through. */
export function normalizeCommentRef(value: string): string {
  return value.trim();
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
