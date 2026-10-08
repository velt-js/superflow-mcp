# Contributing

Thanks for helping. This repo holds the `superflow-mcp` npm package (a local stdio
MCP server for Superflow comments) and the docs for the hosted server.

## Setup

You need Node.js 22 for development (the package itself runs on Node 20 or later)
and pnpm (the version is pinned in `package.json` under `packageManager`).

```bash
pnpm install
pnpm test
pnpm build
```

Run the built server locally:

```bash
SUPERFLOW_API_KEY=sf_pat_... node dist/index.js
```

Point it at staging or a local API with `SUPERFLOW_API_BASE_URL`.

## Scripts

| Script | What it does |
|---|---|
| `pnpm build` | Bundles `src/index.ts` to `dist/index.js` with tsup. |
| `pnpm typecheck` | `tsc --noEmit` over src, tests and scripts. |
| `pnpm lint` | Typecheck, then fail on any em or en dash in source, docs and examples. |
| `pnpm test` | Unit tests (msw) and, when configured, integration tests. |
| `pnpm generate:client` | Regenerates `src/client/generated/operations.ts` from `openapi/openapi.json`. |
| `pnpm check:drift` | Fails if the generated client is stale; with `SUPERFLOW_DRIFT_BASE_URL`, also compares the snapshot with the live API document. |
| `pnpm docs:tools` | Regenerates `docs/tools.md` from the server's tools/list. |
| `pnpm smoke:stdio` | Starts `dist/index.js` and lists tools over real stdio. |
| `pnpm evals:tools` | First-tool-choice eval (needs `ANTHROPIC_API_KEY`). |
| `pnpm evals` | End-to-end eval against staging (needs `ANTHROPIC_API_KEY`, `SUPERFLOW_TEST_API_KEY`, `SUPERFLOW_API_BASE_URL`). |
| `pnpm seed:staging` | Creates test comments on staging or localhost only, at most 8 per second. |

## How the code is laid out

- `src/index.ts`: the CLI. Reads env, builds the server, connects stdio.
- `src/server.ts`: `createServer({ config, client })`.
- `src/client/api.ts`: the only place that calls `fetch`.
- `src/client/generated/operations.ts`: generated from the OpenAPI snapshot. Do not edit.
- `src/tools/`: tool definitions. `src/resources/`, `src/prompts/`.
- `src/lib/`: id helpers, dates, result formatting, confirm gates, logger.

## Adding a tool

1. Make sure the API operation exists in `openapi/openapi.json` and run `pnpm generate:client`.
2. Define the tool in `src/tools/` with `defineTool`: a `superflow_<verb>_<noun>` name, a
   title, a description written for a language model (what it is for, when to use it,
   when to use a sibling instead, and one `Example:` line of JSON), a zod input shape with
   `.describe()` on every field, all four annotations, and `write: true` if it changes data.
3. Add it to the registry in `src/tools/index.ts`.
4. Add `test/unit/tools/<name>.test.ts`: the happy path plus `standardErrorCases`.
5. Run `pnpm docs:tools` and commit `docs/tools.md`.
6. Add at least one prompt to `test/evals/prompts.json`.

## Evals

`test/evals/prompts.json` entries look like this:

```json
{
  "id": "export-csv",
  "prompt": "Export all resolved comments on {project} as a CSV.",
  "expect_first_tool": "superflow_export_comments",
  "check": [{ "tool": "superflow_export_comments", "arg_includes": { "format": "csv" } }]
}
```

- `expect_first_tool` is a tool name, a list of acceptable names, or `null` for "no tool call".
- `{project}` and `{page_url}` are filled from `SUPERFLOW_TEST_PROJECT` and `SUPERFLOW_TEST_PAGE_URL`.
- Optional: `read_only`, `default_project`, `expect_tools_any_order`.
- Checks: `{ "tool", "arg_includes" }`, `{ "result_path_nonempty": "items" }`,
  `{ "tool_not_called": "..." }`, `{ "no_confirmed_writes": true }`.

## Copy rules

- No em dashes or en dashes anywhere. Use periods, commas or colons. `pnpm lint` checks.
- Short sentences. No jargon.

## Pull requests

Branch from `staging` and open the pull request into `staging`. Run `pnpm lint`,
`pnpm test` and `pnpm check:drift` before you push. Do not edit version numbers by
hand; releases are cut by tagging `v<version>`.
