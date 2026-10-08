// Contract-shaped sample data (CONTRACT section 5).
import type {
  ActivityEntry,
  CommentCompact,
  CommentFull,
  InviteResponse,
  ListEnvelope,
  Me,
  Member,
  NotificationSettings,
  Organization,
  Page,
  Project,
  Reply,
  ReviewLink,
  Status,
  Tag,
} from "../../src/client/types.ts";

export const project: Project = {
  id: "prj_1a2b",
  name: "Acme Dental",
  site_url: "https://acme.com",
  platform: "webflow",
  install_status: "verified",
  archived: false,
  open_comment_count: 12,
  created_at: "2026-09-01T10:00:00Z",
  url: "https://app.usesuperflow.ai/project/1a2b?workspaceId=key1",
};

export const projectFull: Project = {
  ...project,
  member_count: 3,
  guest_count: 2,
  total_comment_count: 40,
  statuses: [],
};

export const page: Page = {
  id: "pg_9z",
  project_id: "prj_1a2b",
  url: "https://acme.com/pricing",
  title: "Pricing",
  open_comment_count: 4,
  total_comment_count: 9,
  last_comment_at: "2026-10-07T18:02:11Z",
  last_screenshot_at: null,
};

export const emptyPage: Page = {
  ...page,
  id: "pg_8y",
  url: "https://acme.com/about",
  title: "About",
  open_comment_count: 0,
  total_comment_count: 0,
  last_comment_at: null,
};

export const member: Member = {
  id: "usr_2",
  name: "Jen",
  email: "jen@agency.com",
  type: "member",
  role: "admin",
  project_ids: null,
  last_active_at: null,
};

export const guest: Member = {
  id: "gst_5",
  name: "Dana Client",
  email: "dana@acme.com",
  type: "guest",
  project_ids: ["prj_1a2b"],
  invited_at: "2026-09-02T10:00:00Z",
  last_active_at: null,
};

export const statuses: Status[] = [
  { id: "sts_OPEN", project_id: null, name: "Open", color: "#2f4bd6", order: 0, is_resolved: false, is_default: true },
  { id: "sts_IN_PROGRESS", project_id: null, name: "In progress", color: "#9a5b00", order: 1, is_resolved: false, is_default: false },
  { id: "sts_RESOLVED", project_id: null, name: "Resolved", color: "#1f7a4f", order: 2, is_resolved: true, is_default: false },
];

export const tags: Tag[] = [
  { id: "tag_copy", project_id: null, name: "copy", color: null, usage_count: 12 },
  { id: "tag_mobile", project_id: "prj_1a2b", name: "mobile", color: "#b3261e", usage_count: 5 },
];

export const me: Me = {
  member: { id: "usr_7", name: "Rakesh", email: "rakesh@agency.com", role: "owner" },
  organization: { id: "org_key1", name: "Wonderist", plan: "scale" },
  scopes: ["comments:read", "comments:write", "projects:read"],
  key: { kind: "pat", label: "Cursor on my laptop", created_at: "2026-10-01T00:00:00Z", expires_at: null },
};

export const compactComment: CommentCompact = {
  id: "cmt_8f3k2",
  number: 4821,
  project: "Acme Dental",
  project_id: "prj_1a2b",
  page_url: "https://acme.com/pricing",
  text: "Button overlaps the nav on mobile",
  status: "Open",
  priority: "high",
  assignees: ["Jen"],
  author: "Rakesh (member)",
  tags: ["mobile", "layout"],
  reply_count: 1,
  has_attachments: true,
  device: "mobile",
  age_days: 1,
  last_activity_at: "2026-10-07T18:02:11Z",
  url: "https://acme.com/pricing?scommentId=8f3k2",
};

export const reply: Reply = {
  id: "rpl_8f3k2.654321",
  comment_id: "cmt_8f3k2",
  text: "On it",
  author: { id: "usr_2", name: "Jen", type: "member" },
  attachments: [],
  created_at: "2026-10-07T18:02:11Z",
  updated_at: "2026-10-07T18:02:11Z",
  edited: false,
};

export const fullComment: CommentFull = {
  id: "cmt_8f3k2",
  number: 4821,
  project: { id: "prj_1a2b", name: "Acme Dental" },
  page: { id: "pg_9z", url: "https://acme.com/pricing", title: "Pricing" },
  text: "Button overlaps the nav on mobile",
  status: { id: "sts_OPEN", name: "Open", is_resolved: false },
  priority: "high",
  assignees: [{ id: "usr_2", name: "Jen", email: "jen@agency.com" }],
  author: { id: "usr_7", name: "Rakesh", type: "member" },
  tags: ["mobile", "layout"],
  anchor: {
    selector: null,
    xpath: "/html/body/header/nav/a[3]",
    x: 0.82,
    y: 0.04,
    element_text: null,
    viewport: { width: 390, height: 844 },
    device: "mobile",
  },
  screenshot_url: null,
  metadata: { browser: null, os: null, url_at_creation: "https://acme.com/pricing?utm=x" },
  source: "widget",
  agent: null,
  external_links: [],
  attachments: [{ id: "att_8f3k2.123456.1", name: "fix.png", url: "https://files.example.com/fix.png", size: 20311 }],
  replies: [reply],
  reply_count: 1,
  last_activity_at: "2026-10-07T18:02:11Z",
  created_at: "2026-10-07T17:40:00Z",
  updated_at: "2026-10-07T18:02:11Z",
  resolved_at: null,
  resolved_by: null,
  age_days: 1,
  url: "https://acme.com/pricing?scommentId=8f3k2",
};

export const resolvedComment: CommentFull = {
  ...fullComment,
  status: { id: "sts_RESOLVED", name: "Resolved", is_resolved: true },
};

export const appliedProject = { project: [{ id: "prj_1a2b", name: "Acme Dental" }] };

export function list<T>(items: T[], extra: Partial<ListEnvelope<T>> = {}): ListEnvelope<T> {
  return { items, next_cursor: null, ...extra };
}

export const ambiguousProject = {
  code: "ambiguous",
  message: 'The project "Acme" matches 2 projects.',
  hint: "Pick one of the candidates and call again with its id.",
  candidates: [
    { id: "prj_1a2b", name: "Acme Dental", url: "https://app.usesuperflow.ai/project/1a2b" },
    { id: "prj_3c4d", name: "Acme Labs", url: "https://app.usesuperflow.ai/project/3c4d" },
  ],
};

export const notFound = {
  code: "not_found",
  message: "No comment #4821 in project Acme Dental.",
  hint: "List comments with superflow_list_comments to find the number.",
  candidates: [],
};

/** A comment in a project the API has not numbered yet (number is null). */
export const unnumberedComment: CommentFull = { ...fullComment, number: null };

// ---------------------------------------------------------------------------------------------
// Phase 2 (CONTRACT-P2).
// ---------------------------------------------------------------------------------------------

/** GET /projects/{project} in Phase 2: the full shape plus settings and install. */
export const projectDetail: Project = {
  ...projectFull,
  settings: {
    guest_comments: true,
    guest_sign_in: false,
    comments_disabled: false,
    toolbar_enabled: true,
    query_params_as_pages: false,
  },
  install: { platform: "webflow", status: "verified", verified_by: "script_tag", script_tag_detected_at: "2026-09-02T10:00:00Z" },
};

export const customStatus: Status = {
  id: "sts_IN_REVIEW",
  project_id: "prj_1a2b",
  name: "In review",
  color: "#7c3aed",
  order: 1,
  is_resolved: false,
  is_default: false,
};

export const projectStatuses: Status[] = [statuses[0] as Status, customStatus, statuses[2] as Status];

export const memberInvite: InviteResponse = {
  invited: [{ email: "jen@agency.com", sent: true }],
  skipped: [{ email: "rakesh@agency.com", reason: "already_member" }],
  seats: { before: { used: 3, total: 10 }, after: { used: 4, total: 10 } },
};

export const guestInvite: InviteResponse = {
  invited: [
    { email: "dana@acme.com", sent: true },
    { email: "lee@acme.com", sent: false },
  ],
  skipped: [],
  seats: { before: { used: 2, total: null }, after: { used: 4, total: null } },
};

export const organization: Organization = {
  id: "org_key1",
  name: "Wonderist",
  plan: "scale",
  owner: { name: "Rakesh", email: "rakesh@agency.com" },
  seats: {
    members: { used: 4, invited: 1, total: 10 },
    guests: { used: 12, invited: 0, total: null },
  },
  projects: { used: 7, total: 20 },
  credits: { balance: 1234, included_remaining: 1000, purchased_remaining: 234, auto_refill: { enabled: true, threshold: 100, pack: "pack_500" } },
  created_at: "2026-01-05T09:00:00Z",
};

export const activityEntry: ActivityEntry = {
  id: "act_1",
  at: "2026-10-08T10:00:00Z",
  actor: { id: "usr_7", email: "rakesh@agency.com", name: "Rakesh" },
  action: "updateComment",
  entity: { type: "comment", ids: ["cmt_8f3k2"] },
  via: "mcp",
};

export const reviewLink: ReviewLink = {
  id: "lnk_8a7b6c",
  project_id: "prj_1a2b",
  url: "https://acme.com/?sfShare=8a7b6c",
  created_at: "2026-10-01T12:00:00Z",
  created_by: { id: "usr_7", email: "rakesh@velt.dev" },
};

export const notificationSettings: NotificationSettings = {
  email_digest: { enabled: true, cadence: "daily" },
  inbox: "all",
  email: "mine",
};
