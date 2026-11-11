import { useEffect, useState } from "react";

const PALETTE = ["#F58220", "#0B3D5C", "#2E8B57", "#F2B705", "#993C1D"];

/** un tramo de la barra; sin `label` es ocupación sin nombre (vista de terceros) */
export type CargoFillItem = { label?: string; volume: number };

type Props = {
  capacityTotal: number;
  items: CargoFillItem[];
  /** cargas vivas del viaje (para terceros, la barra es un solo tramo) */
  cargoCount: number;
  className?: string;
};

/** "7" o "2,5": los m³ como se leen en castellano */
function formatM3(n: number) {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
}

function occupancyLine(cargoCount: number, used: number, capacityTotal: number) {
  const free = `quedan ${formatM3(Math.max(0, capacityTotal - used))} m³ libres.`;
  if (cargoCount === 0) return `todavía no hay cargas en este viaje. ${free}`;
  const cargas = cargoCount === 1 ? "1 carga" : `${cargoCount} cargas`;
  return `ya hay ${cargas} en este viaje (${formatM3(used)} m³). ${free}`;
}

/**
 * Franja que se llena con las cargas del viaje (TripDetail). Cada tramo lleva
 * la etiqueta que el rol puede ver: la descripción para el fletero y para la
 * carga propia, "otra carga" para las ajenas, y ninguna para terceros (U7).
 * En pantallas chicas, las etiquetas inline se reemplazan por una leyenda
 * debajo de la barra para no romper el layout con texto recortado.
 */
export function CargoFillDiagram({
  capacityTotal,
  items,
  cargoCount,
  className = "",
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 150);
    return () => clearTimeout(t);
  }, []);

  const used = items.reduce((sum, i) => sum + i.volume, 0);
  const usedPct =
    capacityTotal > 0 ? Math.min(100, Math.round((used / capacityTotal) * 100)) : 0;

  const segments = items.map((item, i) => ({
    ...item,
    pct: capacityTotal > 0 ? (item.volume / capacityTotal) * 100 : 0,
    color: PALETTE[i % PALETTE.length],
  }));
  const labeled = segments.filter((seg) => seg.label);

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
              key={i}
              className="relative flex h-full items-end justify-start overflow-hidden transition-[width] ease-out"
              style={{
                width: mounted ? `${seg.pct}%` : "0%",
                backgroundColor: seg.color,
                transitionDuration: "700ms",
                transitionDelay: `${i * 220}ms`,
              }}
            >
              {seg.label && (
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
              )}
            </div>
          ))}
        </div>
        <div
          className="absolute inset-y-0 border-l border-dashed border-line-dashed"
          style={{ left: `${usedPct}%` }}
        />
      </div>

      {labeled.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 sm:hidden">
          {labeled.map((seg, i) => (
            <li key={i} className="flex items-center gap-1.5 text-xs text-ink-soft">
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
        {occupancyLine(cargoCount, used, capacityTotal)}
      </p>
    </div>
  );
}
