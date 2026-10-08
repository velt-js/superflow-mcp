# Superflow MCP

Talk to your [Superflow](https://usesuperflow.ai) comments from Claude Code, Claude Desktop, Cursor, claude.ai, ChatGPT or any MCP client.

Superflow is a visual feedback and AI review layer for websites. Your team, your clients and AI review agents leave comments pinned on live pages. With this MCP server your assistant can read that feedback, filter and count it, reply, resolve, triage in bulk, and draft client updates. It can also run the admin side: create a project for a new client, invite their reviewers, hand over the install snippet and check it, and manage statuses, tags and the team. And it can run the AI review agents (with a credit estimate first), schedule them, push findings to Jira, Asana, ClickUp or Monday, post to Slack, and send webhooks to your other systems. All without leaving the editor or the chat.

## Two ways to connect

| | Local package | Hosted server |
|---|---|---|
| What | `npx -y superflow-mcp`, runs on your machine over stdio | `https://mcp.usesuperflow.ai/mcp`, nothing to install |
| Auth | An API key in `SUPERFLOW_API_KEY` | OAuth, or the same API key as a bearer token |
| Tools | 84 tools: comments (read, filter, search, count, export, update, resolve, reply, bulk), admin (projects, pages, members, guests, statuses, tags, workspace, review links, notifications), and agents, runs, schedules, integrations and webhooks | Workspace, project, agent, analytics and team tools |
| Best for | Claude Code, Claude Desktop, Cursor | claude.ai, ChatGPT, the Claude API, any remote client |

You can use both at once.

## Quick start

You need an API key for the local package. See [Get an API key](#get-an-api-key).

### Claude Code (local)

```bash
claude mcp add superflow -e SUPERFLOW_API_KEY=sf_pat_... -- npx -y superflow-mcp
```

### Claude Desktop (local)

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "superflow": {
      "command": "npx",
      "args": ["-y", "superflow-mcp"],
      "env": {
        "SUPERFLOW_API_KEY": "sf_pat_..."
      }
    }
  }
}
```

### Cursor (local)

Add this to `~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "superflow": {
      "command": "npx",
      "args": ["-y", "superflow-mcp"],
      "env": {
        "SUPERFLOW_API_KEY": "sf_pat_..."
      }
    }
  }
}
```

### claude.ai (hosted, OAuth)

Go to **Settings > Connectors > Add custom connector** and paste:

```
https://mcp.usesuperflow.ai/mcp
```

Claude opens the Superflow consent screen. You pick the workspace and the permissions. No token is copied anywhere.

### ChatGPT (hosted)

Add a custom MCP connector in ChatGPT and use the same URL, `https://mcp.usesuperflow.ai/mcp`. ChatGPT runs the OAuth flow.

### Claude Code or Cursor with the hosted server

```bash
claude mcp add --transport http superflow \
  https://mcp.usesuperflow.ai/mcp \
  --header "Authorization: Bearer sf_pat_..."
```

For Cursor, see [`examples/cursor-mcp.json`](examples/cursor-mcp.json). For the Claude API, see [`examples/claude-api.json`](examples/claude-api.json).

More examples: [`examples/`](examples/).

## Get an API key

1. Open the Superflow portal and go to **Settings > Integrations > API keys**.
2. Check the workspace selector at the top. A key belongs to one workspace.
3. Create a key, give it a name (for example `Cursor on my laptop`), and pick the scopes for what the assistant should do:
   - Comments: `comments:read`, `comments:write` and `projects:read`.
   - Admin tools: `projects:write` (projects, pages, install checks, statuses, tags, review links),
     `users:invite` (invite members and guests), `users:write` (remove members and guests),
     `workspace:read` (workspace, credit usage, activity, your notification settings) and
     `workspace:write` (rename the workspace, change your notification settings).
   - Agents: `agents:read` (agents, packs, estimates, runs, schedules), `agents:write` (create,
     change and delete agents and packs) and `agents:run` (start runs and manage schedules; runs
     spend AI credits). Findings also need `comments:read`.
   - Integrations: `integrations:read` (connected tools) and `integrations:write` (connect
     links, default projects, push a comment to a tracker, post to Slack; pushing also needs
     `comments:read`).
   - Webhooks: `webhooks:read` and `webhooks:write`.

   Leave out the write scopes for a read-only key. A tool whose scope the key lacks answers with a clear forbidden error.
4. Pick an expiry, then copy the key. It is shown once. Superflow stores only a hash.

The same key works for the local package, the hosted server and the REST API. Revoke it on the same screen.

## Local package

### Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `SUPERFLOW_API_KEY` | yes | | Your API key (`sf_pat_...`). |
| `SUPERFLOW_API_BASE_URL` | no | `https://api.usesuperflow.ai/v1` | The API to call. Must be https (http only for localhost). |
| `SUPERFLOW_DEFAULT_PROJECT` | no | | Project used for bare comment numbers like `#4821` when you do not name one. |
| `SUPERFLOW_READ_ONLY` | no | `false` | `true` hides every write tool. |
| `SUPERFLOW_LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` or `silent`. Logs go to stderr. |

Requires Node.js 20 or later.

### Read-only mode

Set `SUPERFLOW_READ_ONLY=true` and the 51 write tools are not registered at all. The 33 read tools stay: the assistant can still read, filter, count and export, look up projects, guests, the workspace and credit usage, read agents, runs, findings, schedules, integrations and webhooks, estimate what a run would cost, and get a link to connect a tool (those two only read). The prompts still work and present changes as recommendations. For a hard guarantee, also use a key without the write scopes (`comments:write`, `projects:write`, `users:invite`, `users:write`, `workspace:write`, `agents:write`, `agents:run`, `integrations:write`, `webhooks:write`).

```bash
claude mcp add superflow -e SUPERFLOW_API_KEY=sf_pat_... -e SUPERFLOW_READ_ONLY=true -- npx -y superflow-mcp
```

### Tools

Full parameters and examples: [`docs/tools.md`](docs/tools.md).

#### Comments

| Tool | What it does |
|---|---|
| `superflow_get_me` | Who the key belongs to: member, workspace, plan, scopes. |
| `superflow_list_projects` | Projects (websites) with install status and open comment counts. |
| `superflow_list_pages` | Pages of a project with open and total comment counts. |
| `superflow_list_members` | Your team, plus a project's guests. |
| `superflow_list_statuses` | Workflow statuses in order, and which count as resolved. |
| `superflow_list_tags` | Tags and how often each is used. |
| `superflow_list_comments` | Find comments by project, page, status, assignee, tags, dates, text and more. |
| `superflow_get_comment` | One comment with every field and its replies. |
| `superflow_comment_stats` | Counts grouped by page, status, assignee, week and more, plus response times. |
| `superflow_export_comments` | Export matching comments as csv, json or markdown. |
| `superflow_create_comment` | Leave a new, public comment on a page. |
| `superflow_update_comment` | Change one comment: text, priority, status, assignee, tags, page or pin. |
| `superflow_resolve_comment` | Resolve one comment, with an optional note. |
| `superflow_reopen_comment` | Reopen one comment, with an optional note. |
| `superflow_add_reply` | Reply in a thread, with @mentions. |
| `superflow_update_reply` | Edit a reply. |
| `superflow_delete_reply` | Delete a reply (needs confirm). |
| `superflow_delete_comment` | Delete a comment thread (needs confirm, restorable). |
| `superflow_restore_comment` | Restore a deleted comment. |
| `superflow_bulk_update_comments` | Change up to 200 comments at once (dry run first, then confirm). |
| `superflow_add_attachment` | Attach a file by URL to a comment or reply. |

#### Admin

| Tool | What it does |
|---|---|
| `superflow_get_project` | One project: install status, counts, statuses and settings. |
| `superflow_create_project` | Create a project for a site, optionally inviting guests (sends email). |
| `superflow_update_project` | Rename, change settings (guest comments, toolbar, commenting) or add domains. |
| `superflow_archive_project` | Archive a project. Nothing is deleted. |
| `superflow_unarchive_project` | Bring an archived project back. |
| `superflow_delete_project` | Delete a project for good, with its comments (needs confirm). |
| `superflow_get_install_snippet` | The script tag and install steps for the site's platform. |
| `superflow_verify_install` | Check that the snippet is live on the site. |
| `superflow_get_page` | One page with its comment counts. |
| `superflow_add_page` | Add a page before anyone comments on it. |
| `superflow_remove_page` | Remove a page and delete its comments, restorable for 30 days (needs confirm). |
| `superflow_invite_member` | Invite teammates to the workspace (sends email). |
| `superflow_remove_member` | Remove a teammate, optionally reassigning their open comments (owner only, needs confirm). |
| `superflow_list_guests` | A project's guests. |
| `superflow_invite_guest` | Invite clients or reviewers to one project (sends email). |
| `superflow_remove_guest` | Take a guest off one project (needs confirm). |
| `superflow_create_status` | Add a custom status, for the workspace or one project. |
| `superflow_update_status` | Rename or recolor a status. |
| `superflow_reorder_statuses` | Set the order of the statuses. |
| `superflow_delete_status` | Delete a status, moving its comments to another (needs confirm). |
| `superflow_create_tag` | Create a tag. |
| `superflow_update_tag` | Rename or recolor a tag. |
| `superflow_delete_tag` | Delete a tag from every comment (needs confirm). |
| `superflow_merge_tags` | Fold one tag into another (needs confirm). |
| `superflow_get_organization` | The workspace: plan, seats, projects and AI credits. |
| `superflow_update_organization` | Rename the workspace (owner only). |
| `superflow_get_credit_usage` | AI credits used, by project, agent or day. |
| `superflow_list_activity` | Changes made through the API, newest first. |
| `superflow_list_review_links` | Active public review links. |
| `superflow_create_review_link` | Share a project with a public review link (Velt-internal accounts only for now). |
| `superflow_revoke_review_link` | Turn a review link off (needs confirm). |
| `superflow_get_notification_settings` | Your own digest, inbox and email settings. |
| `superflow_update_notification_settings` | Change your own notification settings. |

#### Agents, runs and schedules

| Tool | What it does |
|---|---|
| `superflow_list_agents` | AI review agents, built-in and custom, and which run by default. |
| `superflow_get_agent` | One agent, with a custom agent's instructions. |
| `superflow_create_agent` | Create a custom agent from plain-language instructions. |
| `superflow_update_agent` | Turn an agent on or off, or edit a custom agent. |
| `superflow_delete_agent` | Delete a custom agent (needs confirm). |
| `superflow_duplicate_agent` | Copy a custom agent. |
| `superflow_list_agent_packs` | Agent packs, such as Copy QA, SEO or your own. |
| `superflow_create_agent_pack` | Group agents into a pack. |
| `superflow_update_agent_pack` | Change a pack, or make it the default for runs. |
| `superflow_estimate_run` | What a run would cost in AI credits, and whether the balance covers it. Charges nothing. |
| `superflow_run_agents` | Start a run on a site, a page or a list of pages (spends credits; estimate first, then confirm). |
| `superflow_get_run` | A run's live status per agent. |
| `superflow_list_runs` | Past runs, newest first. |
| `superflow_list_findings` | What a run found, with severity and confidence. |
| `superflow_set_schedule` | Create or change a scheduled run (cron, at most hourly; each run spends credits). |
| `superflow_list_schedules` | Scheduled runs, the next run and how the last one went. |
| `superflow_delete_schedule` | Delete a schedule (needs confirm). |

#### Integrations

| Tool | What it does |
|---|---|
| `superflow_list_integrations` | Connected tools: Slack, Jira, Asana, ClickUp, Monday. |
| `superflow_get_integration` | One connection and its default project. |
| `superflow_connect_integration` | A link the user opens to connect a tool. The assistant cannot finish the sign-in. |
| `superflow_update_integration` | Set a connection's default project. |
| `superflow_push_comment` | Create a Jira issue or a task from a comment, and link it on the comment. |
| `superflow_post_to_slack` | Post a message, with comments, to a Slack channel (needs confirm). |

#### Webhooks

| Tool | What it does |
|---|---|
| `superflow_list_webhooks` | Webhook endpoints, their events and the last delivery. |
| `superflow_get_webhook` | One endpoint. |
| `superflow_create_webhook` | Add an endpoint. Shows the signing secret once. |
| `superflow_update_webhook` | Change an endpoint's URL, events or project, or pause it. |
| `superflow_delete_webhook` | Delete an endpoint (needs confirm). |
| `superflow_test_webhook` | Send a signed ping. |
| `superflow_list_webhook_deliveries` | The last 100 deliveries to an endpoint. |

How to receive and verify webhook events: [`docs/webhooks.md`](docs/webhooks.md).

Superflow has three priorities you can set: critical (P0), high (P1) and medium (P2). Removing an assignee or clearing a priority is not supported yet, so the assistant will ask you to do that in the Superflow toolbar. Filters can still find `low` and `none` priority comments and `unassigned` ones.

Every id parameter also takes a name, a site URL, an email or a comment number. The API resolves it. When a name matches more than one thing, the tool returns the candidates so the assistant can ask you which one.

Some admin changes are not available: a project's site URL cannot change (add extra domains instead), members have no roles beyond owner and admin, and review links have no expiry. Deleting a project is permanent. While a project has an active review link it is in preview: archiving, install checks and settings changes wait until the link is revoked. Site, domain and page addresses are full `https://` URLs.

Some agent and integration features are not available yet: a run cannot be cancelled once started, schedules run on a cron (not when a page changes), and disconnecting a tool happens in the Superflow portal. Run prices are exact in scan pricing and an estimate in flat pricing; workspaces billed by model usage cannot be priced in advance. Webhooks cover changes made through the API, this server and agent runs, not yet comments made in the Superflow toolbar.

The server also ships eight prompts (`triage`, `stale_threads`, `client_update`, `agent_findings_review`, `find_duplicates`, `launch_checklist`, `onboard_client`, `prelaunch_run`) and six resources (`superflow://projects`, `superflow://projects/{project}`, `superflow://projects/{project}/comments`, `superflow://comments/{comment}`, `superflow://organization`, `superflow://runs/{run}`).

### Example prompts

1. Show me open comments on usesuperflow.ai/pricing.
2. How many unresolved comments per page on the Acme project?
3. Which comments from guests have had no reply from us in 3 days?
4. Resolve everything tagged `copy` on the homepage.
5. Assign all high priority mobile comments on Acme to Jen.
6. What did the agents find in the last run? Which ones look like false positives?
7. Reply to comment 4821: fixed, please check.
8. Draft a client update for Acme covering what was closed this week.
9. Export every resolved comment on Acme from last week as a CSV.
10. What is our median time to first reply on client comments, week by week?
11. Create a project for client Northwind at northwind-dental.com on Webflow, invite dana@northwind-dental.com, and give me the install snippet.
12. Is the Superflow snippet live on acme.com yet?
13. How many member seats do we have left, and which agent used the most AI credits this month?
14. Merge the tag "Copy text" into "copy" on Acme, then add an "In review" status.
15. Estimate a full run of the Pre-Launch pack on Acme, then run it.
16. What did the agents find in the last run on Acme? Group it by severity and push the critical ones to Jira.
17. Run the Pre-Launch pack on Acme every Monday at 9am Berlin time.
18. Post the open critical comments on Acme to our #design-feedback Slack channel.
19. Send a webhook to https://hooks.example.com/superflow whenever a comment is resolved.

More in [`examples/prompts.md`](examples/prompts.md).

### Safety

- Deletes, removals, tag merges and review link revokes need `confirm: true`. Without it the tool only reads and shows what would happen. Deleting a project is permanent; removed pages' comments can be restored for 30 days.
- Invite tools (and guests on a new project) send real email. The assistant is told to ask you first.
- A review link makes a project visible to anyone who has the link.
- Agent runs spend AI credits. The assistant prices the run with `superflow_estimate_run`, shows you the credits and asks; `superflow_run_agents` starts nothing without `confirm: true`. When the balance is too low it tells you how to add credits and does not retry.
- Pushing a comment creates a real issue or task in your Jira, Asana, ClickUp or Monday, and a Slack post is seen by everyone in the channel. The assistant asks first, and a Slack post needs `confirm: true`.
- A new webhook's signing secret is shown once. Store it right away.
- Bulk updates are a dry run by default: it says how many comments would change and how many already match. A real run needs `dry_run: false` and `confirm: true`. The tool descriptions tell the assistant to ask you first.
- Comment text comes from website visitors. Results that contain it carry a notice telling the model to treat it as data, not instructions.
- The key is only ever sent as the bearer token to the Superflow API, and it is never logged. See [SECURITY.md](SECURITY.md).

## Hosted server

The hosted server lives at `https://mcp.usesuperflow.ai/mcp`. It speaks Streamable HTTP and accepts OAuth 2.1 (with dynamic client registration) or an API key as a bearer token. A client only sees the tools its scopes allow.

### Hosted tools

| Area | Tool | Scope | What it does |
|---|---|---|---|
| Workspace | `list_workspaces` | `workspace:read` | Every workspace you belong to, marking the one this token is bound to. |
| Workspace | `get_workspace` | `workspace:read` | Plan, feature access, usage counters and AI credit balance. |
| Projects | `list_projects` | `projects:read` | Projects (websites), most recent activity first. |
| Projects | `get_project` | `projects:read` | One project: name, URL, status, category, versions, install platform. |
| Projects | `get_install_snippet` | `projects:read` | The script tag to paste into a site. |
| Projects | `create_web_project` | `projects:write` | Create a website project for a URL. |
| Projects | `verify_installation` | `projects:write` | Check whether the snippet is live on the site and mark it installed. |
| Projects | `update_project_status` | `projects:write` | Set a project's status, for example archive it. |
| Agents | `list_agents` | `agents:read` | Review agents in the workspace, plus their groups. |
| Agents | `get_agent_run` | `agents:read` | Status and findings of one run. Poll every 15 to 30 seconds after `run_agents`. |
| Agents | `list_agent_runs` | `agents:read` | Past runs, newest first, by project, agent or both. |
| Agents | `create_agent` | `agents:write` | Create a custom review agent from plain-language instructions. |
| Agents | `run_agents` | `agents:run` | Start one run per agent against a page. Uses AI credits. |
| Comments | `list_comments` | `comments:read` | Comments on a project, from people and agents. |
| Comments | `get_agent_findings` | `comments:read` | The comments an agent left, optionally for one run. |
| Analytics | `get_team_analytics` | `analytics:read` | Comment, resolution and project activity for a lookback window. |
| Analytics | `get_people_analytics` | `analytics:read` | Per-person activity: who commented, who resolved, who is idle. |
| Analytics | `get_past_data_analytics` | `analytics:read` | All-time counts, most active projects and people. |
| Team | `invite_team_member` | `users:invite` | Invite people to the workspace with access to every project. |
| Team | `invite_guest` | `users:invite` | Invite people to a single project only. |

Invites send real email. Both invite tools cap at 10 recipients per call, remove duplicates, and take the inviter from your grant, never from model input.

### Try it with no account

Two tools work with no token, at `https://mcp.usesuperflow.ai/mcp/try`:

```json
{
  "mcpServers": {
    "superflow-try": {
      "url": "https://mcp.usesuperflow.ai/mcp/try"
    }
  }
}
```

| Tool | What it does |
|---|---|
| `run_site_preview` | Start a free Superflow review of any public URL. |
| `get_site_preview` | Poll it and read the findings once the agents finish. |

The authenticated endpoint never serves these two, and this endpoint never serves anything else.

### Scopes

| Scope | Grants |
|---|---|
| `workspace:read` | Read workspace plan, features and usage. With the local package and REST API also: AI credit usage, the API activity log and your own notification settings. |
| `projects:read` | Read projects, pages, members and install snippets. |
| `projects:write` | Create projects, verify installs, set status. With the local package and REST API also: update, archive and delete projects, add and remove pages, and manage statuses, tags and review links. |
| `agents:read` | Read agents and their run history. With the local package and REST API also: packs, run estimates, findings and schedules. |
| `agents:run` | Start agent runs (uses AI credits). With the local package and REST API also: manage schedules. |
| `agents:write` | Create agents. With the local package and REST API also: change, copy and delete agents, and manage packs. |
| `comments:read` | Read comments, replies, statuses, tags and agent findings. |
| `comments:write` | Create, update, resolve, reply to and delete comments (local package and REST API). |
| `analytics:read` | Read team, people and all-time analytics. |
| `users:invite` | Send workspace and project invitations, and post as a project guest. |
| `users:write` | Remove members and guests (local package and REST API). |
| `workspace:write` | Rename the workspace and change your own notification settings (local package and REST API). |
| `integrations:read` | Read connected tools (local package and REST API). |
| `integrations:write` | Get connect links, set default projects, push comments to a tracker and post to Slack (local package and REST API). |
| `webhooks:read` | Read webhook endpoints and deliveries (local package and REST API). |
| `webhooks:write` | Create, change, test and delete webhook endpoints (local package and REST API). |

## Migrating from BugHerd

See [`docs/migrating-from-bugherd.md`](docs/migrating-from-bugherd.md) for how BugHerd terms and endpoints map to Superflow tools.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `pnpm install`, `pnpm test`, `pnpm build`, `pnpm check:drift`.

The integration suite (`test/integration/`) runs against a real API when `SUPERFLOW_TEST_API_KEY` and `SUPERFLOW_TEST_PROJECT` are set. It works inside an existing project. The admin tools can now create and delete a throwaway project, but the suite does not do that yet.

## Support

- Issues and feature requests: [open an issue](https://github.com/velt-js/superflow-mcp/issues)
- Email: eng@usesuperflow.com
- Security: see [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE)
