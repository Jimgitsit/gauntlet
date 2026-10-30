import type { Overview, Status } from "../api";
import { STATUS_HINT, STATUS_LABEL, STATUS_ORDER } from "../format";

interface Props {
  overview: Overview | null;
  stale?: boolean;
  /** The tile that is currently filtering, if any. */
  active?: Status | null;
  onPick: (status: Status) => void;
}

/** Six open-change counts, one per status. Each tile is a button. */
export function StatTiles({ overview, stale, active, onPick }: Props) {
  const counts = overview?.counts;
  return (
    <div className={`stats${stale ? " stale" : ""}`}>
      {STATUS_ORDER.map((s) => (
        <button key={s} className={`stat${active === s ? " active" : ""}`} onClick={() => onPick(s)} title={STATUS_HINT[s]}>
          <span className="n" style={{ color: `var(--s-${s})` }}>
            {counts ? counts[s].toLocaleString() : ""}
          </span>
          <span className="l">{STATUS_LABEL[s]}</span>
          <span className="h">{STATUS_HINT[s]}</span>
        </button>
      ))}
    </div>
  );
}

export function openSummary(ov: Overview | null): string {
  if (!ov) {
    return "Loading";
  }
  const busy = ov.counts.reviewing + ov.counts.queued;
  return `${ov.open_total.toLocaleString()} open across ${ov.lanes.length} repositories${busy > 0 ? `, ${ov.counts.reviewing} in review and ${ov.counts.queued} queued` : ""}`;
}
