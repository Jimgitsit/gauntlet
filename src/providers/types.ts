import type { Change, DiffFile, Finding, IncomingChange, Provider, Repo } from "../types";

/** What a webhook delivery turned into, after provider-specific parsing. */
export interface WebhookResult {
  provider: Provider;
  event: string;
  action: string;
  repoFullName: string;
  /** Present for pull/merge request events we act on. */
  change?: IncomingChange;
  /** Present for CI status events. */
  ci?: { head_sha: string; state: "pending" | "green" | "red" };
}

export interface ChangeProvider {
  readonly name: Provider | "mock";
  /** Check the delivery signature. Returns false on mismatch. */
  verifyWebhook(secret: string, headers: Headers, rawBody: string): boolean;
  /** Turn a delivery into a normalized result, or null if we ignore the event. */
  parseWebhook(headers: Headers, body: unknown): WebhookResult | null;
  /** The change's diff, one entry per file. */
  getDiff(repo: Repo, change: Change): Promise<DiffFile[]>;
  /** A file at a ref, or null when absent. Used for CLAUDE.md and REVIEW.md. */
  getFile(repo: Repo, path: string, ref: string): Promise<string | null>;
  /** Post the surviving findings as inline comments plus a summary. */
  postFindings(repo: Repo, change: Change, findings: Finding[], summary: string): Promise<void>;
  /** List currently open changes, for the initial import when a repo is connected. */
  listOpenChanges(repo: Repo): Promise<IncomingChange[]>;
}
