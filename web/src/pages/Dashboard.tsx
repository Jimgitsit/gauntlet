import { type Overview, useFetch } from "../api";
import { Flow } from "../components/Flow";
import { Lanes } from "../components/Lanes";
import { Panel } from "../components/Panel";
import { StatTiles, openSummary } from "../components/StatTiles";
import { compact, hours, pct, updated } from "../format";
import { navigate } from "../router";

export function Dashboard() {
  const ov = useFetch<Overview>("/overview", { pollMs: 8000 });
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">{openSummary(ov.data)}</div>
        </div>
        {ov.data && (
          <div className="muted" style={{ fontSize: 12.5 }}>
            {updated(ov.data.generated_at)}
          </div>
        )}
      </div>

      <StatTiles overview={ov.data} stale={ov.loading && Boolean(ov.data)} onPick={(s) => navigate(`/changes?status=${s}`)} />

      {ov.data && (
        <div className="two-col">
          <Panel
            id="lanes"
            title="By repository"
            aside={
              <span className="muted" style={{ fontSize: 12.5 }}>
                Sorted by how many need a person. Click a repo or a segment to open the list.
              </span>
            }
          >
            <div className="panel-body">
              <Lanes
                lanes={ov.data.lanes}
                activeRepo={null}
                onPick={(r, s) => {
                  const q = new URLSearchParams();
                  if (r !== null) {
                    q.set("repo", String(r));
                  }
                  if (s) {
                    q.set("status", s);
                  }
                  const qs = q.toString();
                  navigate(`/changes${qs ? `?${qs}` : ""}`);
                }}
              />
            </div>
          </Panel>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Panel
              id="flow"
              title="Last 14 days"
              aside={
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {ov.data.review.merged_30d.toLocaleString()} merged in 30 days, {pct(ov.data.review.revert_rate)} reverted
                </span>
              }
            >
              <div className="panel-body">
                <Flow days={ov.data.days} />
              </div>
            </Panel>
            <ReviewHealth ov={ov.data} />
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewHealth({ ov }: { ov: Overview }) {
  const r = ov.review;
  const o = r.outcomes;
  const total = Math.max(1, o.fixed + o.wrong + o.intentional + o.irrelevant);
  const parts: { k: string; label: string; c: string }[] = [
    { k: "fixed", label: "fixed", c: "var(--s-ready)" },
    { k: "intentional", label: "intentional", c: "var(--s-author)" },
    { k: "wrong", label: "wrong", c: "var(--s-blocked)" },
    { k: "irrelevant", label: "did not matter", c: "var(--s-queued)" },
  ];
  return (
    <Panel
      id="health"
      title="Is the reviewer earning its keep?"
      aside={
        <span className="muted" style={{ fontSize: 12.5 }}>
          Last 30 days
        </span>
      }
    >
      <div className="panel-body">
        <dl className="kv">
          <dt>Passed after one round</dt>
          <dd>{pct(r.first_round_pass_rate)}</dd>
          <dt>Needed five or more rounds</dt>
          <dd>{pct(r.five_plus_rounds_rate)}</dd>
          <dt>Mean rounds to pass</dt>
          <dd>{r.mean_rounds_to_pass.toFixed(2)}</dd>
          <dt>Changes with substantive findings</dt>
          <dd>{pct(r.substantive_rate)}</dd>
          <dt>Merged with no human approval</dt>
          <dd>{pct(r.zero_human_share)}</dd>
          <dt>Humans per change, median / p95</dt>
          <dd>
            {r.humans_per_change.median} / {r.humans_per_change.p95}
          </dd>
          <dt>Waiting on a person now, median / p95</dt>
          <dd>
            {hours(r.wait_on_human_hours.median)} / {hours(r.wait_on_human_hours.p95)}
          </dd>
          <dt>Tokens spent</dt>
          <dd>
            {compact(r.tokens_30d.in)} in, {compact(r.tokens_30d.out)} out
          </dd>
        </dl>
        <div className="outcomes" aria-hidden="true">
          {parts.map((p) => (
            <span key={p.k} style={{ flex: o[p.k] || 0, "--c": p.c } as React.CSSProperties} />
          ))}
        </div>
        <div className="legend">
          {parts.map((p) => (
            <span key={p.k} style={{ "--c": p.c } as React.CSSProperties}>
              {p.label} {pct((o[p.k] || 0) / total)}
            </span>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          How authors answered {total.toLocaleString()} resolved findings. "Wrong" is the reviewer's false-positive rate.
        </div>
      </div>
    </Panel>
  );
}
