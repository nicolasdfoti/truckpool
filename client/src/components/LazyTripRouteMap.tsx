import { Suspense, lazy, type ComponentProps } from "react";

// El mapa del recorrido arrastra Leaflet (~145 kB) igual que el de tracking, pero
// son pantallas distintas: si lo cargamos en el bundle principal, pesa en todas.
// Va en su propio chunk, como TripMap y TripPinMap.
const TripRouteMap = lazy(() =>
  import("./TripRouteMap").then((mod) => ({ default: mod.TripRouteMap }))
);

type TripRouteMapProps = ComponentProps<typeof TripRouteMap>;

/** Igual que LazyTripMap: mismo mapa, con placeholder de la misma altura. */
export function LazyTripRouteMap({ className = "", ...props }: TripRouteMapProps) {
  return (
    <Suspense
      fallback={
        <div
          className={`animate-pulse rounded-[10px] border border-line bg-canvas ${className}`}
          aria-hidden
        />
      }
    >
      <TripRouteMap className={className} {...props} />
    </Suspense>
  );
}
