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
  "Nothing was deleted. Show this comment to the user and ask whether to delete it. Deleting is permanent: the comment and its replies are gone for good and cannot be restored. To close it without losing it, use superflow_resolve_comment. If they say yes, call superflow_delete_comment again with confirm: true.";

export const CONFIRM_DELETE_REPLY_MESSAGE =
  "Nothing was deleted. Show this reply to the user and ask whether to delete it. If they say yes, call superflow_delete_reply again with confirm: true. Deleted replies cannot be restored.";

export const CONFIRM_BULK_MESSAGE =
  "Nothing was changed. This was a dry run. Show the user how many comments would change and the sample, and ask whether to apply it. If they say yes, call superflow_bulk_update_comments again with the same selection and patch, dry_run: false and confirm: true.";

// Phase 2 destructive tools. Each message tells the model what was NOT done, what to show
// the user, what the real call does, and how to make it.

export const CONFIRM_DELETE_PROJECT_MESSAGE =
  "Nothing was deleted. Show the user the project with its comment and page counts, and ask whether to delete it. Deleting is permanent: the project, its pages and every comment on it are gone and cannot be restored. To hide a project without losing anything, use superflow_archive_project. If the user says yes, call superflow_delete_project again with confirm: true.";

export const CONFIRM_REMOVE_PAGE_MESSAGE =
  "Nothing was removed. Show the user the page and how many comments it has, and ask whether to remove it. Removing a page also deletes its comments (at most 200) for good: they cannot be restored. To keep them, resolve them with superflow_bulk_update_comments instead. If the user says yes, call superflow_remove_page again with confirm: true.";

export const CONFIRM_REMOVE_MEMBER_MESSAGE =
  "Nothing was removed. Show the user the member and how many open comments are assigned to them, and ask whether to remove them from the workspace. Pass reassign_to (another member) to move those comments; otherwise they stay assigned to the removed person. If the user says yes, call superflow_remove_member again with confirm: true.";

export const CONFIRM_REMOVE_GUEST_MESSAGE =
  "Nothing was removed. Show the user the guest and ask whether to remove them from this project. They keep any other projects they were invited to. If the user says yes, call superflow_remove_guest again with confirm: true.";

export const CONFIRM_DELETE_STATUS_MESSAGE =
  "Nothing was deleted. Show the user the status, where its comments will move, and how many comments that is, and ask whether to delete it. If the user says yes, call superflow_delete_status again with the same move_comments_to and confirm: true.";

export const CONFIRM_DELETE_TAG_MESSAGE =
  "Nothing was deleted. Show the user the tag and how many comments carry it, and ask whether to delete it. Deleting takes the tag off every comment that carries it, in every project; the comments stay. One call changes at most 500 comments: when the result says complete: false, call again to finish. If the user says yes, call superflow_delete_tag again with confirm: true.";

export const CONFIRM_MERGE_TAGS_MESSAGE =
  "Nothing was merged. Show the user both tags and how many comments would change, and ask whether to merge them. Every comment with the first tag gets the second one instead, in every project, and the first tag is gone. One call changes at most 500 comments: when the result says complete: false, call again to finish. If the user says yes, call superflow_merge_tags again with confirm: true.";

export const CONFIRM_CREATE_API_KEY_MESSAGE =
  "Nothing was created. Show the user the label, scopes and expiry, and ask whether to create the key. Its token will appear once, in this conversation. If the user says yes, call superflow_create_api_key again with confirm: true.";

export const CONFIRM_REVOKE_API_KEY_MESSAGE =
  "Nothing was revoked. Show the user the key, and ask whether to revoke it. Anything using it stops working at once. If the user says yes, call superflow_revoke_api_key again with confirm: true.";

export const CONFIRM_REVOKE_REVIEW_LINK_MESSAGE =
  "Nothing was revoked. Show the user the link and its project, and ask whether to revoke it. Anyone using the link loses access. If the user says yes, call superflow_revoke_review_link again with confirm: true.";

// Phase 3 gated tools: three deletes, starting a run (it spends AI credits) and a Slack post
// (people see it).

export const CONFIRM_DELETE_AGENT_MESSAGE =
  "Nothing was deleted. Show the user the agent, the packs it is in and the schedules that use it, and ask whether to delete it. Deleting is permanent. It is also taken out of those schedules, and a schedule left with no agents is turned off. To stop using it without deleting, use superflow_update_agent with enabled: false. If the user says yes, call superflow_delete_agent again with confirm: true.";

export const CONFIRM_RUN_AGENTS_MESSAGE =
  "Nothing was started. Show the user the estimate: the credits (credits_display), the pages, the agents and the balance. Ask whether to start the run. If the user says yes, call superflow_run_agents again with the same project, scope, pages and agents or pack, and confirm: true. Then check it with superflow_get_run no more often than every 20 seconds.";

export const CONFIRM_SET_SCHEDULE_MESSAGE =
  "Nothing was created or changed. Show the user when the schedule would run, which agents (they are fixed when the schedule is saved), and what one run costs (the estimate), and say that every run spends AI credits. Ask whether to go ahead. If the user says yes, call superflow_set_schedule again with the same arguments and confirm: true.";

export const CONFIRM_DELETE_SCHEDULE_MESSAGE =
  "Nothing was deleted. Show the user the schedule (project, when it runs, which agents) and ask whether to delete it. No more runs start from it after that. To pause it instead, use superflow_set_schedule with enabled: false. If the user says yes, call superflow_delete_schedule again with confirm: true.";

export const CONFIRM_POST_TO_SLACK_MESSAGE =
  "Nothing was posted. Show the user the channel and what would be posted (the text and the comments), and ask whether to post it. Everyone in that Slack channel will see the message. If the user says yes, call superflow_post_to_slack again with the same arguments and confirm: true.";

/** Where to add AI credits, for runs that cannot start. */
export const ADD_CREDITS_HINT =
  "Add AI credits in Superflow under Settings > Billing, or turn on auto refill there. Do not retry the run until the balance covers it.";

// Checks (spec addendum "Checks tools").

export const CONFIRM_REJECT_COMMENT_MESSAGE =
  "Nothing was rejected. Show the user the finding and the reason, and ask whether to reject it. Rejecting cannot be undone: the finding leaves the open list and the score, and no scan reopens it. If it was fixed, use superflow_resolve_comment instead. If the user says yes, call superflow_reject_comment again with the same reason and confirm: true.";

export const CONFIRM_MARK_CHECK_FIXED_MESSAGE =
  "Nothing was resolved. Show the user the check and how many open findings it has, and ask whether to mark it fixed. Every open finding of it is resolved and its pages are rescanned (1 credit); a problem that is still there comes back as an open finding. If the user says yes, call superflow_mark_check_fixed again with confirm: true.";

export const CONFIRM_EXCLUDE_CHECK_MESSAGE =
  "Nothing was excluded. Show the user the check and how many open findings it has, and ask whether to exclude it for this site. Its open findings are rejected with the reason and new ones are kept out until superflow_include_check. If the user says yes, call superflow_exclude_check again with confirm: true.";

export const CONFIRM_SITE_CARE_MESSAGE =
  "Nothing was changed. Show the user what care means for this site: Superflow runs the agents on a schedule and each run spends AI credits; on a site that was never monitored it also starts a full check now. Ask whether to turn it on. If the user says yes, call superflow_set_site_mode again with confirm: true.";

export const CONFIRM_SITE_CARE_CHANGE_MESSAGE =
  "Nothing was changed. The site is already in care. Show the user the new cadence or time zone: it changes when, or how often, the agents run and spend AI credits. Ask whether to change it. If the user says yes, call superflow_set_site_mode again with confirm: true.";

export const CONFIRM_FORM_TEST_CHANGE_MESSAGE =
  "Nothing was changed. The form is already tested. Show the user the new schedule (daily, or on each scan): every test lands in the client's inbox as a lead. Ask whether to change it. If the user says yes, call superflow_set_form_testing again with confirm: true.";

export const CONFIRM_FORM_TEST_MESSAGE =
  "Nothing was changed. Show the user the form and explain that each test submits it for real, so every test lands in the client's inbox as a lead. Ask whether to turn testing on and accept those test leads. If the user says yes, call superflow_set_form_testing again with confirm: true.";

