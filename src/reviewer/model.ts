// The model-facing contract of the review pipeline. Two implementations:
// `claude` (the real thing) and `mock` (deterministic, for demos and tests).
// The engine only talks to this interface.

import { z } from "zod";
import type { DiffFile, RiskTier, Severity } from "../types";

export const CandidateSchema = z.object({
  path: z.string(),
  line: z.number().int().nullable(),
  severity: z.enum(["important", "nit", "pre-existing"]),
  category: z.enum(["correctness", "security", "data-loss", "concurrency", "convention", "docs", "performance", "style", "other"]),
  title: z.string(),
  body: z.string(),
  evidence: z.string(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const HuntOutputSchema = z.object({
  findings: z.array(CandidateSchema),
});

export const VoteSchema = z.object({
  real: z.boolean(),
  severity: z.enum(["important", "nit", "pre-existing"]),
  reason: z.string(),
});
export type Vote = z.infer<typeof VoteSchema>;

export const RiskSchema = z.object({
  tier: z.enum(["low", "medium", "high"]),
  needs_person_anyway: z.boolean(),
  reason: z.string(),
});
export type RiskVerdict = z.infer<typeof RiskSchema>;

export const LearningSchema = z.object({
  learnings: z.array(
    z.object({
      page: z.enum(["REVIEW.md", "conventions.md"]),
      line: z.string(),
    }),
  ),
});
export type Learning = z.infer<typeof LearningSchema>["learnings"][number];

export interface ReviewContext {
  repoFullName: string;
  changeTitle: string;
  changeBody: string;
  author: string;
  round: number;
  mode: "full" | "diff-only";
  diff: DiffFile[];
  /** Repo-level guidance: CLAUDE.md from the repo, REVIEW.md and conventions from the wiki. */
  guidance: { claudeMd: string; reviewMd: string; conventions: string; incidents: string };
  /** Titles already posted on this change; never repeat them. */
  alreadyPosted: string[];
}

export interface ModelUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface ModelResult<T> {
  value: T;
  usage: ModelUsage;
}

export interface ResolvedFindingInfo {
  title: string;
  body: string;
  path: string;
  status: "wrong" | "intentional" | "irrelevant";
  note: string;
}

export interface ReviewModel {
  readonly name: "claude" | "mock";
  hunt(ctx: ReviewContext, hunterIndex: number): Promise<ModelResult<Candidate[]>>;
  vote(ctx: ReviewContext, candidate: Candidate, voterIndex: number): Promise<ModelResult<Vote>>;
  classifyRisk(ctx: ReviewContext, sensitivePaths: string[]): Promise<ModelResult<RiskVerdict>>;
  summarize(ctx: ReviewContext, posted: Candidate[]): Promise<ModelResult<string>>;
  /** Turn an author's dismissal into a durable line for the team wiki. */
  distill(repoFullName: string, resolved: ResolvedFindingInfo): Promise<ModelResult<Learning[]>>;
}

export type { RiskTier, Severity };
