// The Claude-backed review model. Structured outputs on every call; the
// frozen system prompt plus the repo guidance sit before the cache breakpoint
// so a change's hunters and voters share one cached prefix.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "../config";
import {
  type Candidate,
  HuntOutputSchema,
  type Learning,
  LearningSchema,
  type ModelResult,
  type ResolvedFindingInfo,
  type ReviewContext,
  type ReviewModel,
  RiskSchema,
  type RiskVerdict,
  type Vote,
  VoteSchema,
} from "./model";
import { changeBlock, guidanceBlock, HUNTER_SYSTEM, LEARN_SYSTEM, RISK_SYSTEM, SUMMARY_SYSTEM, VOTER_SYSTEM } from "./prompts";

const client = new Anthropic();

async function call<S extends z.ZodType>(opts: {
  model: string;
  system: string;
  guidance: string;
  user: string;
  schema: S;
  effort: "low" | "medium" | "high";
}): Promise<ModelResult<z.infer<S>>> {
  const response = await client.beta.messages.parse({
    model: opts.model,
    max_tokens: 16000,
    system: [
      { type: "text", text: opts.system },
      { type: "text", text: opts.guidance || "(no repository guidance)", cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: opts.user }],
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
  });
  if (response.stop_reason === "refusal") {
    throw new Error("model declined the request");
  }
  const parsed = response.parsed_output;
  if (parsed === null || parsed === undefined) {
    throw new Error("model returned no parseable output");
  }
  return {
    value: parsed as z.infer<S>,
    usage: {
      tokensIn: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      tokensOut: response.usage.output_tokens,
    },
  };
}

export const claudeModel: ReviewModel = {
  name: "claude",

  async hunt(ctx, hunterIndex): Promise<ModelResult<Candidate[]>> {
    const angles = [
      "Focus first on behaviour: control flow, error handling, edge cases, and the contract with callers.",
      "Focus first on security and data: authorization, injection, secrets, persistence, and migrations.",
      "Focus first on concurrency, performance under load, and resource lifecycles.",
      "Focus first on how the change fits the rest of the system and the team's conventions.",
      "Focus first on what tests and the stated intent imply the author expected, and where the code departs from it.",
    ];
    const res = await call({
      model: config.hunterModel,
      system: HUNTER_SYSTEM,
      guidance: guidanceBlock(ctx),
      user: `${angles[hunterIndex % angles.length]}\n\n${changeBlock(ctx)}`,
      schema: HuntOutputSchema,
      effort: ctx.mode === "diff-only" ? "medium" : "high",
    });
    return { value: res.value.findings, usage: res.usage };
  },

  async vote(ctx, candidate): Promise<ModelResult<Vote>> {
    return call({
      model: config.voterModel,
      system: VOTER_SYSTEM,
      guidance: guidanceBlock(ctx),
      user: `${changeBlock(ctx)}\n\n## Candidate finding\n${JSON.stringify(candidate, null, 2)}`,
      schema: VoteSchema,
      effort: "medium",
    });
  },

  async classifyRisk(ctx, sensitivePaths): Promise<ModelResult<RiskVerdict>> {
    return call({
      model: config.classifierModel,
      system: RISK_SYSTEM,
      guidance: guidanceBlock(ctx),
      user: `Paths the owners list as sensitive: ${sensitivePaths.join(", ") || "(none)"}\n\nFiles touched:\n${ctx.diff.map((f) => `- ${f.status} ${f.path}`).join("\n")}\n\n${changeBlock(ctx)}`,
      schema: RiskSchema,
      effort: "low",
    });
  },

  async summarize(ctx, posted): Promise<ModelResult<string>> {
    const res = await client.messages.create({
      model: config.classifierModel,
      max_tokens: 1024,
      system: SUMMARY_SYSTEM,
      messages: [{ role: "user", content: `Change: ${ctx.changeTitle}\n\nFindings posted:\n${posted.length ? JSON.stringify(posted, null, 2) : "(none)"}` }],
      output_config: { effort: "low" },
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return { value: text.trim(), usage: { tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens } };
  },

  async distill(repoFullName, resolved): Promise<ModelResult<Learning[]>> {
    const res = await call({
      model: config.classifierModel,
      system: LEARN_SYSTEM,
      guidance: `Repository: ${repoFullName}`,
      user: JSON.stringify(resolved, null, 2),
      schema: LearningSchema,
      effort: "low",
    });
    return { value: res.value.learnings, usage: res.usage };
  },
};
