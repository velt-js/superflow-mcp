// Confirm and dry-run gates (spec section 5, rules 7 and 8). The gates live in the MCP
// layer: without confirm: true the destructive tools only read and return a preview.

export type BulkMode =
  /** Preview only (dry_run true, the default). */
  | "dry_run"
  /** The caller asked for a real run but did not confirm: preview and ask. */
  | "needs_confirmation"
  /** dry_run false and confirm true: write. */
  | "apply";

export function bulkMode(input: { dry_run?: boolean | undefined; confirm?: boolean | undefined }): BulkMode {
  const dryRun = input.dry_run ?? true;
  if (dryRun) return "dry_run";
  return input.confirm === true ? "apply" : "needs_confirmation";
}

/** True only for an explicit confirm: true. */
export function isConfirmed(confirm: boolean | undefined): boolean {
  return confirm === true;
}

export const CONFIRM_DELETE_COMMENT_MESSAGE =
  "Nothing was deleted. Show this comment to the user and ask whether to delete it. If they say yes, call superflow_delete_comment again with confirm: true. A deleted comment can be restored with superflow_restore_comment until its restore_until time.";

export const CONFIRM_DELETE_REPLY_MESSAGE =
  "Nothing was deleted. Show this reply to the user and ask whether to delete it. If they say yes, call superflow_delete_reply again with confirm: true. Deleted replies cannot be restored.";

export const CONFIRM_BULK_MESSAGE =
  "Nothing was changed. This was a dry run. Show the user how many comments would change and the sample, and ask whether to apply it. If they say yes, call superflow_bulk_update_comments again with the same selection and patch, dry_run: false and confirm: true.";
