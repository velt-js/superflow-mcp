# Changelog

All notable changes to the Superflow MCP server are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0]

Initial public release.

### Added
- Remote MCP server over Streamable HTTP at `/mcp`.
- 20 scoped tools across workspace, projects, agents, comments, analytics, and team.
- No-account demo endpoint at `/mcp/try` with `run_site_preview` and `get_site_preview`.
- Personal access tokens (`sf_pat_…`) with per-scope selection and 30-day, 90-day, or no expiry.
- OAuth 2.1 with PKCE and RFC 7591 dynamic client registration, for clients that
  register themselves instead of taking a pasted token.
