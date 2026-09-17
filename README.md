# Superflow MCP Server

Connect Claude, Cursor, or any MCP client to your [Superflow](https://usesuperflow.ai) workspace.

Superflow is a visual collaboration and AI review layer for websites — your team leaves comments directly on live pages, and AI review agents scan pages and file findings automatically. This MCP server brings that into your editor and your assistant: read the feedback sitting on a page, run review agents against a URL, and manage projects without switching tabs.

This is a **remote MCP server**. There is nothing to install or self-host — you point your client at a URL and authorize it.

```
https://mcp.usesuperflow.ai/mcp
```

---

## Quick start

### Cursor

Add to `~/.cursor/mcp.json` (or project-local `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "superflow": {
      "url": "https://mcp.usesuperflow.ai/mcp",
      "headers": {
        "Authorization": "Bearer sf_pat_YOUR_TOKEN"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http superflow \
  https://mcp.usesuperflow.ai/mcp \
  --header "Authorization: Bearer sf_pat_YOUR_TOKEN"
```

### Claude.ai / Claude Desktop (OAuth, no token to paste)

**Settings → Connectors → Add custom connector**, then paste:

```
https://mcp.usesuperflow.ai/mcp
```

Claude registers itself, opens the Superflow consent screen in your browser, and you pick the workspace and the permissions to grant. No token is copied anywhere.

### Claude API

See [`examples/claude-api.json`](examples/claude-api.json).

---

## Getting a token

1. Open the Superflow portal → **Settings → Integrations → Connected apps**.
2. Check the workspace selector at the top — tokens are bound to one workspace.
3. **Create token**, name it (e.g. `Cursor on my laptop`), tick the permissions you want, pick an expiry (never / 30 days / 90 days).
4. Copy it immediately. The raw token is shown exactly once; Superflow stores only a hash of it and cannot recover it.

Every token appears in that list with its scopes, created / last-used / expiry dates, and a **Revoke** button.

You do not need a token to try the server — see [Try it with no account](#try-it-with-no-account).

---

## Tools

### Workspace

| Tool | Scope | Description |
|---|---|---|
| `list_workspaces` | `workspace:read` | Every workspace you belong to, marking the one this token is bound to |
| `get_workspace` | `workspace:read` | Plan, feature access, usage counters, and AI credit balance |

### Projects

| Tool | Scope | Description |
|---|---|---|
| `list_projects` | `projects:read` | Projects (websites) in the workspace, most recent activity first |
| `get_project` | `projects:read` | One project: name, URL, status, category, versions, install platform |
| `get_install_snippet` | `projects:read` | The exact script tag to paste into a site |
| `create_web_project` | `projects:write` | Create a website project for a URL |
| `verify_installation` | `projects:write` | Load the project's site, check whether the snippet is live, mark it installed |
| `update_project_status` | `projects:write` | Set a project's status (e.g. archive it) |

### Agents

| Tool | Scope | Description |
|---|---|---|
| `list_agents` | `agents:read` | Review agents in the workspace, plus their groups |
| `get_agent_run` | `agents:read` | Status and findings of one execution — poll every 15–30s after `run_agents` |
| `list_agent_runs` | `agents:read` | Past executions, newest first (filter by project, agent, or both) |
| `create_agent` | `agents:write` | Create a custom review agent from plain-language instructions |
| `run_agents` | `agents:run` | Start one execution per agent against a page |

### Comments

| Tool | Scope | Description |
|---|---|---|
| `list_comments` | `comments:read` | Comments on a project, from people and agents alike |
| `get_agent_findings` | `comments:read` | Just the annotations an agent left, optionally narrowed to one execution |

### Analytics

| Tool | Scope | Description |
|---|---|---|
| `get_team_analytics` | `analytics:read` | Comment, resolution, and project-activity rollup for a lookback window |
| `get_people_analytics` | `analytics:read` | Per-person activity: who commented, who resolved, who is idle |
| `get_past_data_analytics` | `analytics:read` | All-time rollup: lifetime counts, most active projects and people |

### Team

| Tool | Scope | Description |
|---|---|---|
| `invite_team_member` | `users:invite` | Invite people to the workspace with access to every project |
| `invite_guest` | `users:invite` | Invite people to a **single** project, so they can comment on it without seeing the rest |

Invites send real email. Both tools cap at 10 recipients per call, de-duplicate the list, and take the inviter identity from your grant — never from model input.

---

## Try it with no account

Two tools work with no token at all, against the `/mcp/try` endpoint:

```json
{
  "mcpServers": {
    "superflow-try": {
      "url": "https://mcp.usesuperflow.ai/mcp/try"
    }
  }
}
```

| Tool | Description |
|---|---|
| `run_site_preview` | Start a free Superflow review of any public URL |
| `get_site_preview` | Poll it, and read the findings once the agents finish |

No workspace, no signup. The authenticated endpoint never serves these, and this endpoint never serves anything else.

---

## Permissions

| Scope | Grants |
|---|---|
| `workspace:read` | Read workspace plan, features, and usage |
| `projects:read` | Read projects and install snippets |
| `projects:write` | Create projects, verify installs, set status |
| `agents:read` | Read agents and their run history |
| `agents:run` | Start agent runs (consumes AI credits) |
| `agents:write` | Create agents |
| `comments:read` | Read comments and agent findings |
| `analytics:read` | Read team, people, and all-time analytics |
| `users:invite` | Send workspace and project invitations |

You pick these when you mint a token, or on the consent screen during OAuth. A client only ever sees the tools its scopes actually satisfy — unscoped tools are not registered for the session, and every call re-checks the scope before it runs.

---

## Support

- Issues and feature requests: [open an issue](../../issues)
- Email: eng@usesuperflow.com
- Security: see [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE)
