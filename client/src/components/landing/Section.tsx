import type { ReactNode } from "react";

/** título y bajada de una sección de la landing, con el ritmo fijo de 96 px */
export function Section({
  id,
  title,
  lead,
  aside,
  split = false,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  aside?: ReactNode;
  /** título a la izquierda y contenido a la derecha (preguntas frecuentes) */
  split?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-titulo`}
      id={id}
      className="scroll-mt-20 pt-16 sm:pt-24"
    >
      <div
        className={`mx-auto max-w-6xl px-4 sm:px-6 ${
          split ? "grid gap-4 lg:grid-cols-[4fr_8fr] lg:gap-10" : ""
        }`}
      >
        <div
          className={`flex flex-wrap items-end justify-between gap-4 ${
            split ? "self-start" : "mb-6 sm:mb-10"
          }`}
        >
          <div>
            <h2
              id={`${id}-titulo`}
              className="font-display text-[clamp(26px,3vw,34px)] leading-tight font-semibold"
            >
              {title}
            </h2>
            {lead && (
              <p className="mt-2 max-w-[60ch] text-[17px] text-ink-soft">{lead}</p>
            )}
          </div>
          {aside}
        </div>
        {children}
      </div>
    </section>
  );
}
