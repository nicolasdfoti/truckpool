import type { ComponentType } from "react";
import { CheckCircle, ShieldCheck, TrendingUp } from "../components/icons";
import type { TripFeature } from "../types/trip";

export const FEATURE_META: Record<
  TripFeature,
  { label: string; Icon: ComponentType<{ className?: string; size?: number }> }
> = {
  refrigeracion: { label: "refrigeración", Icon: CheckCircle },
  seguro: { label: "seguro incluido", Icon: ShieldCheck },
  carga_fragil: { label: "carga frágil", Icon: CheckCircle },
  expreso: { label: "expreso", Icon: TrendingUp },
  carga_y_descarga: { label: "carga y descarga", Icon: CheckCircle },
};
