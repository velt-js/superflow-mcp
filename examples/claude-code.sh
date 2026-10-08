#!/usr/bin/env sh
# Add the local Superflow MCP server to Claude Code.
claude mcp add superflow -e SUPERFLOW_API_KEY=sf_pat_YOUR_KEY -- npx -y superflow-mcp

# Read-only variant: the write tools are not registered.
# claude mcp add superflow -e SUPERFLOW_API_KEY=sf_pat_YOUR_KEY -e SUPERFLOW_READ_ONLY=true -- npx -y superflow-mcp

# Hosted server instead (no install):
# claude mcp add --transport http superflow https://mcp.usesuperflow.ai/mcp --header "Authorization: Bearer sf_pat_YOUR_KEY"
