# Changelog

All notable changes to the Superflow MCP servers are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There are two release lines: the `superflow-mcp` npm package (local stdio server,
versions 0.x) and the hosted server at `https://mcp.usesuperflow.ai/mcp`
(versions 1.x).

## [0.4.0] - Unreleased

The MCP spec addendum (v2.1): agent findings by kind, playbooks the server serves,
pushing your own agent's findings in, signing in without a key, and the checks of the
Checks Engine. Built on what the API serves today; report and billing-mode tools follow
when their engines ship.

### Added
- `superflow_list_comments` takes `rule_key` (the kind of problem, for example `image-alt`
  or `link-broken`). Rows carry `rule_key` and the agent's `suggested_fix`.
- `superflow_update_comment` takes `rule_key` to attach a human comment to a check
  (`null` detaches it).
- Checks (105 tools): `superflow_list_failing_checks`, `superflow_get_check_details`,
  `superflow_get_site_score`, `superflow_get_finding_source`, `superflow_mark_check_fixed`,
  `superflow_exclude_check`, `superflow_include_check`, `superflow_assign_check_owner`,
  `superflow_reject_comment`, `superflow_get_check_settings` and
  `superflow_set_default_owners`, over the new `/v1/projects/{project}/checks`, `/score`,
  `/check-settings` and `/v1/comments/{comment}/reject` and `/source` routes. Marking a check
  fixed and excluding one gate on `confirm: true` and preview without it.
- `superflow_resolve_comment` and `superflow_update_comment` say when resolving an agent
  finding queued its verify rescan (`verify` in the result).
- API errors carry `reason` (for example `already_verified`) when the API names one.
- `superflow_use_playbook` (85 tools): step-by-step plans the server serves, built from
  `skills/<name>/SKILL.md` by `pnpm playbooks`. `triage` builds one ordered P0, P1, P2 fix
  list from agent findings and human comments; `fix` fixes the approved items (one subagent
  per item in Claude Code, up to 3 at a time), verifies each with a rescan, and reports.
- The `fix` prompt, and the server instructions point to the playbooks.
- `superflow_comment_stats` takes `group_by: "rule_key"`.
- `superflow_import_findings` (86 tools, scope `ingest`): push the findings of your own
  review into Superflow as agent comments under your agent's name. Creates or merges (only
  into your own earlier imports of the same finding, never into Superflow's), never
  deletes; one invalid finding refuses the batch and every problem comes back in
  `error.issues`. The `push_my_review` playbook and prompt walk through it, and report the
  merges the same way.
- API errors carry `issues` (every validation problem) through to the tool result.
- Billing (94 tools): `superflow_get_billing` and `superflow_get_payment_link` over the new
  read-only `GET /v1/billing`. Paying happens in the Superflow portal; the link never
  suggests a second subscription, and a failed subscription check says so.
- API key tools (92 tools): `superflow_list_api_keys`, `superflow_create_api_key` and
  `superflow_revoke_api_key` over the new `/v1/api-keys` routes. Create and revoke gate on
  `confirm: true`; a new key's scopes are a subset of the current key's.
- `npx superflow-mcp login`: sign in (or sign up) in the browser instead of pasting a key.
  OAuth 2.1 with dynamic client registration and PKCE on a loopback redirect; the sign-in is
  saved in the macOS Keychain, the Linux Secret Service, or a file only you can read, and
  the access token is renewed while the server runs (one retry after a 401).
  `npx superflow-mcp logout` revokes and removes it. `SUPERFLOW_API_KEY` still wins.
- Analytics (89 tools): `superflow_get_team_analytics`, `superflow_get_people_analytics`,
  `superflow_get_all_time_analytics`, over the new `/v1/analytics` routes. A stale rollup is
  reported as unavailable, never as zero activity.
- A library entry, `superflow-mcp/server` (ESM and CommonJS): `createServer`, `ApiClient`,
  `OPENAPI_SHA256`, `PLAYBOOKS`, `TOOL_NAMES`, `VERSION`. `createServer` takes `surface`
  (`hosted` drops every SUPERFLOW_ variable from the wording), `renamedTools` and
  `onToolCall`. The hosted server at mcp.usesuperflow.ai uses it to serve these same tools,
  so one tool set serves both. `pnpm smoke:lib` checks the CommonJS build in CI.
- Gemini CLI setup in the README and `examples/gemini-settings.json`. Tested with Gemini
  CLI 0.65.0: all 105 tools load, and a tool call reaches the API.
- Site settings (110 tools): `superflow_get_site_monitoring`, `superflow_set_site_mode`
  (care runs the agents on a schedule and spends credits, so it gates on `confirm: true`;
  watch does not), `superflow_set_site_timezone`, `superflow_list_forms` and
  `superflow_set_form_testing` (turning a test on gates on `confirm: true`, because each test
  lands in the client's inbox as a lead), over the new `/v1/projects/{project}/monitoring`
  and `/forms` routes. Billing for care follows with the pricing engine.
- The `onboard_agency` playbook and prompt: from a fresh sign-in to a client site checked on a
  schedule in the client's time zone, with its first results. It stops for payment only at
  the checkout link, and turns care on only after the user agrees to the credits.
  `superflow_get_site_monitoring` reports `active_run`, which it waits on.
- `superflow_get_invoices` (111 tools): the workspace's invoices, newest first, with Stripe's
  links to view, pay or download each, over the new read-only `GET /v1/billing/invoices`.
  Owner only.

### Changed
- `npx superflow-mcp` is now a bridge to the hosted server. It speaks stdio to the MCP
  client and forwards every request (initialize info, tools, prompts, resources and
  templates, completions, list_changed notifications) to `https://mcp.usesuperflow.ai/mcp`
  over Streamable HTTP, with `SUPERFLOW_API_KEY` or the saved `login` sign-in as the bearer
  token. The tools run on the hosted server, so the package and the hosted connector are one
  server; results and errors pass through unchanged. `SUPERFLOW_MCP_URL` picks the
  endpoint (https, http only for localhost; a saved sign-in defaults to the server it
  signed in with; staging is `https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app/mcp`).
  A sign-in is renewed before it expires and once more after a 401, then the request goes
  again once; a refused key or sign-in says to check the key or run `login`. A tool call is
  never sent twice and may take 150 seconds; lists and reads go again once after a network
  failure or a 5xx (cold starts). `SUPERFLOW_READ_ONLY` filters the tool list and refuses
  write tools on the machine, and the bridge sends `X-Superflow-Read-Only: true` for the
  hosted server to use. Every request names the package (`User-Agent` and
  `X-Superflow-Client: superflow-mcp/<version>`). The client configs do not change, and the
  library entry (`superflow-mcp/server`) the hosted server runs is unchanged.
- `SUPERFLOW_API_BASE_URL` is for development only: when set, the tools run in the CLI
  process against that REST API (direct mode), as every version before this one did, and
  the server says so on stderr at start. The REST API moved into the MCP function, which
  now serves `/mcp`, OAuth and `/v1`: the default API base (direct mode, and what `login`
  saves) is `https://mcp.usesuperflow.ai/v1`, staging
  `https://superflowmcphandler-4mfhcuyw2q-uc.a.run.app/v1`. `pnpm smoke:stdio` runs in direct mode; the e2e
  suite covers both modes.
- `login` reads who signed in (`superflow_get_me`) through the hosted server.
- The `triage` prompt follows the triage playbook, which now builds its list from the
  failing checks and attaches human comments to them. The `fix` playbook marks checks fixed
  and reads the check until the rescan decides, instead of running the agents again. The
  playbooks write with the new check tools.
- Rule keys are the Checks Engine's names (`link-broken`, `image-alt`, `mobile-overflow`).
  The old names (`broken-link`, `alt-text`) are still accepted for one release.
- Every request sends `X-Superflow-Client`, so the API's audit log records the package's
  writes as made by the MCP.
- `superflow_run_agents`: the API allows 10 runs per project per hour and answers
  `rate_limited` past that.
- `npx superflow-mcp login` always asks for a scope list: every API scope except
  `users:invite`, `users:write`, `workspace:write` and `users:read`, which you name with
  `--scope`. `--scope` replaces the list (spaces or commas); `login --help` shows both lists.
- `superflow_reject_comment` is destructive and gates on `confirm: true`: without it the tool
  shows the finding and the reason. A person's comment is refused before asking.
- `superflow_set_schedule` gates on `confirm: true` when it creates a schedule or changes what
  or when it runs: without it the tool prices one run and shows it. Pausing and moving the
  time zone need no confirm.
- No description Example carries `confirm: true` or `dry_run: false`, so a copied Example
  only previews. Every description names a sibling tool.
- A write that may still have run (a timeout, a dropped connection, a 5xx after the retries)
  returns `error.idempotency_key` and says to retry with it; the create tools take it as an
  input. A 429 whose Retry-After is past 10 seconds is not retried: it returns
  `rate_limited` with `error.reset_at`.
- A 401 on a sign-in says the sign-in expired or was revoked and to run `login`; a 403 says
  scopes cannot be changed and how to get a key or a sign-in with the scope.
- The server instructions name only registered tools, so read-only mode names no write tool.
- The API keeps no storage of its own and reuses what Velt and Superflow already store
  (snippyly/shared-firebase-function#4355, 2026-11-03; `openapi/openapi.json` has 106
  operations). What that changes here:
  - Comments have no numbers. A comment is given by its id (`cmt_...`) or its link (its
    `url`); `#4821` and bare numbers are no longer references. A link with `scommentId` is
    read here and sent as `cmt_<id>`, so the path carries an id, not an encoded URL.
    `number` is gone from every comment shape, `sort: "number"` is gone, and the CSV export
    has no number column. The `project` of a comment tool is optional and only narrows the
    lookup.
  - Deletes are permanent. `superflow_delete_comment` and `superflow_remove_page` say so in
    their descriptions, previews and results, and their confirm messages no longer offer a
    restore.
  - Tags are workspace-wide and live on the comments. Putting a new name on a comment creates
    the tag: `tags` and `add_tags` (create, update and bulk) take a name, a `tag_` id of a tag
    already on the comment, or `{ "name", "color" }`, whose color applies to that comment's
    copy only (one tag can show two colors). Tags are visible to everyone who can see the
    comment, clients and review-link viewers included; the tag inputs, `superflow_update_tag`,
    `superflow_merge_tags` and the README say not to put private notes in them.
    `superflow_list_tags` counts the tags on the comments it scanned and says when the scan
    stopped early.
  - `superflow_update_tag`, `superflow_delete_tag` and `superflow_merge_tags` rewrite the
    comments that carry the tag, at most 500 a call, and take `cursor`: each answer reports
    `failed`, `complete`, `scan` and `next_cursor`, and the next call passes that
    `next_cursor` on. A null `next_cursor` ends the job. Comments in `failed` stay behind: the
    tools offer one more call without a cursor to retry them, and when a call changes nothing
    (Velt's 1,000-comment update window) they say to tell the user and stop, so a retry
    cannot loop. When the API's own tag scan stops before it finds the tag, its `not_found`
    carries `scan` and `next_cursor` (on every API error now, as `error.scan` and
    `error.next_cursor`), and the tools say how to look further. A recolor or a change of letter case goes on with the cursor; a
    real rename that stopped early is finished with a merge into the new name.
    `superflow_merge_tags` can merge into a new name. `superflow_delete_tag` and
    `superflow_merge_tags` take no `project` and act in every project, as their previews say;
    the previews read the workspace's tags, say when that scan stopped early (the tag may be
    on comments it did not read, and a not found says so too), and the confirmed call sends
    the caller's reference without reading them again. The three descriptions and the confirm
    messages say that rewritten comments show as just updated (the default sort,
    `updated_after` and `stale_days`). The rewrites get 90 seconds and the tag lists 60.
  - `superflow_list_runs` lists every run of the workspace, the portal's and Always-on
    Monitoring's included, with its `trigger` (`manual`, `workflow` for a schedule, `api`,
    `mcp`, and the monitoring triggers). `superflow_list_findings` takes any of them, the run
    id on an agent comment and an import's `run_id`. An import is not a run:
    `superflow_list_runs` and `superflow_get_run` do not show it. Run summaries name the
    trigger. An agent whose record is gone reads `missing` (final, `agent` null) and the
    summary counts it; `credits_charged` is 0 once a charge was refunded or failed; runs of a
    deleted project are not listed and read as not found. The `agent_findings_review` and read-only `prelaunch_run` prompts read the latest
    finished run with a `status` filter, follow `next_cursor` past empty pages (at most 5),
    prefer a site run that is not a resolve, uptime or change rescan, tell the user the
    trigger of the run they picked and offer the other choice when the newest run is a small
    rescan. They no longer fall back to agent comments or failing checks.
  - A schedule's agents are fixed when it is saved (`agents` is always a list; `pack` says
    where they came from), and `last_run.status` says how the newest run went: `started`,
    `in_progress`, `failed_to_start`, or `skipped_insufficient_credits`,
    `skipped_no_changes`, `skipped_creator_removed` or `skipped_no_agents`. Its runs have
    trigger `workflow`. A schedule with no agents left reads "no agents (turned off)", and
    `superflow_list_schedules` says when the API's schedule scan (10,000 definitions) stopped
    early. The
    change preview of `superflow_set_schedule` prices a pack schedule with its pack alone and
    says that saving takes the agents again (a pack's current members, or today's default
    agents), and `superflow_delete_agent`'s preview counts every schedule that runs the agent,
    through a pack or the default agents too.
  - `superflow_push_comment` needs `project_key` (a connection has no default project) and
    sends `project` when given. A comment holds one item per tool: a second push returns the
    existing link with `already_linked: true` and creates nothing.
  - Runs and estimates that name no agents and no pack use Superflow's default agents; a
    pack can no longer be the default for runs.

### Removed
- The seven webhook tools (`superflow_list_webhooks`, `superflow_get_webhook`,
  `superflow_create_webhook`, `superflow_update_webhook`, `superflow_delete_webhook`,
  `superflow_test_webhook`, `superflow_list_webhook_deliveries`), `docs/webhooks.md` and the
  `webhooks:read` and `webhooks:write` scopes. The first release ships without webhooks; they
  come later on the platform's own webhooks. 104 tools, 45 of them read-only.
- `superflow_restore_comment`, `superflow_create_tag` and `superflow_update_integration`,
  with the API routes they called (`restoreComment`, `createTag`, `updateIntegration`):
  deletes are permanent, a tag is created by assigning it, and a connection has no settings.
  `superflow_update_agent_pack` lost `is_default_for_runs`, an integration lost
  `settings.default_project` and a tag lost `project_id`. `SUPERFLOW_DEFAULT_PROJECT` is
  gone: it only served comment numbers. When it is still set, the server logs one warning
  at start that it is no longer used. 101 tools: 45 read, 56 write; read-only mode
  registers the 45.

### Fixed
- A sign-in that `login` saved to the file because the keyring refused it is now found on
  the next start, and `logout` removes it.
- Several MCP processes can share one sign-in: when the server refuses a refresh token
  that another process already rotated, the server reads the newer sign-in from the store
  instead of ending it.
- `pnpm playbooks` works on Windows.
- The macOS Keychain write sent the sign-in's tokens as a `security` argument, visible to
  every process list. It now goes through stdin (`security -i`); a session too long for one
  command goes to the file instead.
- A refreshed sign-in the keyring refused went to the file, but the next start read the
  stale keyring copy. The store now keeps the one that expires later and drops the other.
  The credentials file is replaced in one step (temp file and rename), and a signed-out
  server picks up a new sign-in from the store without a restart.
- Logs redact the session's current tokens after a refresh, not only the ones it started with.
- `login` on Windows opened the sign-in URL cut at its first `&`; it now opens it whole.
- `superflow_set_site_mode` and `superflow_set_form_testing` no longer add `confirm` or
  `accept_test_leads` themselves when care or the test is already on: the same settings
  change nothing and say so.
- `superflow_remove_member`'s description says the preview comes from the API.
- The logout message and README name where sign-ins are revoked: Settings > Integrations >
  API keys > Connected AI apps.
- `onboard_agency` stops before setting the time zone; `triage` lists its own project's
  human comments.
- `superflow_create_api_key`'s preview reads the calling key (`GET /me`) first and returns
  the API's refusal instead of a preview when the key cannot be created: a sign-in, no
  `workspace:write`, a scope the key does not have, or an expiry past the key's own.
- A 401 gives its advice once: the API's create-key hint is no longer added to the
  package's own message, and a sign-in is never told to create a key.
- A sign-in refused for creating a key is no longer told to sign in again with more scopes.

## [0.3.0] - Unreleased

Agents, integrations and webhooks (Phase 3): run the AI review agents, send their
findings where your team works, and connect Superflow to other systems.


### Tests
- `pnpm test:e2e`: the built package over real stdio against a local fake API, in CI on
  every pull request and every push to staging and main. It checks the handshake, that the
  bundle registers exactly the source's tools, every tool's metadata and Example, that every
  tool answers its Example (and an empty or HTML upstream) with a well-formed result, that no
  gated tool writes without `confirm: true` while it does with it, read-only mode, error
  mapping and retries, idempotency keys on retried creates, that logs never carry the key or
  comment text, that stdout carries only protocol messages, and startup refusals. Every
  request is checked against the OpenAPI snapshot.
- `pnpm test:live` and `.github/workflows/live.yml`: the built package against the real API
  on every push to staging and main: core reads, every read tool that needs at most a
  project, cursor paging, a tag lifecycle with its confirmation gate, a bulk dry run, a wrong
  key and read-only mode. With the secrets set, a skipped suite fails the run.
### Added
- 30 tools, 84 in total:
  - Agents: `superflow_list_agents`, `superflow_get_agent`, `superflow_create_agent`,
    `superflow_update_agent`, `superflow_delete_agent`, `superflow_duplicate_agent`,
    `superflow_list_agent_packs`, `superflow_create_agent_pack`,
    `superflow_update_agent_pack`.
  - Runs: `superflow_estimate_run`, `superflow_run_agents`, `superflow_get_run`,
    `superflow_list_runs`, `superflow_list_findings`.
  - Schedules: `superflow_set_schedule`, `superflow_list_schedules`,
    `superflow_delete_schedule`.
  - Integrations: `superflow_list_integrations`, `superflow_get_integration`,
    `superflow_connect_integration`, `superflow_update_integration`,
    `superflow_push_comment`, `superflow_post_to_slack`.
  - Webhooks: `superflow_list_webhooks`, `superflow_get_webhook`,
    `superflow_create_webhook`, `superflow_update_webhook`, `superflow_delete_webhook`,
    `superflow_test_webhook`, `superflow_list_webhook_deliveries`.
- Runs spend AI credits, so `superflow_run_agents` asks for an estimate first: without
  `confirm: true` it returns the estimate (credits, pages, agents, balance) as a preview
  and starts nothing. When the balance is too low it says so, points to Settings >
  Billing, and does not retry. `superflow_get_run` names the finished statuses
  (`done`, `failed`, `partial`) and asks for at most one check every 20 seconds.
- Confirm gates on `superflow_delete_agent`, `superflow_delete_schedule`,
  `superflow_delete_webhook` and `superflow_post_to_slack`: without `confirm: true` they
  only read and return a preview.
- `superflow_create_webhook` returns the signing secret once and says to store it.
  [`docs/webhooks.md`](docs/webhooks.md) lists the events and the payload and shows how
  to verify the Svix signature in Node.
- `superflow_push_comment` creates a Jira issue or an Asana, ClickUp or Monday task from
  a comment and saves the link on the comment, so `external_links` and the
  `has_external_link` filter now work. Targets are ids: Jira `KEY:12345`, Asana
  `<workspace gid>:<project gid>`, ClickUp `<team>:<space>:<list>`, Monday `<board id>`.
  `superflow_connect_integration` returns a link the user opens to connect a tool.
- The `prelaunch_run` prompt: estimate, ask, run, follow the run, summarize the findings
  by severity, and offer to push the critical ones to Jira. `agent_findings_review` now
  reads runs and findings, and picks the latest finished run when none is given.
- The `superflow://runs/{run}` resource.
- New scopes: `integrations:read`, `integrations:write`, `webhooks:read`,
  `webhooks:write`. The agent tools use `agents:read`, `agents:write` and `agents:run`.
- Read-only mode keeps the 33 read tools, including `superflow_estimate_run` and
  `superflow_connect_integration`, which only read.

### Not yet
- Cancelling a run (the engine has no way to stop one), schedules that run when a page
  changes, and disconnecting a tool (use the Superflow portal).
- Webhooks for comments made in the Superflow toolbar or changes made in the portal, and
  for bulk updates, restores, project deletes and guest removals. Events cover single
  changes through the API and this server, and agent runs.
- Exact prices outside scan pricing: flat pricing is an estimate, and workspaces billed
  by model usage cannot be priced in advance.

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
