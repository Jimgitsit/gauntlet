// Demo data: one org, fourteen repos, a few thousand open changes and a month
// of merged history, with reviews and findings shaped like the engine's output.
// Run: bun run seed   (wipes the database first)

import { rmSync } from "node:fs";
import { config } from "../config";
import { openDb } from "../db";
import { signup } from "../auth";
import { appendUnder, ensureRepoWiki, putPage, wikiSlugFor } from "../reviewer/wiki";
import type { Repo } from "../types";
import { between, hashString, pick, rng } from "./rng";
import { plantedForFiles, scenarioFor } from "./scenarios";

const DEMO_EMAIL = "demo@gauntlet.dev";
const DEMO_PASSWORD = "review-the-gauntlet";

const repos: { provider: "github" | "gitlab"; full_name: string; depth: "quick" | "standard" | "deep"; weight: number; sensitive: string[] }[] = [
  { provider: "github", full_name: "acme/platform", depth: "deep", weight: 9, sensitive: ["src/auth/**", "migrations/**", "infra/**"] },
  { provider: "github", full_name: "acme/web", depth: "standard", weight: 8, sensitive: ["web/src/auth/**"] },
  { provider: "github", full_name: "acme/mobile", depth: "standard", weight: 5, sensitive: [] },
  { provider: "github", full_name: "acme/billing", depth: "deep", weight: 4, sensitive: ["src/api/billing/**", "migrations/**"] },
  { provider: "github", full_name: "acme/search", depth: "standard", weight: 3, sensitive: [] },
  { provider: "github", full_name: "acme/infra", depth: "deep", weight: 3, sensitive: ["**/*.tf", ".github/workflows/**"] },
  { provider: "github", full_name: "acme/docs", depth: "quick", weight: 4, sensitive: [] },
  { provider: "github", full_name: "acme/design-system", depth: "quick", weight: 3, sensitive: [] },
  { provider: "gitlab", full_name: "acme/data/warehouse", depth: "standard", weight: 4, sensitive: ["migrations/**"] },
  { provider: "gitlab", full_name: "acme/data/pipelines", depth: "standard", weight: 4, sensitive: [] },
  { provider: "gitlab", full_name: "acme/ml/ranking", depth: "standard", weight: 3, sensitive: [] },
  { provider: "gitlab", full_name: "acme/ops/runbooks", depth: "quick", weight: 2, sensitive: [] },
  { provider: "github", full_name: "acme/sdk-js", depth: "standard", weight: 2, sensitive: [] },
  { provider: "github", full_name: "acme/sdk-python", depth: "standard", weight: 2, sensitive: [] },
];

const humans = [
  "mira.k", "jonas", "priya-s", "tomasz", "lena.r", "ahmed", "sofia.v", "kenji", "olu", "hannah-b", "diego", "marta", "yusuf", "ines", "rafael", "chen.w", "amara", "lukas", "noor", "petra",
  "tariq", "emil", "zoe.h", "bruno", "kavya", "sven", "nadia", "felix", "ria", "matteo", "aisha", "oskar", "leila", "hugo", "sana", "viktor", "ayla", "jules", "maya", "teo",
];
const bots = ["claude-agent[bot]", "renovate[bot]", "dependabot[bot]"];

const verbs = ["Add", "Fix", "Remove", "Refactor", "Migrate", "Tighten", "Speed up", "Backfill", "Gate", "Retry", "Cache", "Validate", "Log", "Deprecate", "Rename", "Split", "Batch", "Paginate", "Instrument", "Harden"];
const objects = [
  "invoice finalization", "session creation", "the sync worker", "search debounce", "RDS backups", "the retry helper", "the rollback runbook", "user export", "feature flags", "percent formatting",
  "webhook signature checks", "the merge queue", "OAuth token refresh", "the onboarding flow", "dark mode tokens", "pipeline retries", "ranking features", "the rate limiter", "event schemas", "the CLI parser",
  "payment retries", "error pages", "the audit log", "tenant isolation", "the settings cache", "typeahead", "CSV import", "the nightly job", "flaky e2e tests", "the deploy script",
];
const suffixes = ["", "", "", " for enterprise tenants", " behind a flag", " (follow-up)", " after the incident", " in the EU region", " for the new API", " on mobile"];

function title(r: () => number): string {
  return `${pick(r, verbs)} ${pick(r, objects)}${pick(r, suffixes)}`;
}

function body(r: () => number, t: string): string {
  const risks = ["Low: additive and flagged.", "Medium: touches a shared code path.", "High: changes a persisted shape.", "Low: docs only."];
  return `## What\n${t}.\n\n## Testing\n${pick(r, ["Unit tests added.", "Covered by existing tests.", "Manually verified in staging.", "Ran the integration suite."])}\n\n## Risk\n${pick(r, risks)}\n\n## How to revert\nRevert this change; no data migration.`;
}

function sha(r: () => number): string {
  let s = "";
  for (let i = 0; i < 40; i += 1) {
    s += "0123456789abcdef"[Math.floor(r() * 16)];
  }
  return s;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function main(): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${config.dbPath}${suffix}`, { force: true });
  }
  const d = openDb();
  const r = rng(20261029);
  const now = Date.now();
  const DAY = 86400_000;
  const HOUR = 3600_000;

  const { user } = await signup({ email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Demo Lead", orgName: "Acme" });
  const orgId = user.org_id;

  const repoRows: Repo[] = [];
  for (const spec of repos) {
    const id = Number(
      d.run(
        "INSERT INTO repos (org_id, provider, full_name, default_branch, depth, trusted_authors, sensitive_paths, webhook_secret, access_token, html_url, wiki_slug) VALUES (?, ?, ?, 'main', ?, ?, ?, ?, '', ?, ?)",
        [orgId, spec.provider, spec.full_name, spec.depth, JSON.stringify(humans.slice(0, 30)), JSON.stringify(spec.sensitive), crypto.randomUUID().replace(/-/g, ""), `https://${spec.provider}.com/${spec.full_name}`, wikiSlugFor(orgId, spec.full_name)],
      ).lastInsertRowid,
    );
    const repo = d.query<Repo, [number]>("SELECT * FROM repos WHERE id = ?").get(id) as Repo;
    repoRows.push(repo);
    ensureRepoWiki(repo);
  }
  seedWikiContent(orgId, repoRows);

  const insertChange = d.prepare(
    `INSERT INTO changes (repo_id, number, title, body, author, author_is_agent, html_url, state, status, risk_tier, risk_reason, humans_required, human_approvals, ci_state, head_sha, base_branch, additions, deletions, files_changed, rounds, opened_at, updated_at, merged_at, reverted, waiting_since, last_reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertReview = d.prepare(
    "INSERT INTO reviews (change_id, round, head_sha, depth, mode, status, hunters, voters, candidates, posted, summary, tokens_in, tokens_out, started_at, finished_at) VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFinding = d.prepare(
    "INSERT INTO findings (review_id, change_id, severity, category, path, line, title, body, evidence, votes_for, votes_total, status, resolved_by, resolution_note, fixed_in_sha, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  const totalWeight = repos.reduce((s, x) => s + x.weight, 0);
  const OPEN_TARGET = 3200;
  const MERGED_TARGET = 2600;
  const numbers = new Map<number, number>();

  const seedAll = d.transaction(() => {
    for (let i = 0; i < OPEN_TARGET + MERGED_TARGET; i += 1) {
      const isOpen = i < OPEN_TARGET;
      // Pick a repo by weight.
      let roll = r() * totalWeight;
      let idx = 0;
      while (roll > repos[idx].weight) {
        roll -= repos[idx].weight;
        idx += 1;
      }
      const spec = repos[idx];
      const repo = repoRows[idx];
      const number = (numbers.get(repo.id) ?? 1200) + between(r, 1, 3);
      numbers.set(repo.id, number);
      const author = r() < 0.12 ? pick(r, bots) : pick(r, humans);
      const isAgent = author.endsWith("[bot]");
      const t = title(r);
      const plan = config.depth[spec.depth];
      const big = r() < 0.15;
      const files = big ? between(r, 6, 40) : between(r, 1, 5);
      const additions = big ? between(r, 300, 2200) : between(r, 2, 260);
      const deletions = Math.floor(additions * (0.2 + r() * 0.8));
      const headSha = sha(r);
      const key = `${repo.full_name}#${number}@${headSha}`;
      const scenario = scenarioFor(key, Math.max(1, Math.min(files, 4)));
      const planted = plantedForFiles(scenario.files);
      const isDocs = /docs|runbooks|design-system/.test(spec.full_name);
      const riskTier = isDocs && r() < 0.8 ? "low" : /infra|billing|platform|warehouse/.test(spec.full_name) && r() < 0.5 ? "high" : r() < 0.7 ? "medium" : "low";
      const riskReason = riskTier === "high" ? "Touches infrastructure, a migration or a path the owners list as sensitive." : riskTier === "medium" ? "Ordinary product change." : "Docs, copy or additive and flagged.";
      let humansRequired = riskTier === "high" ? 2 : riskTier === "medium" ? 1 : 0;
      if (humansRequired === 0 && (isAgent || !humans.slice(0, 30).includes(author))) {
        humansRequired = 1;
      }

      if (isOpen) {
        const openedAt = now - r() * 21 * DAY;
        const reviewed = r() < 0.96;
        const rounds = reviewed ? (r() < 0.6 ? 1 : r() < 0.8 ? 2 : between(r, 3, 6)) : 0;
        const ci = r() < 0.04 ? "red" : r() < 0.08 ? "pending" : "green";
        const lastReviewed = reviewed ? openedAt + r() * Math.max(HOUR, now - openedAt) : null;
        // Decide which planted findings are still open.
        const survivors = planted.filter((p) => {
          if (p.noise) {
            return false;
          }
          const security = p.category === "security" || p.category === "data-loss";
          // Security findings get fixed fast, so few stay open; the rest linger with the author.
          return r() < (security ? 0.035 : rounds === 1 ? 0.6 : 0.3);
        });
        const openSecurity = survivors.some((s) => s.category === "security" || s.category === "data-loss");
        const hasImportant = survivors.some((s) => s.severity !== "pre-existing");
        const approvals = reviewed ? (r() < 0.55 ? humansRequired : between(r, 0, Math.max(0, humansRequired - 1))) : 0;
        let status: string;
        if (!reviewed) {
          status = "queued";
        } else if (openSecurity || ci === "red") {
          status = "blocked";
        } else if (hasImportant) {
          status = "author";
        } else if (approvals < humansRequired) {
          status = "human";
        } else {
          status = "ready";
        }
        const waitingSince = status === "queued" ? iso(openedAt) : iso((lastReviewed ?? openedAt) + r() * (now - (lastReviewed ?? openedAt)) * 0.5);
        const changeId = Number(
          insertChange.run(
            repo.id, number, t, body(r, t), author, isAgent ? 1 : 0, `${repo.html_url}/${spec.provider === "gitlab" ? "-/merge_requests" : "pull"}/${number}`,
            "open", status, reviewed ? riskTier : null, reviewed ? riskReason : "", humansRequired, approvals, ci, headSha, additions, deletions, files, rounds,
            iso(openedAt), waitingSince, null, 0, waitingSince, lastReviewed ? iso(lastReviewed) : null,
          ).lastInsertRowid,
        );
        if (status === "queued") {
          d.run("INSERT INTO review_queue (change_id, reason, enqueued_at) VALUES (?, 'opened', ?)", [changeId, iso(openedAt)]);
        }
        if (reviewed) {
          seedRounds({ changeId, rounds, planted, survivors, headSha, plan, depth: spec.depth, openedAt, lastReviewed: lastReviewed as number, r, insertReview, insertFinding, merged: false });
        }
      } else {
        const mergedAt = now - r() * 30 * DAY;
        const openedAt = mergedAt - (HOUR * 2 + r() * 6 * DAY);
        const rounds = r() < 0.78 ? 1 : r() < 0.9 ? 2 : r() < 0.985 ? between(r, 3, 4) : between(r, 5, 7);
        const reverted = r() < (rounds >= 3 ? 0.06 : 0.018) ? 1 : 0;
        const approvals = Math.max(humansRequired, r() < 0.1 ? humansRequired + 1 : humansRequired);
        const changeId = Number(
          insertChange.run(
            repo.id, number, t, body(r, t), author, isAgent ? 1 : 0, `${repo.html_url}/${spec.provider === "gitlab" ? "-/merge_requests" : "pull"}/${number}`,
            "merged", "ready", riskTier, riskReason, humansRequired, approvals, "green", headSha, additions, deletions, files, rounds,
            iso(openedAt), iso(mergedAt), iso(mergedAt), reverted, iso(mergedAt), iso(mergedAt - HOUR),
          ).lastInsertRowid,
        );
        const survivors = planted.filter((p) => !p.noise && r() < 0.55);
        seedRounds({ changeId, rounds, planted, survivors, headSha, plan, depth: spec.depth, openedAt, lastReviewed: mergedAt - HOUR, r, insertReview, insertFinding, merged: true });
      }
    }
  });
  seedAll();

  const open = d.query<{ n: number }, []>("SELECT count(*) AS n FROM changes WHERE state = 'open'").get()?.n;
  const merged = d.query<{ n: number }, []>("SELECT count(*) AS n FROM changes WHERE state = 'merged'").get()?.n;
  const findings = d.query<{ n: number }, []>("SELECT count(*) AS n FROM findings").get()?.n;
  const queued = d.query<{ n: number }, []>("SELECT count(*) AS n FROM review_queue").get()?.n;
  console.log(`seeded ${repos.length} repos, ${open} open and ${merged} merged changes, ${findings} findings, ${queued} queued for live review`);
  console.log(`sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

interface RoundArgs {
  changeId: number;
  rounds: number;
  planted: ReturnType<typeof plantedForFiles>;
  survivors: ReturnType<typeof plantedForFiles>;
  headSha: string;
  plan: { hunters: number; voters: number; minVotes: number };
  depth: string;
  openedAt: number;
  lastReviewed: number;
  r: () => number;
  insertReview: ReturnType<ReturnType<typeof openDb>["prepare"]>;
  insertFinding: ReturnType<ReturnType<typeof openDb>["prepare"]>;
  merged: boolean;
}

function seedRounds(a: RoundArgs): void {
  const { r } = a;
  const span = Math.max(1, a.lastReviewed - a.openedAt);
  const real = a.planted.filter((p) => !p.noise);
  for (let round = 1; round <= Math.max(1, a.rounds); round += 1) {
    const startedAt = a.openedAt + (span * (round - 1)) / Math.max(1, a.rounds) + 60_000;
    const finishedAt = startedAt + 90_000 + r() * 600_000;
    const last = round === Math.max(1, a.rounds);
    // Earlier rounds posted things that were then fixed; the last round posted what survives.
    const postedThisRound = last ? a.survivors : real.filter(() => r() < 0.5);
    const candidates = postedThisRound.length + between(r, 0, 3);
    const summary = postedThisRound.length === 0 ? "0 findings. Nothing to fix." : `${postedThisRound.length} finding${postedThisRound.length === 1 ? "" : "s"}, ${postedThisRound.filter((p) => p.severity === "important").length} important. Most severe: ${postedThisRound[0].title} (${postedThisRound[0].path}:${postedThisRound[0].line}).`;
    const tokensIn = (a.plan.hunters + candidates * a.plan.voters) * between(r, 3500, 9000);
    const reviewId = Number(
      a.insertReview.run(a.changeId, round, last ? a.headSha : a.headSha.slice(0, 20) + a.headSha.slice(0, 20), a.depth, round > 2 ? "diff-only" : "full", a.plan.hunters, a.plan.voters, candidates, postedThisRound.length, summary, tokensIn, Math.floor(tokensIn * 0.04), iso(startedAt), iso(finishedAt)).lastInsertRowid,
    );
    for (const p of postedThisRound) {
      const votesFor = between(r, a.plan.minVotes, a.plan.voters);
      let status = "open";
      let resolvedBy = "";
      let note = "";
      let fixedIn = "";
      let resolvedAt: string | null = null;
      if (!last || a.merged) {
        const roll = r();
        status = roll < 0.72 ? "fixed" : roll < 0.84 ? "intentional" : roll < 0.93 ? "wrong" : "irrelevant";
        resolvedBy = status === "fixed" ? "reviewer" : "author";
        note = status === "intentional" ? "Deliberate; documented in the PR." : status === "wrong" ? "The cited line does not run on this path." : status === "irrelevant" ? "Out of scope for this change." : "";
        fixedIn = status === "fixed" ? a.headSha : "";
        resolvedAt = iso(finishedAt + r() * 4 * HOUR_MS);
      }
      a.insertFinding.run(reviewId, a.changeId, p.severity, p.category, p.path, p.line, p.title, p.body, p.evidence, votesFor, a.plan.voters, status, resolvedBy, note, fixedIn, iso(finishedAt), resolvedAt);
    }
  }
}

const HOUR_MS = 3600_000;

function seedWikiContent(orgId: number, repoRows: Repo[]): void {
  const byName = new Map(repoRows.map((x) => [x.full_name, x]));
  const platform = byName.get("acme/platform") as Repo;
  const billing = byName.get("acme/billing") as Repo;
  const web = byName.get("acme/web") as Repo;

  appendUnder(orgId, "platform/conventions.md", "Platform conventions", "Conventions", "Money is integer cents end to end; a float in a money path is a bug, not a nit.", "mira.k", "money convention");
  appendUnder(orgId, "platform/conventions.md", "Platform conventions", "Conventions", "Every event payload is versioned; adding a field is fine, changing a field's meaning needs a new event name.", "jonas", "event versioning");

  appendUnder(orgId, "projects/platform/REVIEW.md", "platform REVIEW.md", "What matters most", "Tenant isolation: any read that drops the viewer argument is important, never a nit.", "mira.k", "tenant isolation rule");
  appendUnder(orgId, "projects/platform/REVIEW.md", "platform REVIEW.md", "Do not flag", "`retry()` in src/lib is called with attempts meaning total tries; the off-by-one was fixed in #1187 and the docstring is right.", "reviewer", "learned from #1187");
  appendUnder(orgId, "projects/platform/incidents.md", "platform incidents", "Cases", "#1042 (2026-09-14): sync worker switched to Promise.all over 5k items, exhausted the pool, 40 min of failed syncs. Review should have caught unbounded parallelism against a capped pool.", "jonas", "incident case");
  appendUnder(orgId, "projects/platform/incidents.md", "platform incidents", "Cases", "#1130 (2026-10-02): export endpoint lost the viewer check; cross-tenant read for 3 hours. Review should have flagged the removed authorization argument as important.", "mira.k", "incident case");

  appendUnder(orgId, "projects/billing/REVIEW.md", "billing REVIEW.md", "What matters most", "Totals: anything that computes or emits an amount must match what is stored on the invoice row.", "priya-s", "billing totals rule");
  appendUnder(orgId, "projects/billing/incidents.md", "billing incidents", "Cases", "#987 (2026-08-21): invoice.finalized emitted pre-tax totals; ledger drifted for 2 days. Review should have compared the event payload with the stored row.", "priya-s", "incident case");
  appendUnder(orgId, "projects/billing/conventions.md", "billing conventions", "Conventions", "Finalizing an invoice re-reads the row before returning it; callers rely on totals being present.", "priya-s", "convention");

  appendUnder(orgId, "projects/web/REVIEW.md", "web REVIEW.md", "What matters most", "Anything rendered with dangerouslySetInnerHTML is important unless the source is a sanitizer in web/src/lib/sanitize.ts.", "lena.r", "xss rule");
  appendUnder(orgId, "projects/web/REVIEW.md", "web REVIEW.md", "Paths to skip", "web/src/generated/", "lena.r", "skip generated");

  putPage(
    orgId,
    "projects/platform/arch/index.md",
    "platform architecture",
    `# Architecture of acme/platform\n\nA Bun + Hono monolith behind the API gateway. Postgres is the system of record; events go out through the outbox table and a relay worker.\n\n## Read this when\n- [workers.md](workers.md): touching anything under src/workers. Explains the pool cap (20) and why batches are chunked.\n- [tenancy.md](tenancy.md): any read or write that takes a viewer. Explains the \`for: viewer\` argument and the 404-not-403 rule.\n`,
    "reviewer",
    "explainer requested by jonas",
  );
  putPage(
    orgId,
    "projects/platform/arch/workers.md",
    "platform workers",
    `# Workers\n\nEvery worker shares one Postgres pool capped at 20 connections (src/db/pool.ts). Batches from the queue carry up to 5,000 items, so any per-item query must run through \`mapLimit(items, 8, fn)\` from src/lib/async.ts, never \`Promise.all\`.\n\nUpserts are find-then-write and are not transactional; concurrent workers on the same id are prevented upstream by the queue's partition key, not by the database.\n`,
    "reviewer",
    "explainer requested by jonas",
  );
  putPage(
    orgId,
    "projects/platform/arch/tenancy.md",
    "platform tenancy",
    `# Tenancy\n\nEvery repository method that reads tenant data takes \`{ for: viewer }\`. The method applies the tenant filter and returns null for rows the viewer cannot see, so handlers answer 404 rather than 403 and never confirm existence.\n\nDropping the argument compiles (it is optional for internal jobs) and silently removes the filter. Review treats a removed viewer argument on a request path as important.\n`,
    "reviewer",
    "explainer requested by mira.k",
  );
  appendUnder(orgId, "users/mira.k/environment.md", "mira.k environment", "Environment", "macOS, zsh. Clones under ~/src. Runs platform on :3000 and web on :5173 locally.", "mira.k", "personal environment");
  void platform;
  void billing;
  void web;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
