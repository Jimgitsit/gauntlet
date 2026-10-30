import type { Change, DiffFile, Finding, IncomingChange, Repo } from "../types";
import { changedLinesOf } from "./diff";
import { labelOf } from "./github";
import type { ChangeProvider, WebhookResult } from "./types";

const API = Bun.env.GITLAB_API ?? "https://gitlab.com/api/v4";

function headers(repo: Repo): Record<string, string> {
  const h: Record<string, string> = { "user-agent": "gauntlet-reviewer" };
  if (repo.access_token) {
    h["private-token"] = repo.access_token;
  }
  return h;
}

function projectPath(repo: Repo): string {
  return encodeURIComponent(repo.full_name);
}

async function gl<T>(repo: Repo, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(repo), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    throw new Error(`GitLab ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface GlMr {
  iid: number;
  title: string;
  description: string | null;
  author: { username: string; bot?: boolean };
  web_url: string;
  state: "opened" | "merged" | "closed" | "locked";
  merged_at: string | null;
  sha?: string;
  last_commit?: { id: string };
  target_branch: string;
  changes_count?: string;
  created_at: string;
  updated_at: string;
}

function toIncoming(mr: GlMr): IncomingChange {
  const state = mr.state === "merged" ? "merged" : mr.state === "opened" ? "open" : "closed";
  return {
    number: mr.iid,
    title: mr.title,
    body: mr.description ?? "",
    author: mr.author.username,
    author_is_agent: Boolean(mr.author.bot) || /-bot$|^bot-/.test(mr.author.username),
    html_url: mr.web_url,
    state,
    head_sha: mr.sha ?? mr.last_commit?.id ?? "",
    base_branch: mr.target_branch,
    additions: 0,
    deletions: 0,
    files_changed: Number.parseInt(mr.changes_count ?? "0", 10) || 0,
    opened_at: mr.created_at,
    updated_at: mr.updated_at,
    merged_at: mr.merged_at,
  };
}

export const gitlab: ChangeProvider = {
  name: "gitlab",

  verifyWebhook(secret, headers) {
    if (!secret) {
      return true;
    }
    return (headers.get("x-gitlab-token") ?? "") === secret;
  },

  parseWebhook(headers, body): WebhookResult | null {
    const event = headers.get("x-gitlab-event") ?? "";
    const b = body as Record<string, unknown>;
    const repoFullName = (b.project as { path_with_namespace?: string } | undefined)?.path_with_namespace ?? "";
    if (event === "Merge Request Hook") {
      const attrs = b.object_attributes as GlMr & { action?: string };
      const action = attrs.action ?? "";
      if (["open", "update", "reopen", "merge", "close"].includes(action)) {
        return { provider: "gitlab", event, action, repoFullName, change: toIncoming(attrs) };
      }
      return { provider: "gitlab", event, action, repoFullName };
    }
    if (event === "Pipeline Hook") {
      const attrs = b.object_attributes as { sha?: string; status?: string };
      const status = attrs.status ?? "pending";
      const state = status === "success" ? "green" : ["failed", "canceled"].includes(status) ? "red" : "pending";
      return { provider: "gitlab", event, action: status, repoFullName, ci: { head_sha: attrs.sha ?? "", state } };
    }
    return { provider: "gitlab", event, action: "", repoFullName };
  },

  async getDiff(repo, change) {
    const res = await gl<{ changes: { old_path: string; new_path: string; diff: string; new_file: boolean; deleted_file: boolean; renamed_file: boolean }[] }>(
      repo,
      `/projects/${projectPath(repo)}/merge_requests/${change.number}/changes`,
    );
    return res.changes.map((c): DiffFile => {
      const status = c.new_file ? "added" : c.deleted_file ? "removed" : c.renamed_file ? "renamed" : "modified";
      return { path: c.new_path, status, patch: c.diff, changedLines: changedLinesOf(c.diff) };
    });
  },

  async getFile(repo, path, ref) {
    const res = await fetch(`${API}/projects/${projectPath(repo)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`, {
      headers: headers(repo),
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`GitLab ${res.status} reading ${path}`);
    }
    return await res.text();
  },

  async postFindings(repo, change, findings, summary) {
    // GitLab positions need the MR's diff refs; we fetch them once.
    const mr = await gl<{ diff_refs?: { base_sha: string; head_sha: string; start_sha: string } }>(
      repo,
      `/projects/${projectPath(repo)}/merge_requests/${change.number}`,
    );
    for (const f of findings) {
      const body = `**${labelOf(f)}** ${f.title}\n\n${f.body}${f.evidence ? `\n\n_Evidence:_ ${f.evidence}` : ""}`;
      const payload: Record<string, unknown> = { body };
      // A position outside the diff is rejected; pre-existing findings post as plain discussions.
      if (mr.diff_refs && f.line !== null && f.severity !== "pre-existing") {
        payload.position = {
          position_type: "text",
          base_sha: mr.diff_refs.base_sha,
          head_sha: mr.diff_refs.head_sha,
          start_sha: mr.diff_refs.start_sha,
          new_path: f.path,
          old_path: f.path,
          new_line: f.line,
        };
      }
      await gl(repo, `/projects/${projectPath(repo)}/merge_requests/${change.number}/discussions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    await gl(repo, `/projects/${projectPath(repo)}/merge_requests/${change.number}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: summary }),
    });
  },

  async listOpenChanges(repo) {
    const mrs = await gl<GlMr[]>(repo, `/projects/${projectPath(repo)}/merge_requests?state=opened&per_page=100`);
    return mrs.map(toIncoming);
  },
};
