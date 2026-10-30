import { useEffect, useState } from "react";
import { api, type WikiIndex, useFetch } from "../api";
import { Markdown } from "../components/Markdown";
import { ago } from "../format";
import { href, setQuery, useQuery } from "../router";

interface Page {
  path: string;
  title: string;
  content: string;
  updated_by: string;
  updated_at: string;
}

export function Wiki() {
  const q = useQuery();
  const path = q.get("page") ?? "index.md";
  const index = useFetch<WikiIndex>("/wiki", { pollMs: 10000 });
  const page = useFetch<{ page: Page }>(`/wiki/page?path=${encodeURIComponent(path)}`);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setEditing(false);
  }, [path]);

  const pages = index.data?.pages ?? [];
  const groups = groupByDir(pages.map((p) => p.path));

  async function save() {
    await api("/wiki/page", { method: "PUT", body: JSON.stringify({ path, content: draft }) });
    setEditing(false);
    page.reload();
    index.reload();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Team wiki</h1>
          <div className="sub">What the reviewer knows about your code. It reads these pages before every review and writes back what it learns.</div>
        </div>
      </div>
      <div className="wiki">
        <div>
          <div className="panel tree-scroll" style={{ marginBottom: 18 }}>
            <ul className="tree">
              {groups.map((g) => (
                <li key={g.dir || "/"}>
                  {g.dir && <div className="dir">{g.dir}</div>}
                  <ul className="tree" style={{ padding: 0 }}>
                    {g.files.map((f) => (
                      <li key={f}>
                        <a className={f === path ? "active" : ""} href={href(`/wiki?page=${encodeURIComponent(f)}`)}>
                          {f.slice(g.dir ? g.dir.length + 1 : 0)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Recent changes</h2>
            </div>
            <ul className="wiki-log tree" style={{ padding: "4px 14px" }}>
              {(index.data?.log ?? []).slice(0, 25).map((l) => (
                <li key={l.id}>
                  <time>{ago(l.ts)}</time>
                  <a href={href(`/wiki?page=${encodeURIComponent(l.path)}`)}>{l.path}</a>: {l.summary} ({l.by})
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="panel">
          {page.error ? (
            <div className="empty">
              {page.error}.{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), setQuery({ page: null }))}>
                Back to the index
              </a>
              .
            </div>
          ) : page.data ? (
            <>
              <div className="panel-head">
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {page.data.page.path} · updated {ago(page.data.page.updated_at)} ago by {page.data.page.updated_by}
                </span>
                {editing ? (
                  <span className="row">
                    <button className="btn small primary" onClick={save}>
                      Save
                    </button>
                    <button className="btn small" onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    className="btn small"
                    onClick={() => {
                      setDraft(page.data!.page.content);
                      setEditing(true);
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
              {editing ? (
                <div className="panel-body">
                  <div className="field">
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 420 }} />
                  </div>
                </div>
              ) : (
                <Markdown text={page.data.page.content} currentPath={page.data.page.path} linkTo={(p) => href(`/wiki?page=${encodeURIComponent(p)}`)} />
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function groupByDir(paths: string[]): { dir: string; files: string[] }[] {
  const map = new Map<string, string[]>();
  for (const p of paths) {
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const list = map.get(dir) ?? [];
    list.push(p);
    map.set(dir, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0])))
    .map(([dir, files]) => ({ dir, files: files.sort() }));
}
