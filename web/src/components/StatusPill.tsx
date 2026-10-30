import type { Status } from "../api";
import { STATUS_LABEL } from "../format";

export function StatusPill({ status, label }: { status: Status | "merged"; label?: string }) {
  return <span className={`pill ${status}`}>{label ?? (status === "merged" ? "Merged" : STATUS_LABEL[status])}</span>;
}
