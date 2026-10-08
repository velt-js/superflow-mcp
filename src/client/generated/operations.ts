// GENERATED FILE. Do not edit.
// Source: openapi/openapi.json. Regenerate with `pnpm generate:client`.

export const operations = {
  addCommentAttachment: {
    method: "POST",
    path: "/comments/{comment}/attachments",
    pathParams: ["comment"],
    queryParams: [],
  },
  addReplyAttachment: {
    method: "POST",
    path: "/replies/{reply}/attachments",
    pathParams: ["reply"],
    queryParams: [],
  },
  bulkUpdateComments: {
    method: "POST",
    path: "/comments/bulk",
    pathParams: [],
    queryParams: [],
  },
  createComment: {
    method: "POST",
    path: "/comments",
    pathParams: [],
    queryParams: [],
  },
  createReply: {
    method: "POST",
    path: "/comments/{comment}/replies",
    pathParams: ["comment"],
    queryParams: [],
  },
  deleteComment: {
    method: "DELETE",
    path: "/comments/{comment}",
    pathParams: ["comment"],
    queryParams: ["project"],
  },
  deleteReply: {
    method: "DELETE",
    path: "/replies/{reply}",
    pathParams: ["reply"],
    queryParams: [],
  },
  exportComments: {
    method: "GET",
    path: "/comments/export",
    pathParams: [],
    queryParams: ["agent", "agent_run", "assignee", "author", "author_type", "created_after", "created_before", "device", "format", "has_attachments", "has_external_link", "has_replies", "page_match", "page_url", "priority", "project", "query", "resolved_after", "resolved_before", "sort", "source", "stale_days", "status", "tags", "tags_match", "unanswered", "updated_after", "updated_before"],
  },
  getComment: {
    method: "GET",
    path: "/comments/{comment}",
    pathParams: ["comment"],
    queryParams: ["include_replies", "project"],
  },
  getCommentStats: {
    method: "GET",
    path: "/comments/stats",
    pathParams: [],
    queryParams: ["agent", "agent_run", "assignee", "author", "author_type", "created_after", "created_before", "device", "group_by", "has_attachments", "has_external_link", "has_replies", "metrics", "page_match", "page_url", "priority", "project", "query", "resolved_after", "resolved_before", "source", "stale_days", "status", "tags", "tags_match", "unanswered", "updated_after", "updated_before"],
  },
  getMe: {
    method: "GET",
    path: "/me",
    pathParams: [],
    queryParams: [],
  },
  getOpenApi: {
    method: "GET",
    path: "/openapi.json",
    pathParams: [],
    queryParams: [],
  },
  getProject: {
    method: "GET",
    path: "/projects/{project}",
    pathParams: ["project"],
    queryParams: [],
  },
  listComments: {
    method: "GET",
    path: "/comments",
    pathParams: [],
    queryParams: ["agent", "agent_run", "assignee", "author", "author_type", "created_after", "created_before", "cursor", "device", "fields", "has_attachments", "has_external_link", "has_replies", "limit", "page_match", "page_url", "priority", "project", "query", "resolved_after", "resolved_before", "sort", "source", "stale_days", "status", "tags", "tags_match", "unanswered", "updated_after", "updated_before"],
  },
  listMembers: {
    method: "GET",
    path: "/members",
    pathParams: [],
    queryParams: ["project", "query"],
  },
  listProjectMembers: {
    method: "GET",
    path: "/projects/{project}/members",
    pathParams: ["project"],
    queryParams: ["query"],
  },
  listProjectPages: {
    method: "GET",
    path: "/projects/{project}/pages",
    pathParams: ["project"],
    queryParams: ["cursor", "limit", "query", "with_counts"],
  },
  listProjectStatuses: {
    method: "GET",
    path: "/projects/{project}/statuses",
    pathParams: ["project"],
    queryParams: [],
  },
  listProjectTags: {
    method: "GET",
    path: "/projects/{project}/tags",
    pathParams: ["project"],
    queryParams: [],
  },
  listProjects: {
    method: "GET",
    path: "/projects",
    pathParams: [],
    queryParams: ["cursor", "include_archived", "limit", "query"],
  },
  listReplies: {
    method: "GET",
    path: "/comments/{comment}/replies",
    pathParams: ["comment"],
    queryParams: ["project"],
  },
  listStatuses: {
    method: "GET",
    path: "/statuses",
    pathParams: [],
    queryParams: [],
  },
  listTags: {
    method: "GET",
    path: "/tags",
    pathParams: [],
    queryParams: ["project"],
  },
  reopenComment: {
    method: "POST",
    path: "/comments/{comment}/reopen",
    pathParams: ["comment"],
    queryParams: [],
  },
  resolveComment: {
    method: "POST",
    path: "/comments/{comment}/resolve",
    pathParams: ["comment"],
    queryParams: [],
  },
  restoreComment: {
    method: "POST",
    path: "/comments/{comment}/restore",
    pathParams: ["comment"],
    queryParams: [],
  },
  updateComment: {
    method: "PATCH",
    path: "/comments/{comment}",
    pathParams: ["comment"],
    queryParams: [],
  },
  updateReply: {
    method: "PATCH",
    path: "/replies/{reply}",
    pathParams: ["reply"],
    queryParams: [],
  },
} as const;

export type OperationId = keyof typeof operations;
export type Operation = (typeof operations)[OperationId];
export type HttpMethod = Operation["method"];
