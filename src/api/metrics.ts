// Numbers for the dashboard header: where attention is needed now, how the
// flow of changes is moving, and whether the reviewer is pulling its weight.

import { db } from "../db";

export interface Overview {
  generated_at: string;
  model: string;
  counts: Record<string, number>;
  open_total: number;
  lanes: RepoLane[];
  days: DayPoint[];
  review: ReviewMetrics;
  attention: AttentionItem[];
}

export interface RepoLane {
  repo_id: number;
  repo: string;
  provider: string;
  depth: string;
  counts: Record<string, number>;
  total: number;
  oldest_human_wait_hours: number | null;
  open_security: number;
}

export interface DayPoint {
  day: string;
  opened: number;
  merged: number;
  reverted: number;
}

export interface ReviewMetrics {
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
}

export interface AttentionItem {
  id: number;
  repo: string;
  number: number;
  title: string;
  status: string;
  reason: string;
  hours: number;
}

export function overview(orgId: number): Overview {
  const d = db();
  const now = Date.now();

  const statusRows = d
    .query<{ status: string; n: number }, [number]>("SELECT c.status, count(*) AS n FROM changes c JOIN repos r ON r.id = c.repo_id WHERE r.org_id = ? AND c.state = 'open' GROUP BY c.status")
    .all(orgId);
  const counts: Record<string, number> = { queued: 0, reviewing: 0, author: 0, human: 0, ready: 0, blocked: 0 };
  let openTotal = 0;
  for (const r of statusRows) {
    counts[r.status] = r.n;
    openTotal += r.n;
  }

  const laneRows = d
    .query<{ repo_id: number; repo: string; provider: string; depth: string; status: string; n: number; oldest: string | null; sec: number }, [number]>(
      `SELECT r.id AS repo_id, r.full_name AS repo, r.provider, r.depth, c.status, count(*) AS n,
              min(CASE WHEN c.status = 'human' THEN c.waiting_since END) AS oldest,
              sum((SELECT count(*) FROM findings f WHERE f.change_id = c.id AND f.status = 'open' AND f.category IN ('security','data-loss'))) AS sec
       FROM repos r LEFT JOIN changes c ON c.repo_id = r.id AND c.state = 'open'
       WHERE r.org_id = ? GROUP BY r.id, c.status ORDER BY r.full_name`,
    )
    .all(orgId);
  const laneMap = new Map<number, RepoLane>();
  for (const r of laneRows) {
    let lane = laneMap.get(r.repo_id);
    if (!lane) {
      lane = { repo_id: r.repo_id, repo: r.repo, provider: r.provider, depth: r.depth, counts: { queued: 0, reviewing: 0, author: 0, human: 0, ready: 0, blocked: 0 }, total: 0, oldest_human_wait_hours: null, open_security: 0 };
      laneMap.set(r.repo_id, lane);
    }
    if (r.status) {
      lane.counts[r.status] = r.n;
      lane.total += r.n;
      lane.open_security += r.sec ?? 0;
      if (r.oldest) {
        lane.oldest_human_wait_hours = Math.round((now - Date.parse(r.oldest)) / 3600_000);
      }
    }
  }
  const lanes = [...laneMap.values()].sort((a, b) => b.counts.human + b.counts.blocked - (a.counts.human + a.counts.blocked) || b.total - a.total);

  // Fourteen days of flow.
  const days: DayPoint[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const day = new Date(now - i * 86400_000).toISOString().slice(0, 10);
    days.push({ day, opened: 0, merged: 0, reverted: 0 });
  }
  const byDay = new Map(days.map((p) => [p.day, p]));
  for (const r of d.query<{ day: string; n: number }, [number]>("SELECT substr(c.opened_at,1,10) AS day, count(*) AS n FROM changes c JOIN repos r ON r.id = c.repo_id WHERE r.org_id = ? AND c.opened_at >= date('now','-14 days') GROUP BY day").all(orgId)) {
    const p = byDay.get(r.day);
    if (p) {
      p.opened = r.n;
    }
  }
  for (const r of d.query<{ day: string; n: number; rev: number }, [number]>("SELECT substr(c.merged_at,1,10) AS day, count(*) AS n, sum(c.reverted) AS rev FROM changes c JOIN repos r ON r.id = c.repo_id WHERE r.org_id = ? AND c.merged_at >= date('now','-14 days') GROUP BY day").all(orgId)) {
    const p = byDay.get(r.day);
    if (p) {
      p.merged = r.n;
      p.reverted = r.rev;
    }
  }

  // Review quality over the last 30 days of merged changes.
  const merged = d
    .query<{ id: number; rounds: number; reverted: number; human_approvals: number; humans_required: number; opened_at: string; merged_at: string; posted: number }, [number]>(
      `SELECT c.id, c.rounds, c.reverted, c.human_approvals, c.humans_required, c.opened_at, c.merged_at,
              (SELECT coalesce(sum(posted),0) FROM reviews v WHERE v.change_id = c.id) AS posted
       FROM changes c JOIN repos r ON r.id = c.repo_id WHERE r.org_id = ? AND c.state = 'merged' AND c.merged_at >= date('now','-30 days')`,
    )
    .all(orgId);
  const n = merged.length || 1;
  const firstRound = merged.filter((m) => m.rounds <= 1).length;
  const fivePlus = merged.filter((m) => m.rounds >= 5).length;
  const substantive = merged.filter((m) => m.posted > 0).length;
  const meanRounds = merged.reduce((s, m) => s + Math.max(1, m.rounds), 0) / n;
  const approvals = merged.map((m) => m.human_approvals).sort((a, b) => a - b);
  const zeroHuman = merged.filter((m) => m.human_approvals === 0).length;

  const outcomeRows = d
    .query<{ status: string; n: number }, [number]>("SELECT f.status, count(*) AS n FROM findings f JOIN changes c ON c.id = f.change_id JOIN repos r ON r.id = c.repo_id WHERE r.org_id = ? AND f.created_at >= date('now','-30 days') GROUP BY f.status")
    .all(orgId);
  const outcomes: Record<string, number> = { open: 0, fixed: 0, wrong: 0, intentional: 0, irrelevant: 0 };
  for (const r of outcomeRows) {
    outcomes[r.status] = r.n;
  }

  // Wait on a person: open changes in `human` now, plus a sample of merged ones' recorded waits is
  // not stored, so we measure the live queue.
  const waits = d
    .query<{ waiting_since: string }, [number]>("SELECT c.waiting_since FROM changes c JOIN repos r ON r.id = c.repo_id WHERE r.org_id = ? AND c.state = 'open' AND c.status = 'human' AND c.waiting_since IS NOT NULL")
    .all(orgId)
    .map((w) => (now - Date.parse(w.waiting_since)) / 3600_000)
    .sort((a, b) => a - b);

  const tokens = d
    .query<{ tin: number; tout: number }, [number]>("SELECT coalesce(sum(v.tokens_in),0) AS tin, coalesce(sum(v.tokens_out),0) AS tout FROM reviews v JOIN changes c ON c.id = v.change_id JOIN repos r ON r.id = c.repo_id WHERE r.org_id = ? AND v.started_at >= date('now','-30 days')")
    .get(orgId) ?? { tin: 0, tout: 0 };

  const review: ReviewMetrics = {
    merged_30d: merged.length,
    reverted_30d: merged.filter((m) => m.reverted).length,
    revert_rate: merged.filter((m) => m.reverted).length / n,
    first_round_pass_rate: firstRound / n,
    five_plus_rounds_rate: fivePlus / n,
    mean_rounds_to_pass: meanRounds,
    substantive_rate: substantive / n,
    outcomes,
    wait_on_human_hours: { median: quantile(waits, 0.5), p95: quantile(waits, 0.95) },
    humans_per_change: { median: quantile(approvals, 0.5), p95: quantile(approvals, 0.95) },
    zero_human_share: zeroHuman / n,
    tokens_30d: { in: tokens.tin, out: tokens.tout },
  };

  // What needs a person most urgently.
  const attention: AttentionItem[] = d
    .query<{ id: number; repo: string; number: number; title: string; status: string; waiting_since: string | null; sec: number; rounds: number }, [number]>(
      `SELECT c.id, r.full_name AS repo, c.number, c.title, c.status, c.waiting_since, c.rounds,
              (SELECT count(*) FROM findings f WHERE f.change_id = c.id AND f.status = 'open' AND f.category IN ('security','data-loss')) AS sec
       FROM changes c JOIN repos r ON r.id = c.repo_id
       WHERE r.org_id = ? AND c.state = 'open' AND c.status IN ('blocked','human')
       ORDER BY CASE c.status WHEN 'blocked' THEN 0 ELSE 1 END, c.waiting_since ASC LIMIT 8`,
    )
    .all(orgId)
    .map((r) => ({
      id: r.id,
      repo: r.repo,
      number: r.number,
      title: r.title,
      status: r.status,
      hours: r.waiting_since ? Math.round((now - Date.parse(r.waiting_since)) / 3600_000) : 0,
      reason: r.status === "blocked" ? (r.sec > 0 ? `${r.sec} open security finding${r.sec === 1 ? "" : "s"}` : "CI is red") : `Waiting for a reviewer${r.rounds >= 3 ? ` after ${r.rounds} rounds` : ""}`,
    }));

  return { generated_at: new Date().toISOString(), model: "", counts, open_total: openTotal, lanes, days, review, attention };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return Math.round(sorted[idx] * 10) / 10;
}
