import { FEATURE_META } from "../lib/tripFeatures";
import type { TripFeature } from "../types/trip";

export function TripFeatureBadge({ feature }: { feature: TripFeature }) {
  const { label, Icon } = FEATURE_META[feature];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-canvas-line px-2.5 py-1 text-xs font-medium text-ink-soft">
      <Icon size={13} aria-hidden />
      {label}
    </span>
  );
}
