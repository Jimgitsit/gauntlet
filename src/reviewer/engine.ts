// The review pipeline for one change, one round:
//
//   load context -> hunters in parallel -> dedupe -> voters per candidate
//   -> filter + rank -> post -> classify risk -> set status -> write memory
//
// Mirrors the layered process in "How the Claude Code team does code review":
// several agents look for bugs, a separate group votes on each finding, and
// only survivors are posted, tagged Important / Nit / Pre-existing.

import { config, type Depth } from "../config";
import { db, nowIso } from "../db";
import { matchGlob } from "../lib/glob";
import { providerFor } from "../providers";
import type { Change, ChangeStatus, Finding, Repo } from "../types";
import type { Candidate, ReviewContext, ReviewModel } from "./model";
import { appendLog, guidanceFor } from "./wiki";

export interface ReviewOutcome {
  reviewId: number;
  candidates: number;
  posted: number;
  status: ChangeStatus;
  summary: string;
}

type Scored = Candidate & { votesFor: number; votesTotal: number; preExisting: boolean };

export async function reviewChange(model: ReviewModel, changeId: number): Promise<ReviewOutcome> {
  const d = db();
  const change = d.query<Change, [number]>("SELECT * FROM changes WHERE id = ?").get(changeId);
  if (!change) {
    throw new Error(`change ${changeId} not found`);
  }
  const repo = d.query<Repo, [number]>("SELECT * FROM repos WHERE id = ?").get(change.repo_id);
  if (!repo) {
    throw new Error(`repo ${change.repo_id} not found`);
  }
  const provider = providerFor(repo);
  const depth = (repo.depth in config.depth ? repo.depth : "standard") as Depth;
  const plan = config.depth[depth];
  const round = change.rounds + 1;
  const mode: "full" | "diff-only" = round > 2 ? "diff-only" : "full";

  const startedAt = nowIso();
  const reviewId = Number(
    d.run(
      "INSERT INTO reviews (change_id, round, head_sha, depth, mode, status, hunters, voters, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)",
      [change.id, round, change.head_sha, depth, mode, plan.hunters, plan.voters, startedAt],
    ).lastInsertRowid,
  );
  d.run("UPDATE changes SET status = 'reviewing', waiting_since = ?, updated_at = ? WHERE id = ?", [startedAt, startedAt, change.id]);

  let tokensIn = 0;
  let tokensOut = 0;
  const count = (u: { tokensIn: number; tokensOut: number }) => {
    tokensIn += u.tokensIn;
    tokensOut += u.tokensOut;
  };

  try {
    // 1. Context: the diff, repo guidance, what we already said.
    const diff = await provider.getDiff(repo, change);
    const claudeMd = (await provider.getFile(repo, "CLAUDE.md", change.head_sha)) ?? "";
    const wiki = guidanceFor(repo);
    const prior = d.query<Finding, [number]>("SELECT * FROM findings WHERE change_id = ? ORDER BY id").all(change.id);
    const ctx: ReviewContext = {
      repoFullName: repo.full_name,
      changeTitle: change.title,
      changeBody: change.body,
      author: change.author,
      round,
      mode,
      diff,
      guidance: { claudeMd, ...wiki },
      alreadyPosted: prior.map((f) => f.title),
    };

    // 2. Hunters look for bugs in parallel.
    const hunts = await Promise.all(Array.from({ length: plan.hunters }, (_, i) => model.hunt(ctx, i)));
    const candidates: Candidate[] = [];
    for (const h of hunts) {
      count(h.usage);
      candidates.push(...h.value);
    }
    const unique = dedupe(candidates);

    // 3. Voters confirm each candidate; a finding posts only with enough agreement.
    const scored: Scored[] = [];
    for (const batch of chunk(unique, 4)) {
      const results = await Promise.all(
        batch.map(async (c) => {
          const votes = await Promise.all(Array.from({ length: plan.voters }, (_, i) => model.vote(ctx, c, i)));
          let votesFor = 0;
          const severities: Record<string, number> = {};
          for (const v of votes) {
            count(v.usage);
            if (v.value.real) {
              votesFor += 1;
              severities[v.value.severity] = (severities[v.value.severity] ?? 0) + 1;
            }
          }
          const file = diff.find((f) => f.path === c.path);
          const preExisting = c.severity === "pre-existing" || (c.line !== null && file !== undefined && !file.changedLines.includes(c.line));
          const severity = preExisting ? "pre-existing" : majority(severities, c.severity);
          return { ...c, severity, votesFor, votesTotal: votes.length, preExisting } as Scored;
        }),
      );
      scored.push(...results);
    }

    // 4. Filter: agreement threshold, style drop, no repeats, nit cap, skip paths.
    const skipPaths = skipPathsFrom(wiki.reviewMd);
    const maxNits = maxNitsFrom(wiki.reviewMd);
    // A finding that was fixed and comes back is a regression, not a repeat.
    const priorTitles = new Set(prior.filter((f) => f.status !== "fixed").map((f) => `${f.path}::${f.title.toLowerCase()}`));
    let survivors = scored
      .filter((s) => s.votesFor >= plan.minVotes)
      .filter((s) => s.category !== "style")
      .filter((s) => !skipPaths.some((g) => matchGlob(g, s.path)))
      .filter((s) => !priorTitles.has(`${s.path}::${s.title.toLowerCase()}`));
    survivors.sort((a, b) => rank(a) - rank(b) || b.votesFor - a.votesFor);
    let nits = 0;
    survivors = survivors.filter((s) => {
      if (s.severity !== "nit") {
        return true;
      }
      nits += 1;
      return nits <= maxNits;
    });

    // 5. Prior open findings not found again at this sha are taken as fixed.
    const reFound = new Set(scored.filter((s) => s.votesFor >= plan.minVotes).map((s) => `${s.path}::${s.title.toLowerCase()}`));
    for (const f of prior.filter((x) => x.status === "open")) {
      const postedAt = reviewHeadSha(d, f.review_id);
      if (postedAt !== change.head_sha && !reFound.has(`${f.path}::${f.title.toLowerCase()}`)) {
        d.run("UPDATE findings SET status = 'fixed', fixed_in_sha = ?, resolved_by = 'reviewer', resolved_at = ? WHERE id = ?", [change.head_sha, nowIso(), f.id]);
      }
    }

    // 6. Store and post.
    const insert = d.prepare(
      "INSERT INTO findings (review_id, change_id, severity, category, path, line, title, body, evidence, votes_for, votes_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const posted: Finding[] = [];
    for (const s of survivors) {
      const id = Number(insert.run(reviewId, change.id, s.severity, s.category, s.path, s.line, s.title, s.body, s.evidence, s.votesFor, s.votesTotal).lastInsertRowid);
      posted.push(d.query<Finding, [number]>("SELECT * FROM findings WHERE id = ?").get(id) as Finding);
    }
    const summaryRes = await model.summarize(ctx, survivors);
    count(summaryRes.usage);
    let summary = summaryRes.value;
    if (round >= config.roundCap && survivors.length > 0) {
      summary += ` This is round ${round}; consider stepping back and reconsidering the approach rather than patching finding by finding.`;
    }
    await provider.postFindings(repo, change, posted, summary);

    // 7. Risk tier, once per change (the change decides, not the author).
    let riskTier = change.risk_tier;
    let riskReason = change.risk_reason;
    let humansRequired = change.humans_required;
    if (!riskTier) {
      const sensitive = JSON.parse(repo.sensitive_paths || "[]") as string[];
      const verdict = await model.classifyRisk(ctx, sensitive);
      count(verdict.usage);
      const trusted = (JSON.parse(repo.trusted_authors || "[]") as string[]).includes(change.author);
      const alwaysPerson = diff.some((f) => /^\.github\/workflows\/|^\.gitlab-ci\.yml$/.test(f.path) || sensitive.some((g) => matchGlob(g, f.path)));
      riskTier = verdict.value.tier;
      riskReason = verdict.value.reason;
      humansRequired = riskTier === "high" ? 2 : riskTier === "medium" ? 1 : 0;
      if ((verdict.value.needs_person_anyway || alwaysPerson || !trusted) && humansRequired === 0) {
        humansRequired = 1;
        riskReason += trusted ? " A person must look anyway." : " Author is not on the trusted list, so a person must look.";
      }
      if (change.author_is_agent && humansRequired === 0) {
        humansRequired = 1;
        riskReason += " Agent-authored: the person who directed it counts as the reviewer.";
      }
    }

    // 8. Status from what is open now. CI, approvals and the head sha may have
    // moved while the agents were running, so read them fresh rather than from
    // the snapshot taken at the start.
    const fresh = d.query<{ head_sha: string; ci_state: string; human_approvals: number }, [number]>("SELECT head_sha, ci_state, human_approvals FROM changes WHERE id = ?").get(change.id) ?? change;
    const newCommits = fresh.head_sha !== change.head_sha;
    const openNow = d.query<{ severity: string; category: string }, [number]>("SELECT severity, category FROM findings WHERE change_id = ? AND status = 'open'").all(change.id);
    const status = newCommits ? "queued" : statusFrom({ openNow, ciState: fresh.ci_state, humansRequired, approvals: fresh.human_approvals, round });
    const finishedAt = nowIso();
    d.run(
      "UPDATE reviews SET status = 'done', candidates = ?, posted = ?, summary = ?, tokens_in = ?, tokens_out = ?, finished_at = ? WHERE id = ?",
      [unique.length, survivors.length, summary, tokensIn, tokensOut, finishedAt, reviewId],
    );
    d.run(
      "UPDATE changes SET status = ?, rounds = ?, risk_tier = ?, risk_reason = ?, humans_required = ?, last_reviewed_at = ?, waiting_since = ?, updated_at = ? WHERE id = ?",
      [status, round, riskTier, riskReason, humansRequired, finishedAt, finishedAt, finishedAt, change.id],
    );
    if (!newCommits) {
      d.run("DELETE FROM review_queue WHERE change_id = ?", [change.id]);
    }

    // 9. Memory: the repo log records every round.
    appendLog(repo.org_id, repo, `#${change.number} round ${round}: ${survivors.length} finding${survivors.length === 1 ? "" : "s"} from ${unique.length} candidate${unique.length === 1 ? "" : "s"} (${depth}, ${mode}).`);

    return { reviewId, candidates: unique.length, posted: survivors.length, status, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    d.run("UPDATE reviews SET status = 'failed', error = ?, finished_at = ?, tokens_in = ?, tokens_out = ? WHERE id = ?", [message, nowIso(), tokensIn, tokensOut, reviewId]);
    d.run("UPDATE changes SET status = 'queued', updated_at = ? WHERE id = ?", [nowIso(), change.id]);
    throw err;
  }
}

export function statusFrom(input: { openNow: { severity: string; category: string }[]; ciState: string; humansRequired: number; approvals: number; round: number }): ChangeStatus {
  const { openNow, ciState, humansRequired, approvals } = input;
  const security = openNow.some((f) => f.category === "security" || f.category === "data-loss");
  if (security || ciState === "red") {
    return "blocked";
  }
  if (openNow.some((f) => f.severity === "important" || f.severity === "nit")) {
    return "author";
  }
  if (approvals < humansRequired) {
    return "human";
  }
  return "ready";
}

function rank(s: Scored): number {
  if (s.severity === "important") {
    return s.category === "security" || s.category === "data-loss" ? 0 : 1;
  }
  if (s.severity === "nit") {
    return 2;
  }
  return 3;
}

function majority(counts: Record<string, number>, fallback: Candidate["severity"]): Candidate["severity"] {
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  return (best as Candidate["severity"] | null) ?? fallback;
}

/** Merge candidates that point at the same place and say roughly the same thing. */
export function dedupe(candidates: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of candidates) {
    const dup = out.find((o) => o.path === c.path && near(o.line, c.line) && similar(o.title, c.title));
    if (!dup) {
      out.push(c);
    }
  }
  return out;
}

function near(a: number | null, b: number | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return Math.abs(a - b) <= 3;
}

function similar(a: string, b: string): boolean {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (wa.size === 0 || wb.size === 0) {
    return a.toLowerCase() === b.toLowerCase();
  }
  let shared = 0;
  for (const w of wa) {
    if (wb.has(w)) {
      shared += 1;
    }
  }
  return shared / Math.min(wa.size, wb.size) >= 0.5;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function skipPathsFrom(reviewMd: string): string[] {
  const section = /## Paths to skip\n([\s\S]*?)(\n## |$)/.exec(reviewMd);
  if (!section) {
    return [];
  }
  return section[1]
    .split("\n")
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean)
    .map((p) => (p.endsWith("/") ? `${p}**` : p));
}

function maxNitsFrom(reviewMd: string): number {
  const m = /at most (\w+) nits/i.exec(reviewMd);
  if (!m) {
    return 3;
  }
  const words: Record<string, number> = { zero: 0, no: 0, one: 1, two: 2, three: 3, four: 4, five: 5 };
  const n = words[m[1].toLowerCase()] ?? Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 3;
}

function reviewHeadSha(d: ReturnType<typeof db>, reviewId: number): string {
  return d.query<{ head_sha: string }, [number]>("SELECT head_sha FROM reviews WHERE id = ?").get(reviewId)?.head_sha ?? "";
}
