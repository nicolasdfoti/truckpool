import { useEffect, useState } from "react";

const PALETTE = ["#F58220", "#0B3D5C", "#2E8B57", "#F2B705", "#993C1D"];

export type CargoFillItem = { label: string; volume: number };

type Props = {
  capacityTotal: number;
  items: CargoFillItem[];
  className?: string;
};

/**
 * Franja que se llena con cada CargoItem del viaje. Se usa tanto en el hero
 * (con datos de ejemplo) como en TripDetail (con datos reales de la API).
 * En pantallas chicas, las etiquetas inline se reemplazan por una leyenda
 * debajo de la barra para no romper el layout con texto recortado.
 */
export function CargoFillDiagram({ capacityTotal, items, className = "" }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 150);
    return () => clearTimeout(t);
  }, []);

  const used = items.reduce((sum, i) => sum + i.volume, 0);
  const usedPct =
    capacityTotal > 0 ? Math.min(100, Math.round((used / capacityTotal) * 100)) : 0;
  const freePct = Math.max(0, 100 - usedPct);

  const segments = items.map((item, i) => ({
    ...item,
    pct: capacityTotal > 0 ? (item.volume / capacityTotal) * 100 : 0,
    color: PALETTE[i % PALETTE.length],
  }));

  return (
    <div className={className}>
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[13px] text-ink-muted">espacio ocupado</span>
        <span className="text-[13px] font-medium text-ink">{mounted ? usedPct : 0}%</span>
      </div>

      <div className="relative h-24 w-full overflow-hidden rounded-md border border-line bg-white">
        <div className="flex h-full w-full">
          {segments.map((seg, i) => (
            <div
              key={seg.label + i}
              className="relative flex h-full items-end justify-start overflow-hidden transition-[width] ease-out"
              style={{
                width: mounted ? `${seg.pct}%` : "0%",
                backgroundColor: seg.color,
                transitionDuration: "700ms",
                transitionDelay: `${i * 220}ms`,
              }}
            >
              <span
                className="hidden whitespace-nowrap px-2 pb-1.5 text-[11px] font-medium text-white transition-opacity sm:inline"
                style={{
                  transitionDelay: `${i * 220 + 500}ms`,
                  transitionDuration: "300ms",
                  opacity: mounted ? 1 : 0,
                }}
              >
                {seg.label}
              </span>
            </div>
          ))}
        </div>
        <div
          className="absolute inset-y-0 border-l border-dashed border-line-dashed"
          style={{ left: `${usedPct}%` }}
        />
      </div>

      {segments.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 sm:hidden">
          {segments.map((seg, i) => (
            <li
              key={seg.label + i}
              className="flex items-center gap-1.5 text-xs text-ink-soft"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: seg.color }}
              />
              {seg.label}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
        {items.length === 0
          ? "todavía no hay carga cargada en este viaje."
          : `${items.length === 1 ? "una empresa" : `${items.length} empresas`} comparten este viaje.`}{" "}
        el {freePct}% que queda libre se sigue pudiendo ofertar.
      </p>
    </div>
  );
}
