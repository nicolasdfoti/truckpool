/**
 * El semi del plano sobre una cuadrícula con el recorrido (hero 1). Es una
 * ilustración: la tarjeta de encima no es un viaje publicado, por eso no es un
 * link ni nombra a un fletero.
 */
export function HeroIllustration() {
  return (
    <div className="relative">
      <svg
        viewBox="0 0 600 470"
        role="img"
        aria-label="ilustración: un semi en ruta con parte de la caja ocupada y 16 m³ libres"
        className="block h-auto w-full"
      >
        <defs>
          <pattern id="lp-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="#dfe7ee" strokeWidth="1" />
          </pattern>
          <pattern
            id="lp-hatch"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="7" fill="#d6e3ec" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="#0b3d5c" strokeWidth="2" />
          </pattern>
          <marker
            id="lp-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill="#0b3d5c" />
          </marker>
        </defs>
        <rect width="600" height="470" rx="16" fill="#eef3f7" />
        <rect width="600" height="470" rx="16" fill="url(#lp-grid)" />

        {/* recorrido */}
        <path
          d="M70 176 C 120 110, 190 90, 250 120"
          fill="none"
          stroke="#0b3d5c"
          strokeWidth="2.5"
          strokeDasharray="8 8"
        />
        <g fill="#0b3d5c">
          <path d="M70 152a14 14 0 0 1 14 14c0 11-14 24-14 24s-14-13-14-24a14 14 0 0 1 14-14z" />
          <path d="M250 96a14 14 0 0 1 14 14c0 11-14 24-14 24s-14-13-14-24a14 14 0 0 1 14-14z" />
        </g>
        <g fill="#fff">
          <circle cx="70" cy="166" r="5" />
          <circle cx="250" cy="110" r="5" />
        </g>
        <g fontFamily="Inter, sans-serif" fontWeight="500" fontSize="17" fill="#15222e">
          <text x="70" y="216" textAnchor="middle">
            Mendoza
          </text>
          <text x="250" y="160" textAnchor="middle">
            Córdoba
          </text>
        </g>

        {/* el semi: la carga propia, las ajenas y el lugar libre */}
        <rect
          x="40"
          y="262"
          width="380"
          height="110"
          fill="#fff"
          stroke="#0b3d5c"
          strokeWidth="2.5"
        />
        <rect x="41.5" y="263.5" width="49" height="107" fill="#0b3d5c" />
        <rect x="93" y="263.5" width="124" height="107" fill="url(#lp-hatch)" />
        <line
          x1="226"
          y1="317"
          x2="412"
          y2="317"
          stroke="#0b3d5c"
          strokeWidth="1.5"
          markerStart="url(#lp-arrow)"
          markerEnd="url(#lp-arrow)"
        />
        <rect x="246" y="300" width="146" height="34" fill="#fff" />
        <text
          x="319"
          y="325"
          textAnchor="middle"
          fontFamily="'Space Grotesk', sans-serif"
          fontWeight="600"
          fontSize="24"
          fill="#0b3d5c"
        >
          16 m³ libres
        </text>
        <rect x="40" y="372" width="380" height="9" fill="#0b3d5c" />
        <path
          d="M432 300H490L526 336V381H432Z"
          fill="#fff"
          stroke="#0b3d5c"
          strokeWidth="2.5"
        />
        <path d="M474 310H487L514 336H474Z" fill="#d6e3ec" />
        <rect x="426" y="372" width="104" height="9" fill="#0b3d5c" />
        {[80, 114, 148, 460, 506].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="396" r="14" fill="#0b3d5c" />
            <circle cx={cx} cy="396" r="5" fill="#fff" />
          </g>
        ))}
        <line x1="20" y1="412" x2="580" y2="412" stroke="#9fb3c3" strokeWidth="2" />
        <g stroke="#9fb3c3" strokeWidth="2">
          {[40, 120, 200, 280, 360, 440, 520].map((x) => (
            <line key={x} x1={x} y1="432" x2={x + 40} y2="432" />
          ))}
        </g>
      </svg>

      <div
        aria-hidden="true"
        className="hidden rounded-xl border border-line bg-white p-4 sm:absolute sm:block sm:top-3 sm:right-3 sm:w-[250px] sm:shadow-[0_18px_40px_-24px_rgba(11,61,92,0.6)] lg:top-[26px] lg:-right-2"
      >
        <p className="font-display text-lg font-semibold">Córdoba → Mendoza</p>
        <p className="text-sm text-ink-soft">sale 08:00</p>
        <p className="mt-3 flex items-baseline justify-between">
          <b className="font-display text-xl font-semibold text-brand">16 m³ libres</b>
          <span>$ 100 por m³</span>
        </p>
      </div>
    </div>
  );
}
