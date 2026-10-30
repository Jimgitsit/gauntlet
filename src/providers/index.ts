import type { Repo } from "../types";
import { github } from "./github";
import { gitlab } from "./gitlab";
import { mock } from "./mock";
import type { ChangeProvider } from "./types";

/** The provider that serves a repo. Repos without a token (the seeded demo) use the mock. */
export function providerFor(repo: Repo): ChangeProvider {
  if (!repo.access_token) {
    return mock;
  }
  return repo.provider === "gitlab" ? gitlab : github;
}

export function webhookProvider(name: string): ChangeProvider | null {
  if (name === "github") {
    return github;
  }
  if (name === "gitlab") {
    return gitlab;
  }
  return null;
}
