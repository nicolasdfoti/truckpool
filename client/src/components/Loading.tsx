import type { ReactNode } from "react";

/**
 * Estados de carga compartidos. Todas las páginas que hacen fetch usan estos
 * bloques en vez de inventar un spinner propio: la pantalla parpadea menos y
 * el sitio se ve igual en todos lados.
 *
 * Todo lo que se ve es `aria-hidden` y acompaña un texto `sr-only` con
 * role="status": para un lector de pantalla el contenido importante es "está
 * cargando", no un cuadrado gris.
 */

export function SkeletonBar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-canvas-line ${className}`} />;
}

/** Envoltura semántica: anuncia la carga y oculta lo puramente decorativo. */
export function LoadingBlock({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** Tarjeta de viaje/carrier, con la misma silueta que la real. */
export function SkeletonCard() {
  return (
    <div className="rounded-[10px] border border-line bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <SkeletonBar className="h-8 w-8 rounded-full" />
        <div className="flex-1 space-y-2">
          <SkeletonBar className="h-3.5 w-2/5" />
          <SkeletonBar className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        <SkeletonBar className="h-4 w-4/5" />
        <SkeletonBar className="h-3 w-1/2" />
      </div>
      <div className="mt-5 flex items-center gap-3">
        <SkeletonBar className="h-4 w-24" />
        <SkeletonBar className="h-4 flex-1" />
      </div>
    </div>
  );
}

/** Grilla de tarjetas, para listados. Se anuncia sola: es el bloque que usan
 *  los listados, así que no hace falta envolverlo en otro LoadingBlock. */
export function SkeletonList({
  count = 6,
  label = "cargando",
  className = "",
}: {
  count?: number;
  label?: string;
  className?: string;
}) {
  return (
    <LoadingBlock label={label}>
      <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 ${className}`}>
        {Array.from({ length: count }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </LoadingBlock>
  );
}
