# Examples

## Local package (stdio)

| File | Client |
|---|---|
| `claude_desktop_config.json` | Claude Desktop. Merge into `claude_desktop_config.json` (Settings > Developer > Edit Config). |
| `cursor-mcp-stdio.json` | Cursor. Drop into `~/.cursor/mcp.json` or project-local `.cursor/mcp.json`. |
| `claude-code.sh` | Claude Code. The `claude mcp add` commands. |
| `prompts.md` | Things to ask once it is connected. |

## Hosted server

| File | Client |
|---|---|
| `cursor-mcp.json` | Cursor. Drop into `~/.cursor/mcp.json` or project-local `.cursor/mcp.json`. |
| `claude-api.json` | Claude API `/v1/messages` request body. |

For the Claude API, the `mcp_servers` entry and the matching `mcp_toolset` entry
in `tools` are both required: `mcp_server_name` must match a `name` in
`mcp_servers`. Over raw HTTP the beta flag goes in a header instead of the body:

```bash
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: mcp-client-2025-11-20" \
  -d @claude-api.json
```
