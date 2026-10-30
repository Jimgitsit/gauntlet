// A provider for demos: diffs come from deterministic scenarios and "posting"
// just records that it happened.

import type { Repo } from "../types";
import { scenarioFor } from "../seed/scenarios";
import { changedLinesOf } from "./diff";
import type { ChangeProvider } from "./types";

export const mockPosted: { repo: string; number: number; count: number; at: string }[] = [];

export const mock: ChangeProvider = {
  name: "mock",
  verifyWebhook() {
    return true;
  },
  parseWebhook() {
    return null;
  },
  async getDiff(repo, change) {
    const s = scenarioFor(`${repo.full_name}#${change.number}@${change.head_sha}`, Math.max(1, Math.min(change.files_changed, 4)));
    return s.files.map((f) => ({ ...f, changedLines: changedLinesOf(f.patch) }));
  },
  async getFile(_repo: Repo, path) {
    if (path === "CLAUDE.md") {
      return "# Conventions\n\n- TypeScript strict. No `any`.\n- Every new flag ships off.\n- Money is integer cents; never floats.\n";
    }
    return null;
  },
  async postFindings(repo, change, findings) {
    mockPosted.push({ repo: repo.full_name, number: change.number, count: findings.length, at: new Date().toISOString() });
  },
  async listOpenChanges() {
    return [];
  },
};
