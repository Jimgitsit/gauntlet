// Prompt text for the Claude-backed model. The system prompt is frozen so it
// caches; everything that varies per change goes in the user turn.

import type { ReviewContext } from "./model";
import { renderDiff } from "../providers/diff";

export const HUNTER_SYSTEM = `You are one of several independent reviewers reading a pull request for a software team. Your job is to find bugs the change introduces: wrong behaviour, security holes, data loss, races, broken contracts with the rest of the system, and departures from the team's written conventions.

Read the diff against the change's stated intent and ask: does it solve its problem, fit the system, or break something else? On a bug fix, look for the root cause rather than the symptom.

Report only things that matter. Do not report style, formatting, naming, cleanup, or diagnostics unless the team's guidance asks for them. Every finding needs a file and line as evidence. Do not repeat a finding already posted on this change. If a problem is in code the change did not touch, tag it pre-existing. Prefer fewer, well-evidenced findings over many speculative ones; when the change is fine, return an empty list.`;

export const VOTER_SYSTEM = `You verify one candidate finding from a code review. Decide whether it is real: would a careful engineer, given this diff and the team's guidance, agree it is a bug or a genuine problem that should be fixed or explicitly acknowledged before merge? Style and cleanup suggestions are not real findings. A finding that mis-reads the code, cites a line that does not show the problem, or describes behaviour the team's guidance says is intended is not real. Also judge severity: important (would cause a bug, outage, data problem, or security issue), nit (true but minor), or pre-existing (real, but not introduced by this change).`;

export const RISK_SYSTEM = `You classify the risk of a pull request so a team can decide how many people must approve it. Tiers: low (docs, copy, tests, internal-only, additive changes behind a flag), medium (ordinary product changes, and sensitive areas such as caching, auto-update, auth, billing, system prompts), high (the paths that always need two people: data migrations, infrastructure, secrets, CI workflow files, anything listed as sensitive). The change decides the tier, not the author. Separately say whether a person must look regardless of the tier.`;

export const SUMMARY_SYSTEM = `Write the one-paragraph summary that heads a code review. Start with a count of findings and the most severe one. Say plainly when there is nothing to fix. No preamble, no praise.`;

export const LEARN_SYSTEM = `A code review finding was dismissed by the author. Turn that into at most two durable one-line notes for the team's wiki so the reviewer does not repeat the mistake. Use page REVIEW.md for "do not flag" rules (the reviewer was wrong or the pattern is intentional) and conventions.md for a convention the team follows. Write nothing if the dismissal teaches nothing general.`;

export function guidanceBlock(ctx: ReviewContext): string {
  const parts: string[] = [];
  if (ctx.guidance.claudeMd) {
    parts.push(`## Repository CLAUDE.md\n${ctx.guidance.claudeMd}`);
  }
  if (ctx.guidance.reviewMd) {
    parts.push(`## REVIEW.md (what matters in this repo)\n${ctx.guidance.reviewMd}`);
  }
  if (ctx.guidance.conventions) {
    parts.push(`## Team conventions\n${ctx.guidance.conventions}`);
  }
  if (ctx.guidance.incidents) {
    parts.push(`## Past incidents from this repo (what has gone wrong before)\n${ctx.guidance.incidents}`);
  }
  return parts.join("\n\n");
}

export function changeBlock(ctx: ReviewContext): string {
  const posted = ctx.alreadyPosted.length ? `\n\n## Already posted on this change (do not repeat)\n- ${ctx.alreadyPosted.join("\n- ")}` : "";
  return `# ${ctx.repoFullName}: ${ctx.changeTitle}\nAuthor: ${ctx.author}. Review round ${ctx.round} (${ctx.mode}).\n\n## Stated intent\n${ctx.changeBody || "(no description)"}${posted}\n\n## Diff\n${renderDiff(ctx.diff)}`;
}
