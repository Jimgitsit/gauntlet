// The team wiki is the reviewer's memory. Pages follow the team-wiki layout:
// a root index, platform-wide pages, one directory per repo, and a log.
// The reviewer reads a repo's REVIEW.md, conventions and incidents before
// every review, and writes learnings back when authors dismiss findings.

import { db, nowIso } from "../db";
import type { Repo, WikiPage } from "../types";

export function repoWikiSlug(repo: Repo): string {
  return repo.wiki_slug || lastSegment(repo.full_name);
}

function lastSegment(fullName: string): string {
  return fullName.split("/").pop() ?? fullName;
}

// The short name when it is free in this org, otherwise the full path with
// slashes folded, so acme/api and acme-infra/api never share a wiki directory.
export function wikiSlugFor(orgId: number, fullName: string): string {
  const short = lastSegment(fullName);
  const taken = db().query<{ n: number }, [number, string]>("SELECT count(*) AS n FROM repos WHERE org_id = ? AND wiki_slug = ?").get(orgId, short)?.n ?? 0;
  return taken === 0 ? short : fullName.replace(/\//g, "--");
}

export function repoWikiDir(repo: Repo): string {
  return `projects/${repoWikiSlug(repo)}`;
}

export function getPage(orgId: number, path: string): WikiPage | null {
  return db().query<WikiPage, [number, string]>("SELECT * FROM wiki_pages WHERE org_id = ? AND path = ?").get(orgId, path);
}

export function listPages(orgId: number): Omit<WikiPage, "content">[] {
  return db()
    .query<Omit<WikiPage, "content">, [number]>("SELECT id, org_id, path, title, updated_by, updated_at FROM wiki_pages WHERE org_id = ? ORDER BY path")
    .all(orgId);
}

export function putPage(orgId: number, path: string, title: string, content: string, by: string, summary: string): void {
  const d = db();
  d.run(
    `INSERT INTO wiki_pages (org_id, path, title, content, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (org_id, path) DO UPDATE SET title = excluded.title, content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [orgId, path, title, content, by, nowIso()],
  );
  d.run("INSERT INTO wiki_log (org_id, path, summary, by) VALUES (?, ?, ?, ?)", [orgId, path, summary, by]);
}

/** Append a line under a heading, creating the page or heading if needed. */
export function appendUnder(orgId: number, path: string, title: string, heading: string, line: string, by: string, summary: string): void {
  const existing = getPage(orgId, path);
  let content = existing?.content ?? `# ${title}\n`;
  if (content.includes(line)) {
    return;
  }
  const marker = `\n## ${heading}\n`;
  if (content.includes(marker)) {
    const idx = content.indexOf(marker) + marker.length;
    // Insert at the end of that section: find the next heading or EOF.
    const rest = content.slice(idx);
    const next = rest.search(/\n## /);
    const sectionEnd = next === -1 ? content.length : idx + next;
    content = `${content.slice(0, sectionEnd).replace(/\n*$/, "\n")}- ${line}\n${content.slice(sectionEnd)}`;
  } else {
    content = `${content.replace(/\n*$/, "\n")}${marker}- ${line}\n`;
  }
  putPage(orgId, path, title, content, by, summary);
}

export function appendLog(orgId: number, repo: Repo, line: string): void {
  const path = `${repoWikiDir(repo)}/log.md`;
  const existing = getPage(orgId, path);
  const content = `${existing?.content ?? `# ${repo.full_name} log\n`}`.replace(/\n*$/, "\n") + `${nowIso().slice(0, 10)}  ${line}\n`;
  db().run(
    `INSERT INTO wiki_pages (org_id, path, title, content, updated_by, updated_at) VALUES (?, ?, ?, ?, 'reviewer', ?)
     ON CONFLICT (org_id, path) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [orgId, path, `${repo.full_name} log`, content, nowIso()],
  );
}

/** Guidance the reviewer loads before reading a diff. */
export function guidanceFor(repo: Repo): { reviewMd: string; conventions: string; incidents: string } {
  const dir = repoWikiDir(repo);
  const platform = getPage(repo.org_id, "platform/conventions.md")?.content ?? "";
  const repoConv = getPage(repo.org_id, `${dir}/conventions.md`)?.content ?? "";
  return {
    reviewMd: getPage(repo.org_id, `${dir}/REVIEW.md`)?.content ?? "",
    conventions: [platform, repoConv].filter(Boolean).join("\n\n"),
    incidents: getPage(repo.org_id, `${dir}/incidents.md`)?.content ?? "",
  };
}

/** Seed the pages every org and repo starts with. Idempotent. */
export function ensureOrgWiki(orgId: number, orgName: string): void {
  if (!getPage(orgId, "index.md")) {
    putPage(orgId, "index.md", "Index", `# ${orgName} wiki\n\nThe map. Platform-wide knowledge lives under platform/; each connected repository gets a directory under projects/.\n\n## Platform\n- [platform/index.md](platform/index.md)\n\n## Projects\n`, "system", "seeded");
    putPage(
      orgId,
      "AGENTS.md",
      "Rules for agents",
      `# Rules for agents\n\nThis wiki is maintained by the reviewer and by people on the team. It is the durable record of how the code is built, what matters in review, and what has gone wrong before.\n\n- Pages state current truth. Edit in place; history lives in each log.md.\n- A new page gets an index line in the same pass.\n- REVIEW.md in a project says what failure looks like there, caps the nits, lists paths to skip, and records patterns the reviewer must not flag.\n- conventions.md records conventions the team follows that are not obvious from the code.\n- incidents.md is the eval set: changes that caused incidents or reverts, with what the reviewer should have caught.\n- log.md gets one terse line per meaningful change.\n`,
      "system",
      "seeded",
    );
    putPage(orgId, "platform/index.md", "Platform", `# Platform\n\nKnowledge that spans every repository.\n\n- [conventions.md](conventions.md): conventions every repo follows.\n`, "system", "seeded");
    putPage(orgId, "platform/conventions.md", "Platform conventions", `# Platform conventions\n\n## Conventions\n- Every change states its intent, testing, risk, and how to revert in the description.\n- New feature flags ship off and are enabled per environment.\n- Secrets never appear in logs, fixtures, or test output.\n`, "system", "seeded");
  }
}

export function ensureRepoWiki(repo: Repo): void {
  const dir = repoWikiDir(repo);
  if (getPage(repo.org_id, `${dir}/index.md`)) {
    return;
  }
  const slug = repoWikiSlug(repo);
  putPage(repo.org_id, `${dir}/index.md`, repo.full_name, `# ${repo.full_name}\n\n- [REVIEW.md](REVIEW.md): what matters in review here. Read before every review.\n- [conventions.md](conventions.md): conventions specific to this repo.\n- [incidents.md](incidents.md): past incidents and reverts, the reviewer's eval set.\n- [arch/index.md](arch/index.md): how it is built.\n- [log.md](log.md): one line per meaningful change.\n`, "system", "connected repo");
  putPage(
    repo.org_id,
    `${dir}/REVIEW.md`,
    `${slug} REVIEW.md`,
    `# REVIEW.md for ${repo.full_name}\n\nWhat failure looks like in this repo: a change that ships wrong behaviour to users, loses or leaks data, or breaks a contract another service depends on.\n\n## What matters most\n- Correctness of anything that touches money, auth, or stored data.\n- Contracts: events, API responses, and database shapes other services read.\n\n## Nits\n- At most three nits per round. Prefer none.\n\n## Paths to skip\n- CHANGELOG.md\n- generated/\n\n## Evidence\n- Every finding cites a file and line.\n- Start the summary with a count. Say plainly when there is nothing to fix.\n\n## Do not flag\n`,
    "system",
    "connected repo",
  );
  putPage(repo.org_id, `${dir}/conventions.md`, `${slug} conventions`, `# Conventions for ${repo.full_name}\n\n## Conventions\n`, "system", "connected repo");
  putPage(repo.org_id, `${dir}/incidents.md`, `${slug} incidents`, `# Incidents and reverts for ${repo.full_name}\n\nThe reviewer runs against these. Each entry: what shipped, what broke, what review should have caught.\n\n## Cases\n`, "system", "connected repo");
  putPage(repo.org_id, `${dir}/arch/index.md`, `${slug} architecture`, `# Architecture of ${repo.full_name}\n\nNot written yet. Ask the reviewer for an explainer of any module and it lands here.\n`, "system", "connected repo");
  appendUnder(repo.org_id, "index.md", "Index", "Projects", `[${repo.full_name}](${dir}/index.md)`, "system", `indexed ${repo.full_name}`);
}
