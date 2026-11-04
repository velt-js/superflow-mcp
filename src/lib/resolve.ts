// Client-side id helpers. The API resolves names, URLs, emails and comment links; the
// package only trims references, turns a comment link into its id, and encodes path parameters.

/**
 * A comment reference for a path: a cmt_ id or raw id is trimmed; the comment's link (an http or
 * https URL with scommentId, its url) becomes cmt_<scommentId>, so the path carries an id rather
 * than an encoded URL. Any other value passes through for the API to answer.
 */
export function normalizeCommentRef(value: string): string {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return text;
  let id: string | undefined;
  try {
    id = new URL(text).searchParams.get("scommentId")?.trim();
  } catch {
    return text;
  }
  return id ? `cmt_${id}` : text;
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
