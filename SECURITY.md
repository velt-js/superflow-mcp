# Security

## Reporting a vulnerability

Email **eng@usesuperflow.com**. Please do not open a public issue for a security
report. We aim to acknowledge within two business days.

## How access works

**Tokens are workspace-bound.** A personal access token or OAuth grant is minted
against one workspace and can never reach another, whichever workspace you are
looking at in the portal afterwards.

**Scopes are enforced twice.** A client is only shown the tools its grant
actually satisfies, and every call re-checks the scope before it runs. A token
minted read-only cannot write, even if a client asks it to.

**Your identity comes from the grant, not from the model.** Tool inputs cannot
carry a workspace key, an organization id, or an email address — the server
resolves all of them from the credential you authorized. An assistant cannot
talk the server into acting as someone else or against someone else's workspace.

**Access is re-checked on every request.** The grant records who authorized it;
each request re-verifies that person still has access to the workspace. Losing
workspace access invalidates the token immediately, without a revocation step.

**Tokens are stored hashed.** Only a hash is persisted, so a raw token is shown
exactly once at creation and cannot be recovered afterwards — revoke and mint a
new one instead.

**Revocation is immediate and total.** Revoking kills the whole grant, including
every access and refresh token issued under it.

**OAuth follows OAuth 2.1.** Authorization code with PKCE (S256 required),
exact-match redirect URI validation, single-use codes, and rotating refresh
tokens. Authorization requests for an unrecognized client or an unregistered
redirect URI are refused with an error page and never redirected.

## Rate limits

Failed authentication attempts are budgeted per IP, and requests are budgeted
per grant. Exhausting either returns `429`; a healthy client with a valid token
will not hit them in normal use.

## Tools with side effects

Most tools are read-only. These are not:

| Tool | Effect |
|---|---|
| `create_web_project` | Creates a project in your workspace |
| `create_agent` | Creates a review agent |
| `run_agents` | Starts agent runs — consumes AI credits |
| `verify_installation` | Loads the project's site once, and marks it installed on a positive result |
| `update_project_status` | Changes a project's status |
| `invite_team_member`, `invite_guest` | **Send real email** to the people named |

The invite tools are the only ones whose effect leaves Superflow. Both cap at 10
recipients per call. If that matters for your setup, mint a token without
`users:invite`.
