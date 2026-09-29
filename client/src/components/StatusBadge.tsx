import type { TripStatus } from "../types/trip";
import { TRIP_STATUS_LABELS } from "../types/trip";

const STATUS_STYLES: Record<TripStatus, string> = {
  OPEN: "bg-success-bg text-success-deep",
  FULL: "bg-step-1 text-accent-ink",
  IN_TRANSIT: "bg-step-2 text-brand",
  COMPLETED: "bg-line text-ink-soft",
};

export function StatusBadge({ status }: { status: TripStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {TRIP_STATUS_LABELS[status]}
    </span>
  );
}
