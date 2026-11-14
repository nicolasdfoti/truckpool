import type { ReactNode } from "react";

/** done: ya pasó · now: lo que toca ahora (el único en naranja) · later: falta */
export type MoneyStepState = "done" | "now" | "later";

export type MoneyStep = {
  /** "Reserva", "Seña", "Confirmación", "Salida", "Saldo" */
  what: string;
  state: MoneyStepState;
  /** cuándo pasó o cuándo vence; o quién lo hace */
  when?: ReactNode;
  /** el monto ya formateado, si el paso mueve plata */
  amount?: ReactNode;
};

const DOT: Record<MoneyStepState, string> = {
  done: "border-brand bg-brand",
  now: "border-[3px] border-accent bg-white",
  later: "border-line bg-white",
};

/**
 * La línea de tiempo del dinero (03§4, rediseño A): reserva → seña →
 * confirmación → salida → saldo. Dice en qué paso está la carga y cuánto se
 * paga en cada uno; los pasos que faltan van atenuados.
 */
export function MoneyTimeline({
  steps,
  label = "pasos de la reserva",
  className = "",
}: {
  steps: MoneyStep[];
  label?: string;
  className?: string;
}) {
  return (
    <ol aria-label={label} className={`m-0 list-none p-0 ${className}`}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const muted = step.state === "later";
        return (
          <li
            key={step.what}
            className="relative grid grid-cols-[24px_1fr_auto] gap-x-3 pb-4 last:pb-0"
          >
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute top-[24px] -bottom-0.5 left-[11px] w-0.5 ${
                  step.state === "done" ? "bg-brand" : "bg-line"
                }`}
              />
            )}
            <span
              aria-hidden="true"
              className={`relative z-[1] grid size-6 place-items-center rounded-full border-2 ${DOT[step.state]}`}
            >
              {step.state === "done" && (
                <svg viewBox="0 0 12 12" className="size-3" fill="none">
                  <path
                    d="M2.5 6.2L5 8.5L9.5 3.5"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {step.state === "now" && <span className="size-2 rounded-full bg-accent" />}
            </span>
            <span className={muted ? "text-ink-soft" : "font-medium text-ink"}>
              {step.what}
              {step.state === "now" && <span className="sr-only"> (ahora)</span>}
              {step.state === "done" && <span className="sr-only"> (hecho)</span>}
            </span>
            {step.amount != null && (
              <span
                className={`col-start-3 row-start-1 text-right ${
                  muted ? "text-ink-soft" : "font-semibold text-ink"
                }`}
              >
                {step.amount}
              </span>
            )}
            {step.when != null && (
              <span className="col-start-2 col-end-4 text-sm text-ink-soft">
                {step.when}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
