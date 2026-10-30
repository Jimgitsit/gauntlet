// Runtime configuration. Everything comes from the environment with a
// prototype-friendly default.

const env = Bun.env;

export const config = {
  port: Number(env.PORT ?? 58041),
  host: env.HOST ?? "127.0.0.1",
  // URL prefix the app is mounted under (nginx passes it through).
  base: (env.BASE_PATH ?? "/code-reviewer").replace(/\/$/, ""),
  dbPath: env.DB_PATH ?? "data/gauntlet.db",
  // "claude" calls the API; "mock" runs the same pipeline on a deterministic stand-in.
  llm: (env.LLM ?? (env.ANTHROPIC_API_KEY ? "claude" : "mock")) as "claude" | "mock",
  hunterModel: env.REVIEW_HUNTER_MODEL ?? "claude-opus-5-5",
  voterModel: env.REVIEW_VOTER_MODEL ?? "claude-opus-5-5",
  classifierModel: env.REVIEW_CLASSIFIER_MODEL ?? "claude-opus-5-5",
  // How many reviews run at once.
  workerConcurrency: Number(env.WORKER_CONCURRENCY ?? 2),
  // Per-depth agent counts: hunters look for bugs, voters confirm each finding.
  depth: {
    quick: { hunters: 1, voters: 3, minVotes: 2 },
    standard: { hunters: 3, voters: 5, minVotes: 3 },
    deep: { hunters: 5, voters: 7, minVotes: 5 },
  } as const,
  // After this many rounds the reviewer asks the author to step back.
  roundCap: 3,
  sessionDays: 30,
};

export type Depth = keyof typeof config.depth;
