# Security

## Reporting a vulnerability

Email **eng@usesuperflow.com**. Please do not open a public issue for a security
report. We aim to acknowledge within two business days.

## How access works

**Keys are workspace-bound.** An API key (personal access token) or OAuth grant
is minted against one workspace and can never reach another, whichever workspace
you are looking at in the portal afterwards.

**Scopes are enforced on the server.** The hosted server only shows a client the
tools its grant satisfies, and every request, from either server or the REST
API, re-checks the scope before it runs. A key minted without `comments:write`
cannot write, even if a client asks it to.

**Your identity comes from the key, not from the model.** Tool inputs cannot
carry a workspace key or an organization id. The server resolves both from the
credential you authorized, and every write is authored as the key's member. The
one exception is posting a comment for an existing project guest
(`on_behalf_of`), which needs the `users:invite` scope. An assistant cannot talk
the server into acting against someone else's workspace.

**Access is re-checked on every request.** The grant records who authorized it,
and each request re-verifies that person still has access to the workspace.
Losing workspace access invalidates the key immediately, without a revocation
step.

**Keys are stored hashed.** Only a hash is persisted, so a raw key is shown
exactly once at creation and cannot be recovered afterwards. Revoke it and mint
a new one instead.

**Revocation is immediate and total.** Revoking kills the whole grant, including
every access and refresh token issued under it.

**OAuth follows OAuth 2.1.** Authorization code with PKCE (S256 required),
exact-match redirect URI validation, single-use codes, and rotating refresh
tokens. Authorization requests for an unrecognized client or an unregistered
redirect URI are refused with an error page and never redirected.

## The local package

**The key stays out of logs.** `superflow-mcp` sends the key only as the bearer
token to the Superflow API (`SUPERFLOW_API_BASE_URL`, https only, except for
localhost). It never logs the key, request bodies or comment text, and it
redacts anything that looks like a Superflow token from its stderr output.

**Comment text is untrusted.** Comments are written by website visitors and
reviewers. Every tool result that contains comment or reply text carries a
notice that tells the model to treat it as data, not instructions.

**Destructive actions are gated.** `superflow_delete_comment` and
`superflow_delete_reply` only show a preview unless called with `confirm: true`.
`superflow_bulk_update_comments` is a dry run unless called with
`dry_run: false` and `confirm: true`. The tool descriptions tell the model to
get your explicit yes first.

**Read-only mode removes writes entirely.** With `SUPERFLOW_READ_ONLY=true`
the write tools are not registered, so a client cannot call them.

## Rate limits

Failed authentication attempts are budgeted per IP, and requests are budgeted
per grant (600 per minute on the REST API). Exhausting either returns `429`.
The local package honors `Retry-After` and retries at most twice. A healthy
client with a valid key will not hit these limits in normal use.

## Tools with side effects

### Local package

| Tool | Effect |
|---|---|
| `superflow_create_comment` | Creates a comment, notifying anyone mentioned |
| `superflow_update_comment` | Changes a comment's text, status, priority, assignee or tags |
| `superflow_resolve_comment`, `superflow_reopen_comment` | Changes status, and can post a note as a reply |
| `superflow_add_reply`, `superflow_update_reply` | Posts or edits a reply, notifying anyone mentioned |
| `superflow_delete_comment`, `superflow_delete_reply` | Deletes (comments can be restored for a limited time; replies cannot) |
| `superflow_restore_comment` | Restores a deleted comment |
| `superflow_bulk_update_comments` | Changes up to 200 comments at once |
| `superflow_add_attachment` | Superflow downloads the file at the URL you give and attaches it |

### Hosted server

| Tool | Effect |
|---|---|
| `create_web_project` | Creates a project in your workspace |
| `create_agent` | Creates a review agent |
| `run_agents` | Starts agent runs, which use AI credits |
| `verify_installation` | Loads the project's site once, and marks it installed on a positive result |
| `update_project_status` | Changes a project's status |
| `invite_team_member`, `invite_guest` | **Send real email** to the people named |

The invite tools are the only ones whose effect leaves Superflow. Both cap at 10
recipients per call. If that matters for your setup, mint a key without
`users:invite`.
