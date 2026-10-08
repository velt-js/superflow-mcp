// Response shapes from CONTRACT section 5. Hand-written, kept loose where the API may
// add fields later. The package passes API JSON through as structuredContent, so these
// types only cover the fields the package reads to build summaries.

export type Priority = "none" | "low" | "medium" | "high" | "critical";
export type Device = "desktop" | "mobile" | "tablet" | "unknown";
export type AuthorType = "member" | "guest" | "agent";
export type CommentSource = "widget" | "agent" | "api" | "figma" | "voice" | "extension";

export interface EntityRef {
  id: string | null;
  name: string;
}

export interface Candidate {
  id: string;
  name: string;
  url?: string;
  project?: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  hint: string;
  candidates: Candidate[];
  preview?: BulkPreview;
}

/** Section 5.1. */
export interface CommentCompact {
  id: string;
  number: number | null;
  project: string;
  project_id: string;
  page_url: string | null;
  text: string;
  status: string;
  priority: Priority;
  assignees: string[];
  author: string;
  tags: string[];
  reply_count: number;
  has_attachments: boolean;
  device: Device;
  age_days: number | null;
  last_activity_at: string | null;
  url: string;
}

export interface Person {
  id: string;
  name: string;
  type?: AuthorType;
  email?: string;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  size: number | null;
  content_type?: string | null;
}

export interface Anchor {
  selector: string | null;
  xpath: string | null;
  x: number | null;
  y: number | null;
  element_text: string | null;
  viewport: { width: number; height: number } | null;
  device: Device;
}

/** Section 5.3. */
export interface Reply {
  id: string;
  comment_id?: string;
  text: string;
  author: Person;
  attachments: Attachment[];
  created_at: string;
  updated_at: string;
  edited: boolean;
}

/** Section 5.2. */
export interface CommentFull {
  id: string;
  number: number | null;
  project: { id: string; name: string };
  page: { id: string; url: string; title: string | null } | null;
  text: string;
  status: { id: string; name: string; is_resolved: boolean };
  priority: Priority;
  assignees: Person[];
  author: Person;
  tags: string[];
  anchor: Anchor | null;
  screenshot_url: string | null;
  metadata: Record<string, unknown> | null;
  source: CommentSource;
  agent: { id: string; name: string; run_id: string | null; severity: string | null; confidence: number | null } | null;
  external_links: unknown[];
  attachments: Attachment[];
  replies?: Reply[];
  reply_count: number;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: Person | null;
  age_days: number | null;
  url: string;
  screenshot_status?: string;
}

/** Section 5.5. */
export interface Project {
  id: string;
  name: string;
  site_url: string | null;
  platform: string;
  install_status: string;
  archived: boolean;
  open_comment_count: number | null;
  created_at: string | null;
  url: string;
  member_count?: number;
  guest_count?: number;
  total_comment_count?: number | null;
  statuses?: Status[];
}

/** Section 5.6. */
export interface Page {
  id: string;
  project_id: string;
  url: string;
  title: string | null;
  open_comment_count: number | null;
  total_comment_count: number | null;
  last_comment_at: string | null;
  last_screenshot_at: string | null;
}

/** Section 5.7. */
export interface Member {
  id: string;
  name: string;
  email: string | null;
  type: "member" | "guest";
  role?: "owner" | "admin";
  project_ids: string[] | null;
  invited_at?: string | null;
  last_active_at: string | null;
}

/** Section 5.8. */
export interface Status {
  id: string;
  project_id: string | null;
  name: string;
  color: string | null;
  order: number;
  is_resolved: boolean;
  is_default: boolean;
}

/** Section 5.9. */
export interface Tag {
  id: string;
  project_id: string | null;
  name: string;
  color: string | null;
  usage_count: number | null;
}

/** Section 5.10. */
export interface Me {
  member: { id: string; name: string; email: string | null; role: string };
  organization: { id: string; name: string; plan: string | null };
  scopes: string[];
  key: { kind: string; label: string | null; created_at: string | null; expires_at: string | null };
}

export interface Scan {
  scanned: number;
  complete: boolean;
}

/** Section 5.11. */
export interface ListEnvelope<T> {
  items: T[];
  next_cursor: string | null;
  total?: number;
  applied_filters?: Record<string, unknown>;
  scan?: Scan;
}

export interface StatsRow {
  key: string | null;
  label: string;
  count: number;
  avg_hours_to_resolve?: number | null;
  median_hours_to_first_reply?: number | null;
}

export interface StatsResponse {
  rows: StatsRow[];
  total: number;
  applied_filters?: Record<string, unknown>;
  scan?: Scan;
  approximate_metrics?: string[];
}

export interface ExportResponse {
  format: "csv" | "json" | "markdown";
  row_count: number;
  content: string | null;
  download_url: string | null;
  expires_at: string | null;
  applied_filters?: Record<string, unknown>;
  scan?: Scan;
}

export interface DeleteCommentResponse {
  deleted: true;
  id: string;
  number: number | null;
  restore_until: string | null;
}

export interface DeleteResponse {
  deleted: true;
  id: string;
}

export interface ResolveResponse {
  comment: CommentFull;
  changed: boolean;
  note_reply_id: string | null;
}

export interface CreateReplyResponse {
  reply: Reply;
  unresolved_mentions: string[];
}

export interface BulkPreview {
  would_update: number;
  sample: CommentCompact[];
}

export interface BulkDryRunResponse extends BulkPreview {
  dry_run: true;
  /** Selected comments already in the target state (skipped). */
  already_in_state: number;
  applied_filters?: Record<string, unknown>;
  scan?: Scan;
}

export interface BulkRunResponse {
  dry_run: false;
  updated: number;
  /** Selected comments already in the target state (skipped, no note posted). */
  unchanged: number;
  failed: Array<{ id: string; error: string }>;
}
