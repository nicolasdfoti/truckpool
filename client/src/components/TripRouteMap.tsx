import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { RoutePoint, TripRoute } from "../types/trip";

type TripRouteMapProps = {
  route: TripRoute;
  /**
   * Geometría real de la ruta en formato GeoJSON LineString ([lng, lat]).
   * null o undefined = OSRM no respondió: se dibuja la línea recta entre los
   * puntos, sin avisarle nada al usuario.
   */
  geometry?: [number, number][] | null;
  className?: string;
};

/** El mapa arranca siempre sobre el primer punto: nunca hay recorrido vacío. */
const DEFAULT_ZOOM = 4;

/**
 * Marker numerado con el color del tipo de punto. Es un divIcon (no el marker
 * default de Leaflet) por lo mismo que en el resto de los mapas: el default
 * rompe con los bundlers y este usa la paleta de la app.
 */
function numberedIcon(kind: RoutePoint["kind"], order: number) {
  const color = kind === "DEPARTURE" ? "#0b3d5c" : kind === "DESTINATION" ? "#f58220" : "#7a3fb5";
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:9999px;background:${color};color:#fff;font-size:12px;font-weight:700;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)">${order}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/**
 * Encaja el mapa en el recorrido una sola vez, con la misma clave de la ruta:
 * si el fletero reordena las paradas el recorrido cambia y tiene que volver a
 * encuadrar, pero un re-render cualquiera no le roba el zoom al usuario.
 */
function FitToRoute({ routeKey, points }: { routeKey: string; points: [number, number][] }) {
  const map = useMap();
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastKey.current === routeKey) return;
    lastKey.current = routeKey;
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 11);
      return;
    }
    map.fitBounds(points as LatLngBoundsExpression, { padding: [32, 32] });
  }, [map, points, routeKey]);

  return null;
}

/**
 * Mapa del recorrido del viaje: un marker numerado por punto (1 = salida, en
 * medio las paradas de retiro, último = destino) y una línea que los conecta en
 * ese orden.
 *
 * La línea es la ruta real de OSRM cuando está disponible. Si no —servicio caído,
 * timeout, viaje sin coordenadas suficientes— se dibuja la recta entre los
 * puntos, que alcanza para entender el orden y no rompe la pantalla. Nunca se le
 * muestra un error al usuario por esto: el recorrido sigue siendo útil.
 */
export function TripRouteMap({ route, geometry, className = "" }: TripRouteMapProps) {
  const points = useMemo<[number, number][]>(
    () => route.points.map((p) => [p.lat, p.lng]),
    [route.points]
  );

  if (points.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-[10px] border border-dashed border-line-strong bg-soft px-4 py-10 text-center text-[13px] text-ink-muted ${className}`}
      >
        este viaje todavía no tiene puntos en el mapa.
      </div>
    );
  }

  // GeoJSON viene como [lng, lat]; Leaflet quiere [lat, lng].
  const realLine = geometry && geometry.length > 1
    ? geometry.map(([lng, lat]) => [lat, lng] as [number, number])
    : null;
  // fallback: la recta entre los puntos, en orden de recorrido
  const straightLine = points.length > 1 ? points : null;

  // La clave cambia si cambia el recorrido (paradas o estado): es lo que
  // dispara el re-encuadre.
  const routeKey = route.points.map((p) => p.cargoItemId ?? p.kind).join("|");

  return (
    <div className={`isolate overflow-hidden rounded-[10px] border border-line ${className}`}>
      <MapContainer
        center={points[0]}
        zoom={points.length > 1 ? 11 : DEFAULT_ZOOM}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />

        {realLine ? (
          // ruta real siguiendo calles (OSRM)
          <Polyline positions={realLine} color="#0b3d5c" weight={4} opacity={0.85} />
        ) : (
          // fallback silencioso: recta entre los puntos, en orden
          straightLine && (
            <Polyline
              positions={straightLine}
              color="#0b3d5c"
              weight={3}
              opacity={0.6}
              dashArray="6 8"
            />
          )
        )}

        {route.points.map((point) => (
          <Marker
            key={`${point.cargoItemId ?? point.kind}-${point.order}`}
            position={[point.lat, point.lng]}
            icon={numberedIcon(point.kind, point.order)}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              <strong>{point.order}. {point.label}</strong>
              <br />
              {point.address}
              {point.trackingCode && (
                <>
                  <br />
                  <code>{point.trackingCode}</code>
                </>
              )}
            </Tooltip>
          </Marker>
        ))}

        <FitToRoute routeKey={routeKey} points={points} />
      </MapContainer>
    </div>
  );
}
