# Changelog

All notable changes to the Superflow MCP servers are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There are two release lines: the `superflow-mcp` npm package (local stdio server,
versions 0.x) and the hosted server at `https://mcp.usesuperflow.ai/mcp`
(versions 1.x).

## [0.2.0] - Unreleased

Admin tools (Phase 2): run the setup side of Superflow from the assistant.

### Added
- 33 admin tools, 54 in total:
  - Projects: `superflow_get_project`, `superflow_create_project`,
    `superflow_update_project`, `superflow_archive_project`,
    `superflow_unarchive_project`, `superflow_delete_project`,
    `superflow_get_install_snippet`, `superflow_verify_install`.
  - Pages: `superflow_get_page`, `superflow_add_page`, `superflow_remove_page`.
  - People: `superflow_invite_member`, `superflow_remove_member`,
    `superflow_list_guests`, `superflow_invite_guest`, `superflow_remove_guest`.
  - Statuses: `superflow_create_status`, `superflow_update_status`,
    `superflow_reorder_statuses`, `superflow_delete_status`.
  - Tags: `superflow_create_tag`, `superflow_update_tag`, `superflow_delete_tag`,
    `superflow_merge_tags`.
  - Workspace: `superflow_get_organization`, `superflow_update_organization`,
    `superflow_get_credit_usage`, `superflow_list_activity`.
  - Review links: `superflow_list_review_links`, `superflow_create_review_link`
    (Velt-internal accounts only for now), `superflow_revoke_review_link`.
  - Notifications: `superflow_get_notification_settings`,
    `superflow_update_notification_settings` (your own settings only).
- Confirm gates on the eight destructive admin tools. Without `confirm: true` they
  only read and return a preview: the project with its comment and page counts, the
  page and its comments, the member and their open assigned comments, the guest,
  the status and where its comments go, the tag and its usage, both tags of a
  merge, the review link.
- The `onboard_client` prompt: create the project, invite the client's reviewers,
  hand over the install snippet and verify it, asking before each write.
  `launch_checklist` now also checks the install status and the guests.
- The `superflow://organization` resource.
- Creates and invites send an idempotency key, so a retried call does not create
  a second project or send a second email.
- New scopes for the admin tools: `users:write` (remove members and guests) and
  `workspace:write` (rename the workspace, notification settings).

### Not yet
- Changing member roles or per-project member access, refreshing a page
  screenshot, and choosing the digest time. The API has no way to do them.
- Review link expiry and per-page links.
- Clearing an assignee when removing a member: pass `reassign_to`, or the open
  comments stay assigned to the removed person.

## [0.1.0] - Unreleased

First release of the `superflow-mcp` npm package, a local stdio server:
`npx -y superflow-mcp`.

### Added
- 21 comment tools over the Superflow REST API v1: `superflow_get_me`,
  `superflow_list_projects`, `superflow_list_pages`, `superflow_list_members`,
  `superflow_list_statuses`, `superflow_list_tags`, `superflow_list_comments`,
  `superflow_get_comment`, `superflow_comment_stats`, `superflow_export_comments`,
  `superflow_create_comment`, `superflow_update_comment`,
  `superflow_resolve_comment`, `superflow_reopen_comment`, `superflow_add_reply`,
  `superflow_update_reply`, `superflow_delete_reply`, `superflow_delete_comment`,
  `superflow_restore_comment`, `superflow_bulk_update_comments`,
  `superflow_add_attachment`.
- Six prompts: `triage`, `stale_threads`, `client_update`, `agent_findings_review`,
  `find_duplicates`, `launch_checklist`.
- Four resources: `superflow://projects`, `superflow://projects/{project}`,
  `superflow://projects/{project}/comments`, `superflow://comments/{comment}`.
- Ids accept names, site URLs, emails and comment numbers, resolved by the API.
  Ambiguous matches come back with candidates.
- Confirm gates for deletes and bulk writes; bulk updates are dry runs by default and
  report how many comments would change, already match, were updated, skipped or failed.
- Write limits from the API built into the schemas: three priorities (critical, high,
  medium), one assignee, and comments created as public, like a toolbar comment.
- `SUPERFLOW_READ_ONLY=true` leaves every write tool unregistered.
- `SUPERFLOW_DEFAULT_PROJECT` for bare comment numbers.
- Retries with `Retry-After` on rate limits, and safe retries on 502, 503 and 504.
- Results carry structured content plus a one-line summary, are capped at about
  8k tokens, and mark visitor-written comment text as untrusted.

### Not yet
- Streamable HTTP transport (`src/http.ts`) and a Docker image. The hosted server
  already covers remote clients; a follow-up runs this package's tools there.
- Admin tools (projects, members, statuses, tags), agents, integrations and
  webhooks. Those are Phase 2 and Phase 3.
- Removing an assignee, clearing a priority and deleting an attachment. The API does
  not support them yet; use the Superflow toolbar.

## [1.0.0] - Hosted server

Initial public release of the hosted server at `https://mcp.usesuperflow.ai/mcp`.

### Added
- Remote MCP server over Streamable HTTP at `/mcp`.
- 20 scoped tools across workspace, projects, agents, comments, analytics, and team.
- No-account demo endpoint at `/mcp/try` with `run_site_preview` and `get_site_preview`.
- Personal access tokens (`sf_pat_...`) with per-scope selection and 30-day, 90-day, or no expiry.
- OAuth 2.1 with PKCE and RFC 7591 dynamic client registration, for clients that
  register themselves instead of taking a pasted token.
