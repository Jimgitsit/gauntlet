import { useVirtualizer } from "@tanstack/react-virtual";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { type ChangeRow, type Overview, type Status, useFetch } from "../api";
import { StatTiles, openSummary } from "../components/StatTiles";
import { StatusPill } from "../components/StatusPill";
import { STATUS_LABEL, STATUS_ORDER, ago, compact, shortRepo, updated } from "../format";
import { href, setQuery, useQuery } from "../router";

type SortKey = "updated" | "age" | "wait" | "findings" | "size" | "rounds" | "repo";

export function ChangeList() {
  const q = useQuery();
  const status = (q.get("status") as Status | null) ?? null;
  const repoId = q.get("repo") ? Number(q.get("repo")) : null;
  const risk = q.get("risk");
  const author = q.get("author");
  const [search, setSearch] = useState(q.get("q") ?? "");
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "wait", dir: 1 });

  const ov = useFetch<Overview>("/overview", { pollMs: 8000 });
  const list = useFetch<{ changes: ChangeRow[] }>("/changes?state=open", { pollMs: 15000 });

  const rows = useMemo(() => {
    const all = list.data?.changes ?? [];
    const needle = deferredSearch.trim().toLowerCase();
    const filtered = all.filter((c) => {
      if (status && c.status !== status) {
        return false;
      }
      if (repoId !== null && c.repo_id !== repoId) {
        return false;
      }
      if (risk && c.risk_tier !== risk) {
        return false;
      }
      if (author && c.author !== author) {
        return false;
      }
      if (needle && !(`${c.title} ${c.author} ${c.repo} #${c.number}`.toLowerCase().includes(needle))) {
        return false;
      }
      return true;
    });
    // Each comparator sorts ascending by its natural value; dir flips it.
    // For time keys, ascending means oldest first, which is "longest wait first".
    const t = (s: string | null) => (s ? Date.parse(s) : 0);
    const cmp = (a: ChangeRow, b: ChangeRow): number => {
      switch (sort.key) {
        case "repo":
          return a.repo.localeCompare(b.repo) || a.number - b.number;
        case "age":
          return t(a.opened_at) - t(b.opened_at);
        case "wait":
          return t(a.waiting_since ?? a.updated_at) - t(b.waiting_since ?? b.updated_at);
        case "findings":
          return a.open_security * 100 + a.open_important * 10 + a.open_nit - (b.open_security * 100 + b.open_important * 10 + b.open_nit);
        case "size":
          return a.additions + a.deletions - (b.additions + b.deletions);
        case "rounds":
          return a.rounds - b.rounds;
        default:
          return t(a.updated_at) - t(b.updated_at);
      }
    };
    filtered.sort((a, b) => sort.dir * cmp(a, b));
    return filtered;
  }, [list.data, status, repoId, risk, author, deferredSearch, sort]);

  // First click on a numeric column shows the biggest values; on repo and wait, A to Z and longest wait.
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "repo" || key === "wait" || key === "age" ? 1 : -1 }));

  const activeLane = ov.data?.lanes.find((l) => l.repo_id === repoId);
  const anyFilter = status || repoId !== null || risk || author || search;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Changes</h1>
          <div className="sub">{openSummary(ov.data)}</div>
        </div>
        {ov.data && (
          <div className="muted" style={{ fontSize: 12.5 }}>
            {updated(ov.data.generated_at)}
          </div>
        )}
      </div>

      <StatTiles overview={ov.data} stale={ov.loading && Boolean(ov.data)} active={status} onPick={(s) => setQuery({ status: status === s ? null : s })} />

      <div className="filters">
        <input type="search" placeholder="Search title, author, repo or number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search changes" />
        <select value={status ?? ""} onChange={(e) => setQuery({ status: e.target.value || null })} aria-label="Status">
          <option value="">Any status</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select value={repoId ?? ""} onChange={(e) => setQuery({ repo: e.target.value || null })} aria-label="Repository">
          <option value="">Any repository</option>
          {(ov.data?.lanes ?? []).map((l) => (
            <option key={l.repo_id} value={l.repo_id}>
              {l.repo}
            </option>
          ))}
        </select>
        <select value={risk ?? ""} onChange={(e) => setQuery({ risk: e.target.value || null })} aria-label="Risk tier">
          <option value="">Any risk</option>
          <option value="high">High risk</option>
          <option value="medium">Medium risk</option>
          <option value="low">Low risk</option>
        </select>
        {author && (
          <button className="chip" onClick={() => setQuery({ author: null })}>
            Author: {author} ×
          </button>
        )}
        {anyFilter && (
          <button
            className="chip"
            onClick={() => {
              setSearch("");
              setQuery({ status: null, repo: null, risk: null, author: null, q: null });
            }}
          >
            Clear filters
          </button>
        )}
        <span className="count">
          {rows.length.toLocaleString()} {rows.length === 1 ? "change" : "changes"}
          {activeLane ? ` in ${activeLane.repo}` : ""}
        </span>
      </div>

      <Table rows={rows} sort={sort} onSort={toggleSort} loading={list.loading && !list.data} />
    </div>
  );
}

function Table({ rows, sort, onSort, loading }: { rows: ChangeRow[]; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; loading: boolean }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });
  const head = (label: string, key: SortKey, cls = "") => (
    <button className={`${sort.key === key ? "sorted" : ""} ${cls}`} onClick={() => onSort(key)}>
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </button>
  );
  return (
    <div className="table">
      <div className="thead">
        {head("Repository", "repo", "hide-xs")}
        <span>Change</span>
        <span className="hide-sm">Author</span>
        <span>Status</span>
        {head("Open findings", "findings", "hide-xs")}
        <span className="hide-sm">Risk</span>
        {head("Rounds", "rounds", "hide-sm")}
        {head("Size", "size", "hide-sm")}
        {head("Waiting", "wait", "hide-xs")}
      </div>
      <div className="tbody" ref={parentRef}>
        {loading ? (
          <div className="empty">Loading changes</div>
        ) : rows.length === 0 ? (
          <div className="empty">No open changes match these filters.</div>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((v) => {
              const c = rows[v.index];
              return (
                <a key={c.id} className="tr" href={href(`/changes/${c.id}`)} style={{ transform: `translateY(${v.start}px)` }}>
                  <span className="repo hide-xs" title={c.repo}>
                    {shortRepo(c.repo)}
                  </span>
                  <span className="title" title={c.title}>
                    <span className="num">#{c.number}</span>
                    {c.title}
                  </span>
                  <span className="author hide-sm">
                    {c.author}
                    {c.author_is_agent ? " (agent)" : ""}
                  </span>
                  <span>
                    <StatusPill status={c.status} />
                  </span>
                  <span className="findings hide-xs">
                    {c.open_security > 0 && (
                      <span className="sev important" title="Open security or data-loss findings">
                        <span className="n">{c.open_security}</span> security
                      </span>
                    )}
                    {c.open_important - c.open_security > 0 && (
                      <span className="sev important">
                        <span className="n">{c.open_important - c.open_security}</span> important
                      </span>
                    )}
                    {c.open_nit > 0 && (
                      <span className="sev nit">
                        <span className="n">{c.open_nit}</span> nit
                      </span>
                    )}
                    {c.open_pre > 0 && (
                      <span className="sev pre-existing">
                        <span className="n">{c.open_pre}</span> pre-existing
                      </span>
                    )}
                    {c.open_important + c.open_nit + c.open_pre === 0 && <span className="muted">none</span>}
                  </span>
                  <span className={`risk hide-sm ${c.risk_tier ?? ""}`} title={c.risk_tier ? `${c.human_approvals} of ${c.humans_required} required people have approved` : "Not yet classified"}>
                    {c.risk_tier ? `${c.risk_tier} ${c.human_approvals}/${c.humans_required}` : "unclassified"}
                  </span>
                  <span className="rounds hide-sm">{c.rounds}</span>
                  <span className="size hide-sm">
                    <span className="plus">+{compact(c.additions)}</span> <span className="minus">−{compact(c.deletions)}</span>
                  </span>
                  <span className="age hide-xs" title={`Opened ${ago(c.opened_at)} ago`}>
                    {ago(c.waiting_since ?? c.updated_at)}
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
