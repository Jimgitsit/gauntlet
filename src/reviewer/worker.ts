// In-process queue worker. Changes land in review_queue (from webhooks, the
// UI, or the seed) and the worker runs reviews with bounded concurrency.

import { config } from "../config";
import { db, nowIso } from "../db";
import { claudeModel } from "./claude";
import { reviewChange } from "./engine";
import { mockModel } from "./mock";
import type { ReviewModel } from "./model";

export function activeModel(): ReviewModel {
  return config.llm === "claude" ? claudeModel : mockModel;
}

const running = new Set<number>();
let timer: ReturnType<typeof setInterval> | null = null;

export function enqueue(changeId: number, reason: string): void {
  db().run("INSERT INTO review_queue (change_id, reason, enqueued_at) VALUES (?, ?, ?) ON CONFLICT (change_id) DO UPDATE SET reason = excluded.reason", [changeId, reason, nowIso()]);
  db().run("UPDATE changes SET status = 'queued', waiting_since = ?, updated_at = ? WHERE id = ? AND state = 'open'", [nowIso(), nowIso(), changeId]);
}

export async function tick(): Promise<void> {
  const free = config.workerConcurrency - running.size;
  if (free <= 0) {
    return;
  }
  const next = db()
    .query<{ change_id: number }, [string, number]>("SELECT q.change_id FROM review_queue q JOIN changes c ON c.id = q.change_id WHERE c.state = 'open' AND q.enqueued_at <= ? ORDER BY q.enqueued_at LIMIT ?")
    .all(nowIso(), free * 2)
    .map((r) => r.change_id)
    .filter((id) => !running.has(id))
    .slice(0, free);
  for (const id of next) {
    running.add(id);
    reviewChange(activeModel(), id)
      .catch((err) => {
        console.error(`[worker] review of change ${id} failed:`, err instanceof Error ? err.message : err);
        backOff(id);
      })
      .finally(() => {
        running.delete(id);
      });
  }
}

// Retry a failed review with growing delays; after MAX_ATTEMPTS at the same sha
// give up, hand the change to a person, and leave the error on the round.
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 30_000;

function backOff(changeId: number): void {
  const d = db();
  const failures =
    d
      .query<{ n: number }, [number]>("SELECT count(*) AS n FROM reviews r WHERE r.change_id = ? AND r.status = 'failed' AND r.head_sha = (SELECT head_sha FROM changes WHERE id = r.change_id)")
      .get(changeId)?.n ?? 1;
  if (failures >= MAX_ATTEMPTS) {
    d.run("DELETE FROM review_queue WHERE change_id = ?", [changeId]);
    d.run("UPDATE changes SET status = 'human', waiting_since = ?, updated_at = ? WHERE id = ? AND state = 'open'", [nowIso(), nowIso(), changeId]);
    console.error(`[worker] change ${changeId} failed ${failures} times at this commit; handed to a person`);
    return;
  }
  const retryAt = new Date(Date.now() + BASE_DELAY_MS * 2 ** (failures - 1)).toISOString();
  d.run("UPDATE review_queue SET enqueued_at = ? WHERE change_id = ?", [retryAt, changeId]);
}

export function startWorker(intervalMs = 1500): void {
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    tick().catch((err) => console.error("[worker] tick failed:", err));
  }, intervalMs);
}

export function workerStatus(): { running: number[]; queued: number } {
  const queued = db().query<{ n: number }, []>("SELECT count(*) AS n FROM review_queue").get()?.n ?? 0;
  return { running: [...running], queued };
}
