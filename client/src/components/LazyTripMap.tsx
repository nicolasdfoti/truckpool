import { Suspense, lazy, type ComponentProps } from "react";

// Leaflet pesa ~145 kB y solo hace falta en las dos pantallas con mapa, así que
// lo cargamos aparte: el resto de la app no paga por él.
const TripMap = lazy(() => import("./TripMap").then((mod) => ({ default: mod.TripMap })));

type TripMapProps = ComponentProps<typeof TripMap>;

/**
 * Mismo mapa que TripMap pero en su propio chunk, con un placeholder de la
 * misma altura para que la página no salte mientras carga.
 */
export function LazyTripMap({ className = "", ...props }: TripMapProps) {
  return (
    <Suspense
      fallback={
        <div
          className={`animate-pulse rounded-[10px] border border-line bg-canvas ${className}`}
          aria-hidden
        />
      }
    >
      <TripMap className={className} {...props} />
    </Suspense>
  );
}
