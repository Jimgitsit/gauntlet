import { useCallback, useEffect, useRef, useState } from "react";
import { BASE } from "./router";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status}).`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

/** Fetch on mount and whenever `key` changes; optionally poll. Holds the last good value while refetching. */
export function useFetch<T>(path: string | null, opts: { pollMs?: number; key?: unknown } = {}): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (!cancelled && alive.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled && alive.current) {
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled && alive.current) {
          setLoading(false);
        }
      });
    let timer: ReturnType<typeof setInterval> | null = null;
    if (opts.pollMs) {
      timer = setInterval(() => {
        if (document.visibilityState === "visible") {
          setTick((t) => t + 1);
        }
      }, opts.pollMs);
    }
    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, opts.pollMs, opts.key]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

// ---- shapes the API returns ----

export interface User {
  id: number;
  org_id: number;
  email: string;
  name: string;
  role: string;
  org: { id: number; slug: string; name: string };
  /** Set when the server signed this visitor in automatically for a public demo. */
  demo?: true;
}

export type Status = "queued" | "reviewing" | "author" | "human" | "ready" | "blocked";

export interface ChangeRow {
  id: number;
  repo_id: number;
  repo: string;
  number: number;
  title: string;
  author: string;
  author_is_agent: number;
  html_url: string;
  state: string;
  status: Status;
  risk_tier: "low" | "medium" | "high" | null;
  humans_required: number;
  human_approvals: number;
  ci_state: string;
  additions: number;
  deletions: number;
  files_changed: number;
  rounds: number;
  opened_at: string;
  updated_at: string;
  merged_at: string | null;
  reverted: number;
  waiting_since: string | null;
  open_important: number;
  open_nit: number;
  open_pre: number;
  open_security: number;
}

export interface Overview {
  generated_at: string;
  counts: Record<Status, number>;
  open_total: number;
  lanes: { repo_id: number; repo: string; provider: string; depth: string; counts: Record<Status, number>; total: number; oldest_human_wait_hours: number | null; open_security: number }[];
  days: { day: string; opened: number; merged: number; reverted: number }[];
  review: {
    merged_30d: number;
    reverted_30d: number;
    revert_rate: number;
    first_round_pass_rate: number;
    five_plus_rounds_rate: number;
    mean_rounds_to_pass: number;
    substantive_rate: number;
    outcomes: Record<string, number>;
    wait_on_human_hours: { median: number; p95: number };
    humans_per_change: { median: number; p95: number };
    zero_human_share: number;
    tokens_30d: { in: number; out: number };
  };
  attention: { id: number; repo: string; number: number; title: string; status: Status; reason: string; hours: number }[];
}

export interface Finding {
  id: number;
  review_id: number;
  change_id: number;
  severity: "important" | "nit" | "pre-existing";
  category: string;
  path: string;
  line: number | null;
  title: string;
  body: string;
  evidence: string;
  votes_for: number;
  votes_total: number;
  status: "open" | "fixed" | "wrong" | "intentional" | "irrelevant";
  resolved_by: string;
  resolution_note: string;
  fixed_in_sha: string;
  created_at: string;
  resolved_at: string | null;
}

export interface Review {
  id: number;
  round: number;
  head_sha: string;
  depth: string;
  mode: string;
  status: string;
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

export interface ChangeDetail {
  change: ChangeRow & { body: string; risk_reason: string; head_sha: string; base_branch: string; last_reviewed_at: string | null };
  repo: { id: number; provider: string; full_name: string; depth: string; html_url: string };
  reviews: Review[];
  findings: Finding[];
}

export interface Repo {
  id: number;
  provider: "github" | "gitlab";
  full_name: string;
  default_branch: string;
  depth: "quick" | "standard" | "deep";
  trusted_authors: string;
  sensitive_paths: string;
  html_url: string;
  has_token: number;
  has_secret: number;
  open_count: number;
}

export interface WikiIndex {
  pages: { id: number; path: string; title: string; updated_by: string; updated_at: string }[];
  log: { id: number; ts: string; path: string; summary: string; by: string }[];
}
