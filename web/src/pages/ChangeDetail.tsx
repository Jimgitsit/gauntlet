import { useState } from "react";
import { type ChangeDetail as Detail, type Finding, post, useFetch } from "../api";
import { Markdown } from "../components/Markdown";
import { StatusPill } from "../components/StatusPill";
import { STATUS_HINT, ago, compact } from "../format";
import { href } from "../router";

const SEV_LABEL = { important: "Important", nit: "Nit", "pre-existing": "Pre-existing" } as const;
const RES_LABEL = { fixed: "Fixed", wrong: "Reviewer was wrong", intentional: "Intentional", irrelevant: "Did not matter", open: "Open" } as const;

export function ChangeDetail({ id }: { id: number }) {
  const { data, error, reload } = useFetch<Detail>(`/changes/${id}`, { pollMs: 5000 });
  const [busy, setBusy] = useState(false);
  const [learned, setLearned] = useState<string[]>([]);
  if (error) {
    return <div className="empty">{error}</div>;
  }
  if (!data) {
    return null;
  }
  const { change, repo, reviews, findings } = data;
  const open = findings.filter((f) => f.status === "open");
  const resolved = findings.filter((f) => f.status !== "open");
  const sevRank = { important: 0, nit: 1, "pre-existing": 2 };
  open.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.votes_for - a.votes_for);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    try {
      const r = await post<{ learned?: { page: string; line: string }[] }>(path, body);
      if (r.learned && r.learned.length) {
        setLearned((l) => [...l, ...r.learned!.map((x) => `${x.page}: ${x.line}`)]);
      }
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head detail-head">
        <div>
          <div className="muted" style={{ fontSize: 13 }}>
            <a href={href(`/changes?repo=${repo.id}`)}>{repo.full_name}</a> · {repo.provider === "gitlab" ? "merge request" : "pull request"}{" "}
            <a href={change.html_url} target="_blank" rel="noreferrer">
              #{change.number}
            </a>
          </div>
          <h1>{change.title}</h1>
          <div className="meta">
            <a href={href(`/changes?author=${encodeURIComponent(change.author)}`)}>{change.author}</a>
            {change.author_is_agent ? " (agent)" : ""}, opened {ago(change.opened_at)} ago, {change.files_changed} files, <span style={{ color: "var(--s-ready)" }}>+{compact(change.additions)}</span>{" "}
            <span style={{ color: "var(--s-blocked)" }}>−{compact(change.deletions)}</span>, into {change.base_branch}
          </div>
        </div>
        <div className="row">
          {change.state === "open" ? <StatusPill status={change.status} /> : <StatusPill status="merged" label={change.state === "merged" ? "Merged" : "Closed"} />}
          {change.state === "open" && (
            <>
              <button className="btn" disabled={busy || change.status === "reviewing" || change.status === "queued"} onClick={() => act(`/changes/${change.id}/review`)}>
                Review again
              </button>
              <button className="btn primary" disabled={busy || change.human_approvals >= change.humans_required} onClick={() => act(`/changes/${change.id}/approve`)}>
                Approve as a person ({change.human_approvals}/{change.humans_required})
              </button>
            </>
          )}
        </div>
      </div>

      {change.state === "open" && (
        <div className="muted" style={{ marginBottom: 10 }}>
          {STATUS_HINT[change.status]}.
        </div>
      )}

      {learned.length > 0 && (
        <div className="hook" style={{ marginBottom: 14 }}>
          The reviewer wrote this to the team wiki so it does not repeat the mistake:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {learned.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="detail-grid">
        <div>
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-head">
              <h2>
                {open.length} open finding{open.length === 1 ? "" : "s"}
              </h2>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Every finding has to be answered: fix it, or resolve it with a reason.
              </span>
            </div>
            {open.length === 0 ? (
              <div className="panel-body muted">Nothing to fix.</div>
            ) : (
              open.map((f) => <FindingCard key={f.id} f={f} busy={busy} onResolve={(status, note) => act(`/findings/${f.id}/resolve`, { status, note })} />)
            )}
          </div>

          {resolved.length > 0 && (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-head">
                <h2>{resolved.length} resolved</h2>
              </div>
              {resolved.map((f) => (
                <FindingCard key={f.id} f={f} busy={busy} />
              ))}
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <h2>Stated intent</h2>
            </div>
            {change.body ? <Markdown text={change.body} /> : <div className="panel-body muted">No description.</div>}
          </div>
        </div>

        <div className="side">
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-head">
              <h2>Risk and approval</h2>
            </div>
            <dl className="kv">
              <dt>Tier</dt>
              <dd className={`risk ${change.risk_tier ?? ""}`}>{change.risk_tier ?? "not yet classified"}</dd>
              <dt>People required</dt>
              <dd>{change.humans_required}</dd>
              <dt>Approved by</dt>
              <dd>{change.human_approvals}</dd>
              <dt>CI</dt>
              <dd>{change.ci_state}</dd>
              <dt>Review depth</dt>
              <dd>{repo.depth}</dd>
            </dl>
            {change.risk_reason && (
              <div className="panel-body muted" style={{ paddingTop: 0, fontSize: 12.5 }}>
                {change.risk_reason}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>
                {reviews.length} round{reviews.length === 1 ? "" : "s"}
              </h2>
            </div>
            <div className="rounds-list">
              {reviews.length === 0 && <div className="round muted">Not reviewed yet.</div>}
              {reviews.map((r) => (
                <div className="round" key={r.id}>
                  <div className="r-head">
                    <span>
                      Round {r.round}, {r.mode}, {r.status}
                    </span>
                    <span>{ago(r.finished_at ?? r.started_at)} ago</span>
                  </div>
                  <div className="r-sum">{r.error ? <span className="error">{r.error}</span> : r.summary || (r.status === "running" ? "Agents are reading the diff." : "")}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.hunters} hunters, {r.voters} voters per finding, {r.candidates} candidates, {r.posted} posted, {compact(r.tokens_in)} tokens in
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FindingCard({ f, busy, onResolve }: { f: Finding; busy: boolean; onResolve?: (status: Finding["status"], note: string) => void }) {
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Finding["status"] | null>(null);
  return (
    <div className={`finding${f.status !== "open" ? " resolved" : ""}`}>
      <div className="head">
        <span className={`sev ${f.severity}`}>{SEV_LABEL[f.severity]}</span>
        <strong>{f.title}</strong>
        <span className="loc">
          {f.path}
          {f.line ? `:${f.line}` : ""}
        </span>
        <span className="votes" title="Verifier agents who agreed the finding is real">
          {f.votes_for}/{f.votes_total} agreed · {f.category}
        </span>
      </div>
      <div className="body">{f.body}</div>
      {f.evidence && <div className="evidence">Evidence: {f.evidence}</div>}
      {f.status !== "open" && (
        <div className="resolution">
          {RES_LABEL[f.status]}
          {f.resolved_by ? ` by ${f.resolved_by}` : ""}
          {f.resolution_note ? `: ${f.resolution_note}` : ""}
          {f.fixed_in_sha ? ` in ${f.fixed_in_sha.slice(0, 7)}` : ""}
        </div>
      )}
      {f.status === "open" && onResolve && (
        <div className="actions">
          {picked === null ? (
            <>
              <button className="btn small" disabled={busy} onClick={() => onResolve("fixed", "")}>
                Fixed
              </button>
              <button className="btn small" disabled={busy} onClick={() => setPicked("intentional")}>
                Intentional
              </button>
              <button className="btn small" disabled={busy} onClick={() => setPicked("wrong")}>
                Reviewer is wrong
              </button>
              <button className="btn small" disabled={busy} onClick={() => setPicked("irrelevant")}>
                Does not matter
              </button>
            </>
          ) : (
            <>
              <input placeholder={`Why is it ${RES_LABEL[picked].toLowerCase()}? The reviewer learns from this.`} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
              <button className="btn small primary" disabled={busy || !note.trim()} onClick={() => onResolve(picked, note)}>
                Resolve
              </button>
              <button className="btn small" onClick={() => setPicked(null)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
