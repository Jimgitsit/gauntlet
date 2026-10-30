import type { Change, DiffFile, Finding, IncomingChange, Repo } from "../types";
import { changedLinesOf } from "./diff";
import type { ChangeProvider, WebhookResult } from "./types";

const API = "https://api.github.com";

function headers(repo: Repo): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "gauntlet-reviewer",
  };
  if (repo.access_token) {
    h.authorization = `Bearer ${repo.access_token}`;
  }
  return h;
}

async function gh<T>(repo: Repo, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(repo), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface GhPull {
  number: number;
  title: string;
  body: string | null;
  user: { login: string; type: string };
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  head: { sha: string };
  base: { ref: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
  created_at: string;
  updated_at: string;
}

function toIncoming(pr: GhPull): IncomingChange {
  const state = pr.merged_at ? "merged" : pr.state === "open" ? "open" : "closed";
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    author: pr.user.login,
    author_is_agent: pr.user.type === "Bot" || /\[bot\]$/.test(pr.user.login),
    html_url: pr.html_url,
    state,
    head_sha: pr.head.sha,
    base_branch: pr.base.ref,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    files_changed: pr.changed_files ?? 0,
    opened_at: pr.created_at,
    updated_at: pr.updated_at,
    merged_at: pr.merged_at,
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const github: ChangeProvider = {
  name: "github",

  verifyWebhook(secret, headers, rawBody) {
    const sig = headers.get("x-hub-signature-256") ?? "";
    if (!secret) {
      return true;
    }
    const hasher = new Bun.CryptoHasher("sha256", secret);
    hasher.update(rawBody);
    const expected = `sha256=${hasher.digest("hex")}`;
    return timingSafeEqual(sig, expected);
  },

  parseWebhook(headers, body) {
    const event = headers.get("x-github-event") ?? "";
    const b = body as Record<string, unknown>;
    const repoFullName = (b.repository as { full_name?: string } | undefined)?.full_name ?? "";
    if (event === "pull_request") {
      const action = String(b.action ?? "");
      const pr = b.pull_request as GhPull;
      if (["opened", "synchronize", "reopened", "edited", "closed", "ready_for_review"].includes(action)) {
        return { provider: "github", event, action, repoFullName, change: toIncoming(pr) };
      }
      return { provider: "github", event, action, repoFullName };
    }
    if (event === "check_suite" || event === "status") {
      const sha = String((b.check_suite as { head_sha?: string } | undefined)?.head_sha ?? b.sha ?? "");
      const conclusion = String((b.check_suite as { conclusion?: string } | undefined)?.conclusion ?? b.state ?? "pending");
      const state = conclusion === "success" ? "green" : ["failure", "error", "timed_out", "cancelled"].includes(conclusion) ? "red" : "pending";
      return { provider: "github", event, action: String(b.action ?? ""), repoFullName, ci: { head_sha: sha, state } };
    }
    return { provider: "github", event, action: String(b.action ?? ""), repoFullName };
  },

  async getDiff(repo, change) {
    const files = await gh<{ filename: string; status: string; patch?: string }[]>(
      repo,
      `/repos/${repo.full_name}/pulls/${change.number}/files?per_page=100`,
    );
    return files.map((f): DiffFile => {
      const patch = f.patch ?? "";
      const status = f.status === "added" ? "added" : f.status === "removed" ? "removed" : f.status === "renamed" ? "renamed" : "modified";
      return { path: f.filename, status, patch, changedLines: changedLinesOf(patch) };
    });
  },

  async getFile(repo, path, ref) {
    const res = await fetch(`${API}/repos/${repo.full_name}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
      headers: { ...headers(repo), accept: "application/vnd.github.raw+json" },
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`GitHub ${res.status} reading ${path}`);
    }
    return await res.text();
  },

  async postFindings(repo, change, findings, summary) {
    // Inline comments must sit on a line in the diff; pre-existing findings
    // point outside it and would make GitHub reject the whole review (422).
    const inline = findings.filter((f) => f.line !== null && f.severity !== "pre-existing");
    const elsewhere = findings.filter((f) => !inline.includes(f));
    const body = elsewhere.length === 0 ? summary : `${summary}\n\n${elsewhere.map((f) => `- **${labelOf(f)}** ${f.title} (${f.path}${f.line !== null ? `:${f.line}` : ""}): ${f.body}`).join("\n")}`;
    const comments = inline
      .map((f) => ({
        path: f.path,
        line: f.line as number,
        side: "RIGHT",
        body: `**${labelOf(f)}** ${f.title}\n\n${f.body}${f.evidence ? `\n\n_Evidence:_ ${f.evidence}` : ""}`,
      }));
    await gh(repo, `/repos/${repo.full_name}/pulls/${change.number}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commit_id: change.head_sha, event: "COMMENT", body, comments }),
    });
  },

  async listOpenChanges(repo) {
    const pulls = await gh<GhPull[]>(repo, `/repos/${repo.full_name}/pulls?state=open&per_page=100`);
    return pulls.map(toIncoming);
  },
};

export function labelOf(f: Finding): string {
  if (f.severity === "important") {
    return "Important";
  }
  if (f.severity === "nit") {
    return "Nit";
  }
  return "Pre-existing";
}
