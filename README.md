# Gauntlet

Code review as a service, modeled on how the Claude Code team reviews code: every
pull or merge request gets a multi-agent Claude review that is accountable (every
finding must be answered), risk-tiered (the change, not the author, decides how
many people must look), and backed by a team wiki the reviewer reads before each
round and writes back to when it learns it was wrong.

Served at `jimmcgowen.com/code-reviewer/` (bun on `:58041`, launchd
`com.jim.code-reviewer`). Demo login `demo@gauntlet.dev` / `review-the-gauntlet`.

## What is in the box

| Piece | Where | Notes |
|---|---|---|
| HTTP API + static dashboard | `src/server.ts`, `src/api/` | Hono on Bun, SQLite at `data/gauntlet.db` |
| Review engine | `src/reviewer/engine.ts` | hunters → dedupe → voters → filters → post → summary → risk tier |
| Models | `src/reviewer/claude.ts`, `mock.ts` | Claude via structured outputs when `ANTHROPIC_API_KEY` is set, otherwise a deterministic mock |
| Providers | `src/providers/github.ts`, `gitlab.ts`, `mock.ts` | Webhook verify/parse, diff fetch, posting findings. A repo without a token uses the mock |
| Team wiki | `src/reviewer/wiki.ts` | `index.md`, `REVIEW.md`, `conventions.md`, per-repo pages, a change log |
| Seed data | `src/seed/` | 14 repos, 3200 open and 2600 merged changes with reviews and findings |
| Dashboard | `web/` | React + Vite, History router under `/code-reviewer/` |

## Run

```sh
bun install && (cd web && bun install)
bun run seed          # wipes and refills data/gauntlet.db
bun run build         # builds web/dist
bun run start         # http://127.0.0.1:58041/code-reviewer/
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Set it and reviews run on Claude. Unset, the mock model reviews the mock diffs |
| `REVIEW_HUNTER_MODEL`, `REVIEW_VOTER_MODEL`, `REVIEW_CLASSIFIER_MODEL` | `claude-opus-5-5` | Per-role model ids |
| `PORT`, `HOST` | `58041`, `127.0.0.1` | |
| `BASE_PATH` | `/code-reviewer` | Mount path, must match `web/vite.config.ts` `base` |
| `DB_PATH` | `data/gauntlet.db` | |
| `WORKER_CONCURRENCY` | `2` | Reviews running at once |
| `COOKIE_SECURE` | unset | Force the Secure cookie flag; set automatically behind an https proxy |

`bun run typecheck` checks both the server and the dashboard.

## How a review runs

1. A webhook (`POST api/webhooks/:provider/:repoId`) upserts the change and queues it.
   Changing `head_sha` re-queues; CI events update `ci_state`.
2. The worker builds context: the diff, the stated intent, repo guidance from the
   wiki (`REVIEW.md`, `conventions.md`, repo page), and prior findings on this change.
3. N hunter agents read the diff independently and emit candidate findings with
   file, line and evidence. Candidates are deduped by path and title.
4. M voter agents judge each candidate. A finding posts only with enough votes
   (`minVotes` per depth: quick 1/3/2, standard 3/5/3, deep 5/7/5).
5. Filters: style-only findings dropped, `REVIEW.md` "Paths to skip" honored, no
   repeat of a finding already open on the change, nit cap from `REVIEW.md`.
6. Prior open findings not re-found at the new sha are marked fixed automatically.
7. A summary is written, starting with the count. After round 3 the summary tells
   the author to step back and rethink. Rounds past 2 review only the new diff.
8. Risk tier is classified once per change: sensitive paths, CI workflow files,
   untrusted or agent authors push it up. The tier sets `humans_required`
   (low 0, medium 1, high 2). An agent approval never counts as a person.
9. Status: `blocked` (open security/data-loss finding or CI red), `author`
   (open findings), `human` (needs people), `ready`.

Resolving a finding as "wrong" or "intentional" asks the model to distill a
one-line rule and appends it to `REVIEW.md` ("Do not flag") or `conventions.md`.
