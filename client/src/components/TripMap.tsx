import { useEffect, useRef } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { TripLocationPoint } from "../types/trip";

type TripMapProps = {
  /** Última posición conocida. Si es null todavía no hay nada para dibujar. */
  location: TripLocationPoint | null;
  /** Si viene, se dibuja el recorrido completo además del último punto. */
  track?: TripLocationPoint[];
  className?: string;
};

// pin hecho con un div en vez del marker default de Leaflet: el marker default
// rompe con los bundlers (busca sus PNG por una ruta que no existe) y además
// este se ve con la paleta de la app.
const pinIcon = L.divIcon({
  className: "",
  html: '<div style="width:16px;height:16px;border-radius:9999px;background:#0b3d5c;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const startIcon = L.divIcon({
  className: "",
  html: '<div style="width:10px;height:10px;border-radius:9999px;background:#f58220;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

/**
 * Encaja el mapa en el recorrido una sola vez. Si lo ajustáramos en cada poll,
 * le robaríamos el zoom y el paneo del usuario cada 15 segundos.
 */
function FitBoundsOnce({ points }: { points: TripLocationPoint[] }) {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    const bounds: LatLngBoundsExpression = points.map((p) => [p.lat, p.lng]);
    if (points.length === 1) {
      map.setView(bounds[0] as [number, number], 12);
      return;
    }
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, points]);

  return null;
}

export function TripMap({ location, track, className = "" }: TripMapProps) {
  if (!location) {
    return (
      <div
        className={`flex items-center justify-center rounded-[10px] border border-dashed border-line-strong bg-soft px-4 py-10 text-center text-[13px] text-ink-muted ${className}`}
      >
        todavía no hay ubicación compartida.
      </div>
    );
  }

  const path = (track ?? []).map((p) => [p.lat, p.lng] as [number, number]);
  const fitPoints = path.length > 0 ? track! : [location];

  return (
    <div className={`isolate overflow-hidden rounded-[10px] border border-line ${className}`}>
      <MapContainer
        center={[location.lat, location.lng]}
        zoom={12}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        {/* OpenStreetMap no necesita key: es el tile server público. La
            atribución es parte de su política de uso, por eso va explícita. */}
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        {path.length > 1 && (
          <Polyline positions={path} color="#0b3d5c" weight={4} opacity={0.85} />
        )}
        {path.length > 1 && (
          <Marker position={path[0] as [number, number]} icon={startIcon} />
        )}
        <Marker position={[location.lat, location.lng]} icon={pinIcon} />
        <FitBoundsOnce points={fitPoints} />
      </MapContainer>
    </div>
  );
}
