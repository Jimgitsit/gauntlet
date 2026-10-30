import type { Status } from "./api";

export const STATUS_ORDER: Status[] = ["blocked", "human", "ready", "reviewing", "author", "queued"];

export const STATUS_LABEL: Record<Status, string> = {
  blocked: "Blocked",
  human: "Needs a reviewer",
  ready: "Ready to merge",
  reviewing: "Reviewing",
  author: "Waiting on author",
  queued: "Queued",
};

export const STATUS_HINT: Record<Status, string> = {
  blocked: "Open security finding or red CI",
  human: "Reviewer found nothing; a person must approve",
  ready: "Clean and approved",
  reviewing: "Agents are reading it now",
  author: "Findings the author has not answered",
  queued: "Waiting for a review slot",
};

export function ago(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const ms = Date.now() - Date.parse(iso);
  const m = Math.round(ms / 60000);
  if (m < 1) {
    return "now";
  }
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.round(m / 60);
  if (h < 48) {
    return `${h}h`;
  }
  return `${Math.round(h / 24)}d`;
}

export function hours(h: number): string {
  if (h < 1) {
    return "<1h";
  }
  if (h < 48) {
    return `${Math.round(h)}h`;
  }
  return `${Math.round(h / 24)}d`;
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function compact(n: number): string {
  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1)}B`;
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 10_000) {
    return `${Math.round(n / 1000)}k`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

export function shortRepo(fullName: string): string {
  const parts = fullName.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : fullName;
}
