// SQLite DDL. One file holds the whole prototype's state.

export const schema = `
CREATE TABLE IF NOT EXISTS orgs (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  id              INTEGER PRIMARY KEY,
  org_id          INTEGER NOT NULL REFERENCES orgs(id),
  provider        TEXT NOT NULL,              -- github | gitlab
  full_name       TEXT NOT NULL,              -- owner/name or group/sub/name
  default_branch  TEXT NOT NULL DEFAULT 'main',
  depth           TEXT NOT NULL DEFAULT 'standard',
  trusted_authors TEXT NOT NULL DEFAULT '[]', -- json array of logins
  sensitive_paths TEXT NOT NULL DEFAULT '[]', -- json array of globs that always need a person
  webhook_secret  TEXT NOT NULL DEFAULT '',
  access_token    TEXT NOT NULL DEFAULT '',   -- provider token for diffs and posting comments
  html_url        TEXT NOT NULL DEFAULT '',
  wiki_slug       TEXT NOT NULL DEFAULT '',   -- directory under projects/ in the team wiki, unique per org
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (org_id, provider, full_name)
);

CREATE TABLE IF NOT EXISTS changes (
  id               INTEGER PRIMARY KEY,
  repo_id          INTEGER NOT NULL REFERENCES repos(id),
  number           INTEGER NOT NULL,
  title            TEXT NOT NULL,
  body             TEXT NOT NULL DEFAULT '',
  author           TEXT NOT NULL,
  author_is_agent  INTEGER NOT NULL DEFAULT 0,
  html_url         TEXT NOT NULL DEFAULT '',
  state            TEXT NOT NULL DEFAULT 'open',   -- open | merged | closed
  status           TEXT NOT NULL DEFAULT 'queued', -- queued | reviewing | author | human | ready | blocked
  risk_tier        TEXT,                            -- low | medium | high (null until classified)
  risk_reason      TEXT NOT NULL DEFAULT '',
  humans_required  INTEGER NOT NULL DEFAULT 1,
  human_approvals  INTEGER NOT NULL DEFAULT 0,
  ci_state         TEXT NOT NULL DEFAULT 'pending', -- pending | green | red
  head_sha         TEXT NOT NULL,
  base_branch      TEXT NOT NULL DEFAULT 'main',
  additions        INTEGER NOT NULL DEFAULT 0,
  deletions        INTEGER NOT NULL DEFAULT 0,
  files_changed    INTEGER NOT NULL DEFAULT 0,
  rounds           INTEGER NOT NULL DEFAULT 0,
  opened_at        TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  merged_at        TEXT,
  reverted         INTEGER NOT NULL DEFAULT 0,
  waiting_since    TEXT,                            -- when the current status began
  last_reviewed_at TEXT,
  UNIQUE (repo_id, number)
);
CREATE INDEX IF NOT EXISTS changes_repo_state ON changes(repo_id, state, status);
CREATE INDEX IF NOT EXISTS changes_merged ON changes(merged_at);

CREATE TABLE IF NOT EXISTS reviews (
  id           INTEGER PRIMARY KEY,
  change_id    INTEGER NOT NULL REFERENCES changes(id),
  round        INTEGER NOT NULL,
  head_sha     TEXT NOT NULL,
  depth        TEXT NOT NULL,
  mode         TEXT NOT NULL,                       -- full | diff-only
  status       TEXT NOT NULL DEFAULT 'running',     -- running | done | failed
  hunters      INTEGER NOT NULL DEFAULT 0,
  voters       INTEGER NOT NULL DEFAULT 0,
  candidates   INTEGER NOT NULL DEFAULT 0,          -- findings before voting
  posted       INTEGER NOT NULL DEFAULT 0,          -- findings after voting
  summary      TEXT NOT NULL DEFAULT '',
  tokens_in    INTEGER NOT NULL DEFAULT 0,
  tokens_out   INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  error        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS reviews_change ON reviews(change_id);

CREATE TABLE IF NOT EXISTS findings (
  id              INTEGER PRIMARY KEY,
  review_id       INTEGER NOT NULL REFERENCES reviews(id),
  change_id       INTEGER NOT NULL REFERENCES changes(id),
  severity        TEXT NOT NULL,     -- important | nit | pre-existing
  category        TEXT NOT NULL,     -- correctness | security | data-loss | concurrency | convention | ...
  path            TEXT NOT NULL,
  line            INTEGER,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  evidence        TEXT NOT NULL DEFAULT '',
  votes_for       INTEGER NOT NULL DEFAULT 0,
  votes_total     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open', -- open | fixed | wrong | intentional | irrelevant
  resolved_by     TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',
  fixed_in_sha    TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at     TEXT
);
CREATE INDEX IF NOT EXISTS findings_change ON findings(change_id, status);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id         INTEGER PRIMARY KEY,
  org_id     INTEGER NOT NULL REFERENCES orgs(id),
  path       TEXT NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'reviewer',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (org_id, path)
);

CREATE TABLE IF NOT EXISTS wiki_log (
  id       INTEGER PRIMARY KEY,
  org_id   INTEGER NOT NULL REFERENCES orgs(id),
  ts       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  path     TEXT NOT NULL,
  summary  TEXT NOT NULL,
  by       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id          INTEGER PRIMARY KEY,
  repo_id     INTEGER REFERENCES repos(id),
  provider    TEXT NOT NULL,
  event       TEXT NOT NULL,
  action      TEXT NOT NULL DEFAULT '',
  number      INTEGER,
  accepted    INTEGER NOT NULL DEFAULT 1,
  note        TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One row per person who approved a change; human_approvals on the change is the count.
CREATE TABLE IF NOT EXISTS approvals (
  change_id   INTEGER NOT NULL REFERENCES changes(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  approved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (change_id, user_id)
);

CREATE TABLE IF NOT EXISTS review_queue (
  change_id   INTEGER PRIMARY KEY REFERENCES changes(id),
  reason      TEXT NOT NULL,
  enqueued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;
