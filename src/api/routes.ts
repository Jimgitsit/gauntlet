import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { AuthError, type AuthEnv, COOKIE, clearSessionCookie, destroySession, login, requireUser, setSessionCookie, signup, userForToken } from "../auth";
import { db, nowIso } from "../db";
import { providerFor, webhookProvider } from "../providers";
import { statusFrom } from "../reviewer/engine";
import { appendUnder, ensureRepoWiki, getPage, listPages, putPage, repoWikiDir, wikiSlugFor } from "../reviewer/wiki";
import { activeModel, enqueue, workerStatus } from "../reviewer/worker";
import type { Change, Finding, IncomingChange, Repo, Review } from "../types";
import { overview } from "./metrics";

export const api = new Hono<AuthEnv>();

api.get("/health", (c) => c.json({ ok: true, model: activeModel().name, worker: workerStatus() }));

// ---- auth -----------------------------------------------------------------

api.post("/auth/signup", async (c) => {
  const body = await c.req.json<{ email: string; password: string; name: string; orgName: string }>();
  try {
    const { user, token } = await signup(body);
    setSessionCookie(c, token);
    return c.json({ user: userForToken(token) ?? user });
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
});

api.post("/auth/login", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  try {
    const { token } = await login(body.email, body.password);
    setSessionCookie(c, token);
    return c.json({ user: userForToken(token) });
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
});

api.post("/auth/logout", (c) => {
  destroySession(getCookie(c, COOKIE));
  clearSessionCookie(c);
  return c.json({ ok: true });
});

api.get("/auth/me", (c) => {
  const user = userForToken(getCookie(c, COOKIE));
  return c.json({ user });
});

// ---- webhooks (no session; verified per repo) ------------------------------

api.post("/webhooks/:provider/:repoId", async (c) => {
  const provider = webhookProvider(c.req.param("provider"));
  const repo = db().query<Repo, [number]>("SELECT * FROM repos WHERE id = ?").get(Number(c.req.param("repoId")));
  if (!provider || !repo || repo.provider !== provider.name) {
    return c.json({ error: "unknown repo" }, 404);
  }
  const raw = await c.req.text();
  if (!provider.verifyWebhook(repo.webhook_secret, c.req.raw.headers, raw)) {
    db().run("INSERT INTO webhook_events (repo_id, provider, event, accepted, note) VALUES (?, ?, ?, 0, 'bad signature')", [repo.id, provider.name, c.req.header("x-github-event") ?? c.req.header("x-gitlab-event") ?? ""]);
    return c.json({ error: "signature mismatch" }, 401);
  }
  let parsed: ReturnType<typeof provider.parseWebhook>;
  try {
    parsed = provider.parseWebhook(c.req.raw.headers, JSON.parse(raw));
  } catch {
    return c.json({ error: "body is not JSON" }, 400);
  }
  if (!parsed) {
    return c.json({ ignored: true });
  }
  let note = "";
  if (parsed.change) {
    const id = upsertChange(repo, parsed.change);
    if (parsed.change.state === "open" && ["opened", "synchronize", "reopened", "ready_for_review", "open", "update", "reopen"].includes(parsed.action)) {
      enqueue(id, `${parsed.event}:${parsed.action}`);
      note = "queued";
    } else {
      note = parsed.change.state;
    }
  } else if (parsed.ci) {
    db().run("UPDATE changes SET ci_state = ?, updated_at = ? WHERE repo_id = ? AND head_sha = ?", [parsed.ci.state, nowIso(), repo.id, parsed.ci.head_sha]);
    const affected = db().query<Change, [number, string]>("SELECT * FROM changes WHERE repo_id = ? AND head_sha = ?").all(repo.id, parsed.ci.head_sha);
    for (const ch of affected) {
      recomputeStatus(ch.id);
    }
    note = `ci ${parsed.ci.state}`;
  }
  db().run("INSERT INTO webhook_events (repo_id, provider, event, action, number, accepted, note) VALUES (?, ?, ?, ?, ?, 1, ?)", [repo.id, provider.name, parsed.event, parsed.action, parsed.change?.number ?? null, note]);
  return c.json({ ok: true, note });
});

// ---- everything below needs a session --------------------------------------

api.use("/*", requireUser);

api.get("/overview", (c) => c.json(overview(c.get("user").org_id)));

api.get("/changes", (c) => {
  const orgId = c.get("user").org_id;
  const state = c.req.query("state") ?? "open";
  const limit = Math.min(Number(c.req.query("limit") ?? 10000), 10000);
  const rows = db()
    .query<ChangeRow, [number, string, number]>(
      `SELECT c.id, c.repo_id, r.full_name AS repo, c.number, c.title, c.author, c.author_is_agent, c.html_url, c.state, c.status, c.risk_tier,
              c.humans_required, c.human_approvals, c.ci_state, c.additions, c.deletions, c.files_changed, c.rounds, c.opened_at, c.updated_at,
              c.merged_at, c.reverted, c.waiting_since,
              (SELECT count(*) FROM findings f WHERE f.change_id = c.id AND f.status = 'open' AND f.severity = 'important') AS open_important,
              (SELECT count(*) FROM findings f WHERE f.change_id = c.id AND f.status = 'open' AND f.severity = 'nit') AS open_nit,
              (SELECT count(*) FROM findings f WHERE f.change_id = c.id AND f.status = 'open' AND f.severity = 'pre-existing') AS open_pre,
              (SELECT count(*) FROM findings f WHERE f.change_id = c.id AND f.status = 'open' AND f.category IN ('security','data-loss')) AS open_security
       FROM changes c JOIN repos r ON r.id = c.repo_id
       WHERE r.org_id = ? AND c.state = ?
       ORDER BY c.updated_at DESC LIMIT ?`,
    )
    .all(orgId, state, limit);
  return c.json({ changes: rows });
});

api.get("/changes/:id", (c) => {
  const orgId = c.get("user").org_id;
  const change = db().query<Change, [number]>("SELECT * FROM changes WHERE id = ?").get(Number(c.req.param("id")));
  const repo = change ? db().query<Repo, [number, number]>("SELECT * FROM repos WHERE id = ? AND org_id = ?").get(change.repo_id, orgId) : null;
  if (!change || !repo) {
    return c.json({ error: "not found" }, 404);
  }
  const reviews = db().query<Review, [number]>("SELECT * FROM reviews WHERE change_id = ? ORDER BY round DESC").all(change.id);
  const findings = db().query<Finding, [number]>("SELECT * FROM findings WHERE change_id = ? ORDER BY id").all(change.id);
  const { access_token: _t, webhook_secret: _s, ...safeRepo } = repo;
  return c.json({ change, repo: safeRepo, reviews, findings });
});

api.post("/changes/:id/review", (c) => {
  const ch = ownedChange(c.get("user").org_id, Number(c.req.param("id")));
  if (!ch) {
    return c.json({ error: "not found" }, 404);
  }
  enqueue(ch.id, "requested from dashboard");
  return c.json({ ok: true });
});

api.post("/changes/:id/approve", (c) => {
  const ch = ownedChange(c.get("user").org_id, Number(c.req.param("id")));
  if (!ch) {
    return c.json({ error: "not found" }, 404);
  }
  // One approval per person: a second click, or a replayed request, changes nothing.
  const inserted = db().run("INSERT OR IGNORE INTO approvals (change_id, user_id) VALUES (?, ?)", [ch.id, c.get("user").id]).changes;
  if (inserted === 0) {
    return c.json({ ok: true, already: true });
  }
  db().run("UPDATE changes SET human_approvals = human_approvals + 1, updated_at = ? WHERE id = ?", [nowIso(), ch.id]);
  recomputeStatus(ch.id);
  return c.json({ ok: true });
});

api.post("/findings/:id/resolve", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ status: "fixed" | "wrong" | "intentional" | "irrelevant"; note?: string }>();
  const f = db().query<Finding, [number]>("SELECT * FROM findings WHERE id = ?").get(Number(c.req.param("id")));
  const ch = f ? ownedChange(user.org_id, f.change_id) : null;
  if (!f || !ch) {
    return c.json({ error: "not found" }, 404);
  }
  if (!["fixed", "wrong", "intentional", "irrelevant"].includes(body.status)) {
    return c.json({ error: "status must be fixed, wrong, intentional or irrelevant" }, 400);
  }
  if (body.status !== "fixed" && !(body.note ?? "").trim()) {
    return c.json({ error: "Give a reason when resolving without a fix." }, 400);
  }
  db().run("UPDATE findings SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", [body.status, body.note ?? "", user.name, nowIso(), f.id]);
  recomputeStatus(ch.id);
  // Memory: a dismissal teaches the reviewer something for next time.
  if (body.status === "wrong" || body.status === "intentional") {
    const repo = db().query<Repo, [number]>("SELECT * FROM repos WHERE id = ?").get(ch.repo_id) as Repo;
    const learned = await activeModel().distill(repo.full_name, { title: f.title, body: f.body, path: f.path, status: body.status, note: body.note ?? "" });
    for (const l of learned.value) {
      const path = `${repoWikiDir(repo)}/${l.page}`;
      const heading = l.page === "REVIEW.md" ? "Do not flag" : "Conventions";
      appendUnder(user.org_id, path, path, heading, l.line, "reviewer", `learned from #${ch.number}: ${f.title}`);
    }
    return c.json({ ok: true, learned: learned.value });
  }
  return c.json({ ok: true, learned: [] });
});

// ---- repos -----------------------------------------------------------------

api.get("/repos", (c) => {
  const rows = db()
    .query<Repo & { open_count: number; webhook_url: string }, [number]>(
      `SELECT r.id, r.org_id, r.provider, r.full_name, r.default_branch, r.depth, r.trusted_authors, r.sensitive_paths, r.html_url,
              (r.access_token <> '') AS has_token, (r.webhook_secret <> '') AS has_secret,
              (SELECT count(*) FROM changes c WHERE c.repo_id = r.id AND c.state = 'open') AS open_count
       FROM repos r WHERE r.org_id = ? ORDER BY r.full_name`,
    )
    .all(c.get("user").org_id);
  return c.json({ repos: rows });
});

api.post("/repos", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<Partial<Repo>>();
  if (!body.full_name || !/^[\w.-]+(\/[\w.-]+)+$/.test(body.full_name)) {
    return c.json({ error: "Repository must look like owner/name." }, 400);
  }
  const provider = body.provider === "gitlab" ? "gitlab" : "github";
  const html_url = body.html_url || (provider === "gitlab" ? `https://gitlab.com/${body.full_name}` : `https://github.com/${body.full_name}`);
  const secret = crypto.randomUUID().replace(/-/g, "");
  try {
    const id = Number(
      db().run(
        "INSERT INTO repos (org_id, provider, full_name, default_branch, depth, trusted_authors, sensitive_paths, webhook_secret, access_token, html_url, wiki_slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [user.org_id, provider, body.full_name, body.default_branch || "main", body.depth || "standard", JSON.stringify(parseList(body.trusted_authors)), JSON.stringify(parseList(body.sensitive_paths)), secret, body.access_token || "", html_url, wikiSlugFor(user.org_id, body.full_name)],
      ).lastInsertRowid,
    );
    const repo = db().query<Repo, [number]>("SELECT * FROM repos WHERE id = ?").get(id) as Repo;
    ensureRepoWiki(repo);
    return c.json({ id, webhook_secret: secret });
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      return c.json({ error: "That repository is already connected." }, 400);
    }
    throw err;
  }
});

api.patch("/repos/:id", async (c) => {
  const repo = ownedRepo(c.get("user").org_id, Number(c.req.param("id")));
  if (!repo) {
    return c.json({ error: "not found" }, 404);
  }
  const body = await c.req.json<Partial<Repo>>();
  db().run(
    "UPDATE repos SET depth = ?, trusted_authors = ?, sensitive_paths = ?, default_branch = ?, access_token = CASE WHEN ? = '' THEN access_token ELSE ? END WHERE id = ?",
    [
      body.depth && ["quick", "standard", "deep"].includes(body.depth) ? body.depth : repo.depth,
      JSON.stringify(parseList(body.trusted_authors ?? repo.trusted_authors)),
      JSON.stringify(parseList(body.sensitive_paths ?? repo.sensitive_paths)),
      body.default_branch || repo.default_branch,
      body.access_token ?? "",
      body.access_token ?? "",
      repo.id,
    ],
  );
  return c.json({ ok: true });
});

api.post("/repos/:id/import", async (c) => {
  const repo = ownedRepo(c.get("user").org_id, Number(c.req.param("id")));
  if (!repo) {
    return c.json({ error: "not found" }, 404);
  }
  const incoming = await providerFor(repo).listOpenChanges(repo);
  let queued = 0;
  for (const ch of incoming) {
    const id = upsertChange(repo, ch);
    enqueue(id, "imported");
    queued += 1;
  }
  return c.json({ imported: incoming.length, queued });
});

api.get("/repos/:id/events", (c) => {
  const repo = ownedRepo(c.get("user").org_id, Number(c.req.param("id")));
  if (!repo) {
    return c.json({ error: "not found" }, 404);
  }
  const events = db().query("SELECT * FROM webhook_events WHERE repo_id = ? ORDER BY id DESC LIMIT 50").all(repo.id);
  return c.json({ events });
});

// ---- wiki -------------------------------------------------------------------

api.get("/wiki", (c) => {
  const orgId = c.get("user").org_id;
  const log = db().query("SELECT * FROM wiki_log WHERE org_id = ? ORDER BY id DESC LIMIT 100").all(orgId);
  return c.json({ pages: listPages(orgId), log });
});

api.get("/wiki/page", (c) => {
  const page = getPage(c.get("user").org_id, c.req.query("path") ?? "index.md");
  if (!page) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ page });
});

api.put("/wiki/page", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ path: string; title?: string; content: string }>();
  if (!body.path || !/^[\w./-]+\.md$/.test(body.path) || body.path.includes("..")) {
    return c.json({ error: "Path must be a .md file inside the wiki." }, 400);
  }
  const title = body.title || /^#\s+(.+)$/m.exec(body.content)?.[1] || body.path;
  putPage(user.org_id, body.path, title, body.content, user.name, "edited in dashboard");
  return c.json({ ok: true });
});

// ---- helpers ----------------------------------------------------------------

interface ChangeRow {
  id: number;
  repo_id: number;
  repo: string;
  number: number;
  title: string;
  author: string;
  author_is_agent: number;
  html_url: string;
  state: string;
  status: string;
  risk_tier: string | null;
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

function parseList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      // comma or newline separated
    }
    return v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function ownedChange(orgId: number, id: number): Change | null {
  return db().query<Change, [number, number]>("SELECT c.* FROM changes c JOIN repos r ON r.id = c.repo_id WHERE c.id = ? AND r.org_id = ?").get(id, orgId);
}

function ownedRepo(orgId: number, id: number): Repo | null {
  return db().query<Repo, [number, number]>("SELECT * FROM repos WHERE id = ? AND org_id = ?").get(id, orgId);
}

/** Insert or update a change from a provider payload; returns its id. */
export function upsertChange(repo: Repo, ch: IncomingChange): number {
  const d = db();
  const existing = d.query<Change, [number, number]>("SELECT * FROM changes WHERE repo_id = ? AND number = ?").get(repo.id, ch.number);
  if (existing) {
    const shaChanged = existing.head_sha !== ch.head_sha;
    d.run(
      `UPDATE changes SET title = ?, body = ?, author = ?, author_is_agent = ?, html_url = ?, state = ?, head_sha = ?, base_branch = ?, additions = ?, deletions = ?, files_changed = ?,
         updated_at = ?, merged_at = ?, ci_state = CASE WHEN ? THEN 'pending' ELSE ci_state END, status = CASE WHEN ? = 'open' THEN status ELSE status END
       WHERE id = ?`,
      [ch.title, ch.body, ch.author, ch.author_is_agent ? 1 : 0, ch.html_url, ch.state, ch.head_sha, ch.base_branch, ch.additions, ch.deletions, ch.files_changed, ch.updated_at || nowIso(), ch.merged_at, shaChanged ? 1 : 0, ch.state, existing.id],
    );
    return existing.id;
  }
  return Number(
    d.run(
      `INSERT INTO changes (repo_id, number, title, body, author, author_is_agent, html_url, state, status, head_sha, base_branch, additions, deletions, files_changed, opened_at, updated_at, merged_at, waiting_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [repo.id, ch.number, ch.title, ch.body, ch.author, ch.author_is_agent ? 1 : 0, ch.html_url, ch.state, ch.head_sha, ch.base_branch, ch.additions, ch.deletions, ch.files_changed, ch.opened_at || nowIso(), ch.updated_at || nowIso(), ch.merged_at, nowIso()],
    ).lastInsertRowid,
  );
}

/** Re-derive a change's status after a finding resolution, approval or CI event. */
export function recomputeStatus(changeId: number): void {
  const d = db();
  const ch = d.query<Change, [number]>("SELECT * FROM changes WHERE id = ?").get(changeId);
  if (!ch || ch.state !== "open" || ch.status === "queued" || ch.status === "reviewing") {
    return;
  }
  const openNow = d.query<{ severity: string; category: string }, [number]>("SELECT severity, category FROM findings WHERE change_id = ? AND status = 'open'").all(changeId);
  const status = statusFrom({ openNow, ciState: ch.ci_state, humansRequired: ch.humans_required, approvals: ch.human_approvals, round: ch.rounds });
  if (status !== ch.status) {
    d.run("UPDATE changes SET status = ?, waiting_since = ?, updated_at = ? WHERE id = ?", [status, nowIso(), nowIso(), changeId]);
  }
}
