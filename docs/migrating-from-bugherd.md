# Migrating from BugHerd

If you used BugHerd's API or a BugHerd MCP setup, this page maps what you know to
Superflow. In Superflow, feedback lives as comments pinned on live pages. Your
assistant works with them through the `superflow-mcp` tools (or the REST API v1 they
call).

## Terms

| BugHerd | Superflow | Notes |
|---|---|---|
| task | comment | A comment is a thread: the first message plus replies. It has a per-project number, like `#4821`. |
| column | status | Statuses are ordered and can be customized for the workspace or per project. Some count as resolved. See `superflow_list_statuses`; add, rename, reorder or delete them with the status tools. |
| requester | guest | Clients and reviewers invited to a single project. Your team are members. Invite with `superflow_invite_guest`. |
| project | project | One website. Find it by name, site URL or id. One project per domain; the site URL cannot change, but you can add extra domains. |
| tag | tag | Unknown tag names are created when you write them. |
| assigned_to | assignee | A comment has one assignee. Removing it is not supported yet: unassign in the Superflow toolbar. |
| priority | priority | Superflow has three priorities you can set: `critical` (P0), `high` (P1), `medium` (P2). BugHerd `critical`, `important` and `normal` map to them. `minor` reads as `low` and `not_set` as `none`; you can filter by both, but `low` cannot be written and a priority cannot be cleared yet. |
| task comment | reply | Replies support @mentions of members and guests. |
| attachment | attachment | Added by URL. Superflow downloads and stores the file. |
| local_task_id | comment number | `#4821`, scoped to a project. |
| external_id | external link | Planned (Phase 3). `has_external_link` matches nothing yet. |
| admin / member | member | Superflow members are workspace owners or admins of every project. There are no per-project member roles. |

You can name things the way people do: a project by name or domain, a person by name
or email, a status by name. When a name matches more than one thing, the tool returns
the candidates instead of guessing.

## Endpoints

BugHerd API v2 endpoints and the Superflow tool that covers each. Rows marked
planned are not in this release.

| BugHerd endpoint | Superflow tool | Status |
|---|---|---|
| `GET /organization.json` | `superflow_get_organization` (plan, seats, projects, credits), or `superflow_get_me` (you and your key) | available |
| `GET /users.json`, `/users/members.json`, `/users/guests.json` | `superflow_list_members` | available |
| `GET /projects.json`, `/projects/active.json` | `superflow_list_projects` | available |
| `GET /projects/{id}.json` | `superflow_get_project` | available |
| `GET /projects/{id}/columns.json` | `superflow_list_statuses` | available |
| `GET /projects/{id}/tasks.json` (and its filters) | `superflow_list_comments` | available |
| Counting tasks by column, assignee or tag | `superflow_comment_stats` | available |
| `GET /projects/{id}/tasks/{id}.json` | `superflow_get_comment` | available |
| `GET /projects/{id}/tasks/local_task/{local_task_id}.json` | `superflow_get_comment` with the number and project | available |
| `POST /projects/{id}/tasks.json` | `superflow_create_comment` | available |
| `PUT /projects/{id}/tasks/{id}.json` | `superflow_update_comment`, `superflow_resolve_comment`, `superflow_reopen_comment` | available |
| Updating many tasks | `superflow_bulk_update_comments` | available |
| `GET /projects/{id}/tasks/{id}/comments.json` | `superflow_get_comment` (replies included) | available |
| `POST /projects/{id}/tasks/{id}/comments.json` | `superflow_add_reply` | available |
| `GET /projects/{id}/tasks/{id}/attachments.json` | `superflow_get_comment` (attachments included) | available |
| `POST /projects/{id}/tasks/{id}/attachments.json` | `superflow_add_attachment` | available |
| `DELETE /projects/{id}/tasks/{id}.json` | `superflow_delete_comment` (with `confirm: true`; restorable) | available |
| Exporting tasks | `superflow_export_comments` (csv, json, markdown) | available |
| `POST /projects.json` | `superflow_create_project` (optionally inviting guests) | available |
| `PUT /projects/{id}.json` | `superflow_update_project` (name, settings, extra domains), `superflow_archive_project`, `superflow_unarchive_project` | available |
| `DELETE /projects/{id}.json` | `superflow_delete_project` (with `confirm: true`; permanent) | available |
| `POST /projects/{id}/add_member.json` | `superflow_invite_member` (members see every project) | available |
| `POST /projects/{id}/add_guest.json` | `superflow_invite_guest` | available |
| Removing a user or guest | `superflow_remove_member`, `superflow_remove_guest` (with `confirm: true`) | available |
| `POST /projects/{id}/columns.json` | `superflow_create_status` | available |
| `PUT /projects/{id}/columns/{id}.json` | `superflow_update_status`, `superflow_reorder_statuses` | available |
| Deleting a column | `superflow_delete_status` (moves its comments; with `confirm: true`) | available |
| Managing tags | `superflow_create_tag`, `superflow_update_tag`, `superflow_delete_tag`, `superflow_merge_tags` | available |
| Install code for a project | `superflow_get_install_snippet`, `superflow_verify_install` | available |
| `DELETE /projects/{id}/tasks/{id}/attachments/{id}.json` | removing an attachment (not offered by the API yet) | planned |
| `GET /webhooks.json`, `POST /webhooks.json`, `DELETE /webhooks/{id}.json` | webhooks | planned (Phase 3) |
| `external_id` on tasks | external links (Jira, Linear and others) | planned (Phase 3) |

## Filters you used in BugHerd

| BugHerd filter | `superflow_list_comments` filter |
|---|---|
| `status` | `status` (names, or the words `open` and `resolved`) |
| `priority` | `priority` |
| `tag` | `tags` (with `tags_match: any` or `all`) |
| `assigned_to_id` | `assignee` (name, email, id, `me` or `unassigned`) |
| `created_since` | `created_after` (ISO date or `24h`, `7d`, `2w`, `1m`, `today`, `this_week`, ...) |
| `updated_since` | `updated_after` |
| `page` | `cursor` (opaque, from `next_cursor`) |

Superflow adds filters BugHerd does not have: `page_url` with `page_match`, `query`
(full-text over the thread), `unanswered`, `stale_days`, `author_type`, `device`,
`source`, `agent` and `agent_run`.
