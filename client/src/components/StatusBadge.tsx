import type { TripStatus } from "../types/trip";
import { TRIP_STATUS_LABELS } from "../types/trip";
import { Chip, type ChipTone } from "./Chip";

const STATUS_TONES: Record<TripStatus, ChipTone> = {
  OPEN: "open",
  FULL: "neutral",
  IN_TRANSIT: "progress",
  COMPLETED: "ok",
  CANCELLED: "danger",
};

export function StatusBadge({ status }: { status: TripStatus }) {
  return <Chip tone={STATUS_TONES[status]}>{TRIP_STATUS_LABELS[status]}</Chip>;
}
