// Deterministic stand-in for the model. Hunters report the bugs planted in the
// change's scenario (each misses some and adds noise); voters confirm real
// ones and reject noise most of the time. Same shape as the real thing so the
// engine, the dashboard and the tests exercise the full pipeline.

import { plantedForFiles } from "../seed/scenarios";
import { matchGlob } from "../lib/glob";
import { hashString, rng } from "../seed/rng";
import type { Candidate, Learning, ModelResult, ResolvedFindingInfo, ReviewContext, ReviewModel, RiskVerdict, Vote } from "./model";

const zeroUsage = { tokensIn: 0, tokensOut: 0 };

function scenarioKey(ctx: ReviewContext): string {
  // The engine keys scenarios by repo, number and sha; the mock provider does the same.
  return ctx.diff.map((f) => f.path).join("|") + ctx.changeTitle;
}

export const mockModel: ReviewModel = {
  name: "mock",

  async hunt(ctx, hunterIndex): Promise<ModelResult<Candidate[]>> {
    const r = rng(hashString(`${scenarioKey(ctx)}:hunter:${hunterIndex}`));
    const planted = plantedFor(ctx);
    const found: Candidate[] = [];
    for (const p of planted) {
      // Real bugs are found ~80% of the time per hunter, noise ~50%.
      const chance = p.noise ? 0.5 : 0.8;
      if (r() < chance) {
        found.push({ path: p.path, line: p.line, severity: p.severity, category: p.category as Candidate["category"], title: p.title, body: p.body, evidence: p.evidence });
      }
    }
    return { value: found, usage: { tokensIn: 4200 + ctx.diff.length * 900, tokensOut: 300 + found.length * 120 } };
  },

  async vote(ctx, candidate, voterIndex): Promise<ModelResult<Vote>> {
    const r = rng(hashString(`${scenarioKey(ctx)}:vote:${candidate.path}:${candidate.title}:${voterIndex}`));
    const planted = plantedFor(ctx).find((p) => p.title === candidate.title && p.path === candidate.path);
    const noise = planted ? planted.noise : candidate.category === "style";
    const real = noise ? r() < 0.15 : r() < 0.92;
    return { value: { real, severity: candidate.severity, reason: real ? "Reproduced from the cited lines." : "Does not hold up against the diff." }, usage: { tokensIn: 3800 + ctx.diff.length * 900, tokensOut: 60 } };
  },

  async classifyRisk(ctx, sensitivePaths): Promise<ModelResult<RiskVerdict>> {
    const paths = ctx.diff.map((f) => f.path);
    const hit = (re: RegExp) => paths.some((p) => re.test(p));
    const sensitive = paths.some((p) => sensitivePaths.some((g) => matchGlob(g, p)));
    if (hit(/^\.github\/workflows\/|^\.gitlab-ci|^infra\/|migrations\//) || sensitive) {
      return { value: { tier: "high", needs_person_anyway: true, reason: "Touches infrastructure, CI or a path the owners list as sensitive." }, usage: zeroUsage };
    }
    if (hit(/auth|billing|payments|session|flags/)) {
      return { value: { tier: "medium", needs_person_anyway: false, reason: "Touches a sensitive area (auth, billing or flags)." }, usage: zeroUsage };
    }
    if (paths.every((p) => /^docs\/|\.md$|^web\/src\/styles|CHANGELOG/.test(p))) {
      return { value: { tier: "low", needs_person_anyway: false, reason: "Docs and copy only." }, usage: zeroUsage };
    }
    return { value: { tier: "medium", needs_person_anyway: false, reason: "Ordinary product change." }, usage: zeroUsage };
  },

  async summarize(_ctx, posted): Promise<ModelResult<string>> {
    if (posted.length === 0) {
      return { value: "0 findings. Nothing to fix.", usage: zeroUsage };
    }
    const important = posted.filter((p) => p.severity === "important").length;
    const top = posted.find((p) => p.severity === "important") ?? posted[0];
    return {
      value: `${posted.length} finding${posted.length === 1 ? "" : "s"}, ${important} important. Most severe: ${top.title} (${top.path}${top.line ? `:${top.line}` : ""}).`,
      usage: zeroUsage,
    };
  },

  async distill(_repo, resolved): Promise<ModelResult<Learning[]>> {
    if (resolved.status === "intentional") {
      return { value: [{ page: "conventions.md", line: `In \`${resolved.path}\`: ${resolved.note || resolved.title} is intentional; do not flag it.` }], usage: zeroUsage };
    }
    if (resolved.status === "wrong") {
      return { value: [{ page: "REVIEW.md", line: `Do not flag "${resolved.title}" in \`${resolved.path}\`: ${resolved.note || "the author showed the finding was wrong"}.` }], usage: zeroUsage };
    }
    return { value: [], usage: zeroUsage };
  },
};

function plantedFor(ctx: ReviewContext) {
  return plantedForFiles(ctx.diff);
}
