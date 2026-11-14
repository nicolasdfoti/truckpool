import type { ReactNode } from "react";

/**
 * Escala fija de estados (03§4, rediseño A). Un chip dice en qué está algo; no
 * es un botón ni un adorno:
 * - neutral: pendiente, esperando a alguien;
 * - ok: acreditado, confirmado, completado;
 * - open: abierto, con lugar;
 * - progress: en proceso, en viaje;
 * - danger: vencido, rechazado, cancelado.
 */
export type ChipTone = "neutral" | "ok" | "open" | "progress" | "danger";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-wait-bg text-ink-soft",
  ok: "bg-success-bg text-success-deep",
  open: "bg-brand-tint text-brand",
  progress: "bg-step-2 text-brand",
  danger: "bg-danger-bg text-danger",
};

export function Chip({
  tone,
  children,
  className = "",
}: {
  tone: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium ${TONES[tone]} ${className}`}
    >
      <span aria-hidden="true" className="size-[7px] rounded-full bg-current" />
      {children}
    </span>
  );
}
