import { type ReactNode, useState } from "react";

interface Props {
  /** Stable id; the open/closed state is remembered per browser under it. */
  id: string;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

const KEY = "gauntlet.panels";

function readState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeState(id: string, collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readState(), [id]: collapsed }));
  } catch {
    // Storage can be unavailable in private windows; the panel still toggles for this page view.
  }
}

/** A titled card whose body folds away. The chevron and the title are one button. */
export function Panel({ id, title, aside, children, className }: Props) {
  const [collapsed, setCollapsed] = useState(() => readState()[id] === true);
  const toggle = () => {
    setCollapsed((c) => {
      writeState(id, !c);
      return !c;
    });
  };
  return (
    <section className={`panel${collapsed ? " collapsed" : ""}${className ? ` ${className}` : ""}`}>
      <div className="panel-head">
        <button className="panel-toggle" onClick={toggle} aria-expanded={!collapsed}>
          <span className="chev" aria-hidden="true" />
          <h2>{title}</h2>
        </button>
        {!collapsed && aside}
      </div>
      {!collapsed && children}
    </section>
  );
}
