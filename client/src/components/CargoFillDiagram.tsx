import { useId } from "react";

/**
 * Un tramo de la caja. `own` son las cargas que quien mira ve completas (las
 * suyas, o todas si es el fletero): van lisas. El resto va rayado: "otra carga"
 * para la empresa participante y sin `label` para terceros (U7).
 */
export type CargoFillItem = { label?: string; volume: number; own?: boolean };

type Props = {
  capacityTotal: number;
  items: CargoFillItem[];
  /** cargas vivas del viaje (para terceros, la caja es un solo tramo) */
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

// la caja del semi en el viewBox de 680 × 210
const BOX = { x: 20, y: 36, w: 520, h: 118 };
// cargas propias alternadas para que se distingan una de otra
const OWN_FILLS = ["#0b3d5c", "#3c6e91"];
const NAVY = "#0b3d5c";
// el tándem del semi va atrás (a la izquierda); el tractor, bajo la cabina
const WHEELS = [72, 108, 144, 586, 636];

/** dónde cae cada carga en la caja, una detrás de otra */
function layoutSegments(items: CargoFillItem[], scale: number, hatchId: string) {
  return items.reduce<
    (CargoFillItem & { x: number; width: number; fill: string; number: number | null })[]
  >((acc, item) => {
    const prev = acc[acc.length - 1];
    const x = prev ? prev.x + prev.width : BOX.x;
    const ownBefore = acc.filter((s) => s.own).length;
    acc.push({
      ...item,
      x,
      width: Math.min(item.volume * scale, BOX.x + BOX.w - x),
      fill: item.own ? OWN_FILLS[ownBefore % OWN_FILLS.length] : `url(#${hatchId})`,
      number: item.own ? ownBefore + 1 : null,
    });
    return acc;
  }, []);
}

/**
 * El camión de perfil, como un plano (rediseño A, la firma de TruckPool): la
 * caja se llena con las cargas y el espacio libre lleva su cota. Debajo, la
 * leyenda con lo que ve cada rol y la línea de ocupación.
 */
export function CargoFillDiagram({
  capacityTotal,
  items,
  cargoCount,
  className = "",
}: Props) {
  const hatchId = `rayado-${useId().replace(/:/g, "")}`;
  const arrowId = `flecha-${useId().replace(/:/g, "")}`;

  const used = items.reduce((sum, i) => sum + i.volume, 0);
  const free = Math.max(0, capacityTotal - used);
  const scale = capacityTotal > 0 ? BOX.w / capacityTotal : 0;
  // una sola carga propia entre ajenas se marca "tuya"; varias se numeran
  const numbered = items.filter((i) => i.own).length > 1;

  const segments = layoutSegments(items, scale, hatchId);
  const last = segments[segments.length - 1];
  const freeX = last ? last.x + last.width : BOX.x;
  const freeWidth = BOX.x + BOX.w - freeX;

  const ownItems = segments.filter((s) => s.own);
  const othersVolume = segments
    .filter((s) => !s.own && s.label)
    .reduce((sum, s) => sum + s.volume, 0);
  const reservedVolume = segments
    .filter((s) => !s.own && !s.label)
    .reduce((sum, s) => sum + s.volume, 0);

  const description = [
    `camión de ${formatM3(capacityTotal)} m³`,
    ...ownItems.map((s) => `${s.label ?? "tu carga"}: ${formatM3(s.volume)} m³`),
    othersVolume > 0 ? `otras cargas: ${formatM3(othersVolume)} m³` : null,
    reservedVolume > 0 ? `reservado: ${formatM3(reservedVolume)} m³` : null,
    `libre: ${formatM3(free)} m³`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className={className}>
      <svg
        viewBox="0 0 680 210"
        role="img"
        aria-label={description}
        className="block h-auto w-full"
      >
        <defs>
          <pattern
            id={hatchId}
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="7" fill="#d6e3ec" />
            <line x1="0" y1="0" x2="0" y2="7" stroke={NAVY} strokeWidth="2" />
          </pattern>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill={NAVY} />
          </marker>
        </defs>

        {/* cota de la capacidad total */}
        <g stroke="#4a5866" strokeWidth="1">
          <line x1={BOX.x} y1="18" x2={BOX.x + BOX.w} y2="18" />
          <line x1={BOX.x} y1="10" x2={BOX.x} y2="26" />
          <line x1={BOX.x + BOX.w} y1="10" x2={BOX.x + BOX.w} y2="26" />
        </g>
        <rect x={BOX.x + BOX.w / 2 - 52} y="0" width="104" height="34" fill="#fff" />
        <text
          x={BOX.x + BOX.w / 2}
          y="26"
          textAnchor="middle"
          fontFamily="Inter, sans-serif"
          fontSize="24"
          fill="#4a5866"
        >
          {formatM3(capacityTotal)} m³
        </text>

        {/* la caja y lo que lleva */}
        <rect
          x={BOX.x}
          y={BOX.y}
          width={BOX.w}
          height={BOX.h}
          fill="#fff"
          stroke={NAVY}
          strokeWidth="2.5"
        />
        {segments.map((seg, i) =>
          seg.width > 0 ? (
            <g key={i}>
              <rect
                x={seg.x + 1.5}
                y={BOX.y + 1.5}
                width={Math.max(0, seg.width - 2)}
                height={BOX.h - 3}
                fill={seg.fill}
              />
              {seg.own && seg.width >= 30 && (
                <text
                  x={seg.x + seg.width / 2}
                  y={BOX.y + BOX.h - 16}
                  textAnchor="middle"
                  fontFamily="Inter, sans-serif"
                  fontWeight="600"
                  fontSize="22"
                  fill="#fff"
                >
                  {numbered || seg.width < 64 ? seg.number : "tuya"}
                </text>
              )}
            </g>
          ) : null
        )}

        {/* la cota del espacio libre */}
        {free > 0 && freeWidth >= 40 && (
          <line
            x1={freeX + 10}
            y1={BOX.y + BOX.h / 2}
            x2={BOX.x + BOX.w - 10}
            y2={BOX.y + BOX.h / 2}
            stroke={NAVY}
            strokeWidth="1.5"
            markerStart={`url(#${arrowId})`}
            markerEnd={`url(#${arrowId})`}
          />
        )}
        {free > 0 && freeWidth >= 200 && (
          <>
            <rect
              x={freeX + freeWidth / 2 - 94}
              y={BOX.y + BOX.h / 2 - 21}
              width="188"
              height="42"
              fill="#fff"
            />
            <text
              x={freeX + freeWidth / 2}
              y={BOX.y + BOX.h / 2 + 10}
              textAnchor="middle"
              fontFamily="'Space Grotesk', sans-serif"
              fontWeight="600"
              fontSize="28"
              fill={NAVY}
            >
              {formatM3(free)} m³ libres
            </text>
          </>
        )}

        {/* chasis, cabina y ruedas */}
        <rect x={BOX.x} y={BOX.y + BOX.h} width={BOX.w} height="9" fill={NAVY} />
        <path
          d="M552 74H618L656 112V163H552Z"
          fill="#fff"
          stroke={NAVY}
          strokeWidth="2.5"
        />
        <path d="M600 84H614L643 112H600Z" fill="#d6e3ec" />
        <rect x="546" y="154" width="114" height="9" fill={NAVY} />
        {WHEELS.map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="178" r="15" fill={NAVY} />
            <circle cx={cx} cy="178" r="5" fill="#fff" />
          </g>
        ))}
        <line x1="0" y1="194" x2="680" y2="194" stroke="#d5dee6" strokeWidth="2" />
      </svg>

      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
        {ownItems.map((seg) => (
          <li key={`propia-${seg.number}`} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-grid size-4 shrink-0 place-items-center rounded-[3px] text-[10px] font-semibold text-white"
              style={{ backgroundColor: seg.fill }}
            >
              {numbered ? seg.number : null}
            </span>
            {seg.label ?? "Tu carga"}, {formatM3(seg.volume)} m³
          </li>
        ))}
        {othersVolume > 0 && (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-4 shrink-0 rounded-[3px] bg-hatch" />
            Otras cargas, {formatM3(othersVolume)} m³
          </li>
        )}
        {reservedVolume > 0 && (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-4 shrink-0 rounded-[3px] bg-hatch" />
            Reservado, {formatM3(reservedVolume)} m³
          </li>
        )}
        {free > 0 && (
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-4 shrink-0 rounded-[3px] border-[1.5px] border-brand bg-white"
            />
            Libre, {formatM3(free)} m³
          </li>
        )}
      </ul>

      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        {occupancyLine(cargoCount, used, capacityTotal)}
      </p>
    </div>
  );
}
