/**
 * La caja del camión en chico, para listados y tarjetas: lo ocupado rayado y lo
 * libre vacío, con el mismo lenguaje que el plano del detalle. Es decorativa:
 * los m³ libres van siempre escritos al lado.
 */
export function CapacityBar({
  capacityTotal,
  capacityUsed,
  className = "",
}: {
  capacityTotal: number;
  capacityUsed: number;
  className?: string;
}) {
  const pct =
    capacityTotal > 0
      ? Math.min(100, Math.max(0, (capacityUsed / capacityTotal) * 100))
      : 0;
  return (
    <div
      aria-hidden="true"
      className={`flex h-4 overflow-hidden rounded-[3px] border-[1.5px] border-brand bg-white ${className}`}
    >
      {pct > 0 && <span className="bg-hatch h-full" style={{ width: `${pct}%` }} />}
    </div>
  );
}
