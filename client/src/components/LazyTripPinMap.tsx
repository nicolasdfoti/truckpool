import { Suspense, lazy, type ComponentProps } from "react";

// El mapa de publicación arrastra el mismo Leaflet (~145 kB) que el tracking,
// pero son pantallas distintas: si lo cargamos acá, el bundle de la página de
// publicación crece para siempre. Va en su propio chunk, como TripMap.
const TripPinMap = lazy(() =>
  import("./TripPinMap").then((mod) => ({ default: mod.TripPinMap }))
);

type TripPinMapProps = ComponentProps<typeof TripPinMap>;

/** Igual que LazyTripMap: mismo mapa, con placeholder de la misma altura. */
export function LazyTripPinMap({ className = "", ...props }: TripPinMapProps) {
  return (
    <Suspense
      fallback={
        <div
          className={`animate-pulse rounded-[10px] border border-line bg-canvas ${className}`}
          aria-hidden
        />
      }
    >
      <TripPinMap className={className} {...props} />
    </Suspense>
  );
}
