// Row types shared by the API, the reviewer and the seed.

export type Provider = "github" | "gitlab";
export type ChangeState = "open" | "merged" | "closed";
export type ChangeStatus = "queued" | "reviewing" | "author" | "human" | "ready" | "blocked";
export type RiskTier = "low" | "medium" | "high";
export type Severity = "important" | "nit" | "pre-existing";
export type FindingStatus = "open" | "fixed" | "wrong" | "intentional" | "irrelevant";

export interface Org {
  id: number;
  slug: string;
  name: string;
}

export interface User {
  id: number;
  org_id: number;
  email: string;
  name: string;
  role: string;
}

export interface Repo {
  id: number;
  org_id: number;
  provider: Provider;
  full_name: string;
  default_branch: string;
  depth: "quick" | "standard" | "deep";
  trusted_authors: string;
  sensitive_paths: string;
  webhook_secret: string;
  access_token: string;
  html_url: string;
  wiki_slug: string;
}

export interface Change {
  id: number;
  repo_id: number;
  number: number;
  title: string;
  body: string;
  author: string;
  author_is_agent: number;
  html_url: string;
  state: ChangeState;
  status: ChangeStatus;
  risk_tier: RiskTier | null;
  risk_reason: string;
  humans_required: number;
  human_approvals: number;
  ci_state: "pending" | "green" | "red";
  head_sha: string;
  base_branch: string;
  additions: number;
  deletions: number;
  files_changed: number;
  rounds: number;
  opened_at: string;
  updated_at: string;
  merged_at: string | null;
  reverted: number;
  waiting_since: string | null;
  last_reviewed_at: string | null;
}

export interface Review {
  id: number;
  change_id: number;
  round: number;
  head_sha: string;
  depth: string;
  mode: "full" | "diff-only";
  status: "running" | "done" | "failed";
  hunters: number;
  voters: number;
  candidates: number;
  posted: number;
  summary: string;
  tokens_in: number;
  tokens_out: number;
  started_at: string;
  finished_at: string | null;
  error: string;
}

export interface Finding {
  id: number;
  review_id: number;
  change_id: number;
  severity: Severity;
  category: string;
  path: string;
  line: number | null;
  title: string;
  body: string;
  evidence: string;
  votes_for: number;
  votes_total: number;
  status: FindingStatus;
  resolved_by: string;
  resolution_note: string;
  fixed_in_sha: string;
  created_at: string;
  resolved_at: string | null;
}

export interface WikiPage {
  id: number;
  org_id: number;
  path: string;
  title: string;
  content: string;
  updated_by: string;
  updated_at: string;
}

/** A change as a provider hands it to us, before it is stored. */
export interface IncomingChange {
  number: number;
  title: string;
  body: string;
  author: string;
  author_is_agent: boolean;
  html_url: string;
  state: ChangeState;
  head_sha: string;
  base_branch: string;
  additions: number;
  deletions: number;
  files_changed: number;
  opened_at: string;
  updated_at: string;
  merged_at: string | null;
}

/** One file of a diff, as the reviewer sees it. */
export interface DiffFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  patch: string;
  /** Line numbers (new side) that this change added or modified. */
  changedLines: number[];
}
