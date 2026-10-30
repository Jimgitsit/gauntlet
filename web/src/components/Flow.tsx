// Fourteen days of flow: opened next to merged per day, reverts as a thin cap
// on the merged bar. One axis, hairline grid, labels on the ends only.

import { useState } from "react";
import type { Overview } from "../api";

export function Flow({ days }: { days: Overview["days"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520;
  const H = 150;
  const padL = 28;
  const padB = 20;
  const padT = 10;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const max = Math.max(1, ...days.map((d) => Math.max(d.opened, d.merged)));
  const step = plotW / days.length;
  const barW = Math.max(3, step * 0.36);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const ticks = [0, Math.round(max / 2), max];
  return (
    <div>
      <svg className="flow" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Changes opened and merged per day over the last fourteen days">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x0 = padL + i * step + (step - barW * 2 - 2) / 2;
          const on = hover === i;
          return (
            <g key={d.day} opacity={hover === null || on ? 1 : 0.45} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * step} y={padT} width={step} height={plotH} fill="transparent" />
              <rect className="opened" x={x0} y={y(d.opened)} width={barW} height={Math.max(0, y(0) - y(d.opened))} rx={2} />
              <rect className="merged" x={x0 + barW + 2} y={y(d.merged)} width={barW} height={Math.max(0, y(0) - y(d.merged))} rx={2} />
              {d.reverted > 0 && <rect className="reverted" x={x0 + barW + 2} y={y(d.merged)} width={barW} height={Math.max(2, (d.reverted / max) * plotH)} rx={2} />}
              {(i === 0 || i === days.length - 1 || i === 7) && (
                <text x={padL + i * step + step / 2} y={H - 6} textAnchor="middle">
                  {d.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span style={{ "--c": "var(--s-reviewing)" } as React.CSSProperties}>Opened</span>
        <span style={{ "--c": "var(--s-ready)" } as React.CSSProperties}>Merged</span>
        <span style={{ "--c": "var(--s-blocked)" } as React.CSSProperties}>Reverted</span>
        {hover !== null && (
          <span className="muted" style={{ marginLeft: "auto" }}>
            {days[hover].day}: {days[hover].opened} opened, {days[hover].merged} merged, {days[hover].reverted} reverted
          </span>
        )}
      </div>
    </div>
  );
}
