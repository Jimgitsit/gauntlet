import { type FormEvent, useState } from "react";
import { api, post, type Repo, useFetch } from "../api";
import { BASE } from "../router";

export function Repos() {
  const { data, reload } = useFetch<{ repos: Repo[] }>("/repos");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Repo | null>(null);
  const [created, setCreated] = useState<{ id: number; provider: string; secret: string } | null>(null);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Repositories</h1>
          <div className="sub">Each repository gets a webhook, a review depth, and its own pages in the team wiki.</div>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          Connect a repository
        </button>
      </div>

      {created && (
        <div className="hook" style={{ marginBottom: 16 }}>
          <strong>Connected.</strong> Point the {created.provider === "gitlab" ? "GitLab" : "GitHub"} webhook at
          <code style={{ margin: "0 4px" }}>
            {window.location.origin}
            {BASE}/api/webhooks/{created.provider}/{created.id}
          </code>
          with secret <code>{created.secret}</code>. {created.provider === "gitlab" ? "Enable merge request and pipeline events." : "Send pull request, check suite and status events as JSON."} This secret is shown once.
        </div>
      )}

      {(adding || editing) && (
        <RepoForm
          repo={editing}
          onDone={(r) => {
            setAdding(false);
            setEditing(null);
            if (r) {
              setCreated(r);
            }
            reload();
          }}
        />
      )}

      <div className="panel">
        <div className="repo-list">
          {(data?.repos ?? []).map((r) => (
            <div className="repo-row" key={r.id}>
              <div>
                <a href={r.html_url} target="_blank" rel="noreferrer">
                  {r.full_name}
                </a>
                <div className="prov">
                  {r.provider === "gitlab" ? "GitLab" : "GitHub"} · {r.has_token ? "token set" : "demo data, no token"} · default {r.default_branch}
                </div>
              </div>
              <div className="muted">{r.depth} review</div>
              <div className="muted">{r.open_count} open</div>
              <div className="muted" title={r.sensitive_paths}>
                {JSON.parse(r.sensitive_paths || "[]").length} sensitive paths
              </div>
              <div className="row">
                <button className="btn small" onClick={() => setEditing(r)}>
                  Settings
                </button>
                <button
                  className="btn small"
                  disabled={!r.has_token}
                  title={r.has_token ? "Fetch open changes from the provider and queue them for review" : "Add a token in settings first"}
                  onClick={() => post<{ imported: number }>(`/repos/${r.id}/import`).then((x) => alert(`Imported ${x.imported} open changes.`)).then(reload)}
                >
                  Import open changes
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RepoForm({ repo, onDone }: { repo: Repo | null; onDone: (created: { id: number; provider: string; secret: string } | null) => void }) {
  const [provider, setProvider] = useState<"github" | "gitlab">(repo?.provider ?? "github");
  const [fullName, setFullName] = useState(repo?.full_name ?? "");
  const [depth, setDepth] = useState(repo?.depth ?? "standard");
  const [branch, setBranch] = useState(repo?.default_branch ?? "main");
  const [trusted, setTrusted] = useState(repo ? JSON.parse(repo.trusted_authors || "[]").join(", ") : "");
  const [sensitive, setSensitive] = useState(repo ? JSON.parse(repo.sensitive_paths || "[]").join("\n") : "");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (repo) {
        await api(`/repos/${repo.id}`, { method: "PATCH", body: JSON.stringify({ depth, default_branch: branch, trusted_authors: trusted, sensitive_paths: sensitive, access_token: token }) });
        onDone(null);
      } else {
        const r = await post<{ id: number; webhook_secret: string }>("/repos", { provider, full_name: fullName, depth, default_branch: branch, trusted_authors: trusted, sensitive_paths: sensitive, access_token: token });
        onDone({ id: r.id, provider, secret: r.webhook_secret });
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="panel" style={{ marginBottom: 18 }} onSubmit={submit}>
      <div className="panel-head">
        <h2>{repo ? `Settings for ${repo.full_name}` : "Connect a repository"}</h2>
      </div>
      <div className="panel-body repo-form">
        {error && <div className="error full">{error}</div>}
        {!repo && (
          <>
            <div className="field">
              <label htmlFor="prov">Hosted on</label>
              <select id="prov" value={provider} onChange={(e) => setProvider(e.target.value as "github" | "gitlab")}>
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="fn">Repository (owner/name)</label>
              <input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="acme/platform" required />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="depth">Review depth</label>
          <select id="depth" value={depth} onChange={(e) => setDepth(e.target.value as Repo["depth"])}>
            <option value="quick">Quick: 1 hunter, 3 voters</option>
            <option value="standard">Standard: 3 hunters, 5 voters</option>
            <option value="deep">Deep: 5 hunters, 7 voters. For code where one missed bug costs more than the review time.</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="branch">Default branch</label>
          <input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="trusted">Trusted authors (comma separated). Only they get the lighter approval paths.</label>
          <input id="trusted" value={trusted} onChange={(e) => setTrusted(e.target.value)} placeholder="mira.k, jonas" />
        </div>
        <div className="field">
          <label htmlFor="sens">Sensitive paths, one glob per line. A person always looks at these.</label>
          <textarea id="sens" value={sensitive} onChange={(e) => setSensitive(e.target.value)} placeholder={"src/auth/**\nmigrations/**"} style={{ minHeight: 70 }} />
        </div>
        <div className="field">
          <label htmlFor="token">{repo ? "Replace access token (leave blank to keep)" : "Access token with read access to pull requests and write access to reviews"}</label>
          <input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </div>
        <div className="row full">
          <button className="btn primary" type="submit">
            {repo ? "Save settings" : "Connect"}
          </button>
          <button className="btn" type="button" onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
