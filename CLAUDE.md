# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repo.

## What this is

`superflow-mcp`: a public npm package that runs a local MCP server over stdio for
Superflow comments. It is a thin client over the Superflow REST API v1. The API
resolves names, URLs, emails and numbers, parses relative dates and runs dry runs;
this package validates input, calls the API and shapes the answer.

The README also documents the hosted server at `https://mcp.usesuperflow.ai/mcp`.
Its code lives elsewhere. `server.json` is its registry manifest: do not edit it here.

## Hard rules

- **Never call `fetch` outside `src/client/api.ts`.** Every request goes through
  `ApiClient.call(operationId, ...)` so auth, timeouts, retries and error mapping stay
  in one place.
- **Never log the API key**, request bodies or comment text. Log method, operationId,
  status and duration at debug level only.
- **Logs go to stderr only.** stdout carries the MCP protocol. A stray `console.log`
  breaks every client.
- **Never throw out of a tool handler.** Return `errorResult(...)` or let the server
  wrapper turn the error into an `isError` result.
- **Do not edit `src/client/generated/operations.ts`.** Change `openapi/openapi.json`
  and run `pnpm generate:client`.
- **No em dashes or en dashes** in code, comments, descriptions, docs or commit
  messages. Use periods, commas or colons.
- Run `pnpm test` and `pnpm check:drift` before every commit.

## Tool descriptions are for a language model

Each description says what the tool is for, when to use it, when not to (and which
sibling tool to use instead), and ends with one `Example:` line of JSON that must
parse and match the input schema (`test/unit/server.test.ts` checks this). Short
sentences, no jargon.

## How to add a tool

1. Confirm the API operation is in `openapi/openapi.json`; run `pnpm generate:client`.
2. Define it in `src/tools/` with `defineTool`: `superflow_<verb>_<noun>` name, title,
   description, zod raw shape with `.describe()` on every field, all four annotations
   (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), and
   `write: true` if it changes data (write tools vanish in read-only mode).
3. Register it in `src/tools/index.ts`.
4. Add `test/unit/tools/<name>.test.ts` with the happy path and `standardErrorCases`.
   The harness fails any request whose query params are not in the OpenAPI snapshot.
5. Run `pnpm docs:tools` and commit `docs/tools.md`.
6. Add an eval prompt to `test/evals/prompts.json`.

## Rules the tools follow

- Ids pass through to the API (URL-encoded in paths). For a bare comment number with no
  `project`, inject `SUPERFLOW_DEFAULT_PROJECT` (`projectForComment` in `src/lib/resolve.ts`).
- Lists: `limit` default 25, max 100; pass `cursor` through; the summary says when more
  results exist (`paginationNote`).
- Dates: validate with `findInvalidDate` before calling the API.
- Gates: every destructive tool (`destructiveHint: true`) except bulk needs `confirm: true`;
  without it it only reads and returns a `needs_confirmation` preview (`confirmationResult`).
  Find the item to preview in a list with `findOne` (`src/lib/match.ts`). The one exception
  is `superflow_remove_member`, which asks the API without confirm and shows its 409
  preview. Bulk is a dry run unless `dry_run: false` and `confirm: true`. These previews
  are normal results, not errors. Unit tests prove no write request goes out without confirm.
- Invite tools send real email, and their descriptions say so. Creates and invites send a
  generated `idempotency_key` when the caller gave none.
- Results: `okResult(summary, data)`. One-line summary, the untrusted-content notice when
  comment text is present, then the JSON. Text is capped at 30,000 characters.
- `idempotency_key`: generated per call for create comment, add reply, create project,
  invites and create review link when missing.
- Write limits (CONTRACT 6.3): priority writes take `critical`, `high`, `medium` (plus `none` on
  create only); the assignee can be replaced but not removed (`refuseUnassign`). Filters still
  accept `low`, `none` and `unassigned`.
- Comment `number` can be null. Label comments with `commentLabel`, which falls back to the id.

## Commands

```bash
pnpm install
pnpm lint          # typecheck + dash check
pnpm test
pnpm build
pnpm check:drift
pnpm docs:tools
pnpm smoke:stdio   # after build
```

Node 22 for development (pnpm needs it); the built package supports Node 20+.
Memory on dev machines can be tight: run one test or typecheck process at a time.

## Branches

Branch from `staging`, open pull requests into `staging`. Releases are `v*` tags.
