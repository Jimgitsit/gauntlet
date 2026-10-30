// One row per repository: a stacked bar of its open changes by status.
// This is the device that makes thousands of changes readable: the question
// "where do people need to look" is answered per repo before any row is read.

import { useState } from "react";
import type { Overview, Status } from "../api";
import { STATUS_LABEL, STATUS_ORDER, hours, shortRepo } from "../format";

interface Props {
  lanes: Overview["lanes"];
  activeRepo: number | null;
  onPick: (repoId: number | null, status: Status | null) => void;
}

export function Lanes({ lanes, activeRepo, onPick }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const max = Math.max(1, ...lanes.map((l) => l.total));
  return (
    <div>
      <div className="lanes" onMouseLeave={() => setTip(null)}>
        {lanes.map((l) => (
          <div
            key={l.repo_id}
            className={`lane${activeRepo === l.repo_id ? " active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onPick(activeRepo === l.repo_id ? null : l.repo_id, null)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(activeRepo === l.repo_id ? null : l.repo_id, null);
              }
            }}
          >
            <div className="name" title={l.repo}>
              {shortRepo(l.repo)}
              <small>
                {l.provider === "gitlab" ? "GitLab" : "GitHub"}, {l.depth} review
                {l.oldest_human_wait_hours !== null && l.oldest_human_wait_hours >= 24 ? `, waiting ${hours(l.oldest_human_wait_hours)}` : ""}
              </small>
            </div>
            <div className="bar" style={{ width: `${(l.total / max) * 100}%` }}>
              {STATUS_ORDER.filter((s) => l.counts[s] > 0).map((s) => (
                <div
                  key={s}
                  className={`seg ${s}`}
                  style={{ flex: l.counts[s] }}
                  onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${STATUS_LABEL[s]}: ${l.counts[s]} of ${l.total}` })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(l.repo_id, s);
                  }}
                  aria-label={`${STATUS_LABEL[s]}: ${l.counts[s]}`}
                />
              ))}
            </div>
            <div className="total">{l.total}</div>
          </div>
        ))}
      </div>
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
      <div className="legend" style={{ marginTop: 10 }}>
        {STATUS_ORDER.map((s) => (
          <span key={s} style={{ "--c": `var(--s-${s})` } as React.CSSProperties}>
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
