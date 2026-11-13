import type { ReactNode } from "react";

const ICON = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

// cada garantía sale de una regla del server (docs/review/rediseno/referencias.md):
// si cambia la regla, cambia el texto
const GUARANTEES: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Pagás con Mercado Pago",
    body: "La seña y el saldo se pagan por Mercado Pago.",
    icon: (
      <svg {...ICON}>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18M7 15h4" />
      </svg>
    ),
  },
  {
    title: "Fleteros verificados",
    body: "Antes de publicar, revisamos el DNI o CUIT de cada fletero.",
    icon: (
      <svg {...ICON}>
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Si el viaje no sale, te devolvemos la seña",
    body: "Si el viaje se cancela, la seña vuelve completa.",
    icon: (
      <svg {...ICON}>
        <path d="M4 12a8 8 0 1 0 2.4-5.7" />
        <path d="M4 4v4h4" />
        <path d="M12 8.5v7M14 10c-.4-.6-1.1-1-2-1-1.1 0-2 .6-2 1.4 0 2 4 1 4 3 0 .8-.9 1.4-2 1.4-.9 0-1.6-.4-2-1" />
      </svg>
    ),
  },
  {
    title: "Seguí tu carga en el mapa",
    body: "Mientras el fletero comparte su ubicación, ves dónde va el camión.",
    icon: (
      <svg {...ICON}>
        <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z" />
        <circle cx="12" cy="10" r="2.2" />
      </svg>
    ),
  },
];

export function Guarantees() {
  return (
    <div className="border-t border-line bg-white">
      <ul aria-label="garantías" className="lp-guarantees mx-auto max-w-6xl px-4 sm:px-6">
        {GUARANTEES.map((g) => (
          <li key={g.title}>
            <span className="grid size-10 place-items-center rounded-[10px] bg-brand-tint text-brand">
              {g.icon}
            </span>
            <div>
              <strong className="block font-display text-base leading-snug font-semibold">
                {g.title}
              </strong>
              <p className="mt-0.5 text-sm text-ink-soft">{g.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
