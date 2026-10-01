import { useEffect, useRef } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { LatLng } from "../lib/geo";

type TripPinMapProps = {
  origin: LatLng | null;
  destination: LatLng | null;
  onOriginChange: (point: LatLng) => void;
  onDestinationChange: (point: LatLng) => void;
  /**
   * Punto exacto de partida (depósito/galpón). Opcional: si viene null no se
   * dibuja, y el mapa sigue siendo el de dos extremos de siempre.
   */
  departure?: LatLng | null;
  onDepartureChange?: (point: LatLng) => void;
  /**
   * Identidad del punto de vista. Cambia solo cuando llega un geocode nuevo
   * (no cuando el fletero mueve un pin): encuadrar en cada drag le robaría el
   * mapa de debajo del cursor.
   */
  fitKey: string;
  className?: string;
};

const pin = (color: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

const originIcon = pin("#0b3d5c");
const destinationIcon = pin("#f58220");
// el punto exacto de partida va en verde con un anillo azul, para distinguirlo
// del origin general (que sigue siendo el azul) cuando están cerca uno del otro.
const departureIcon = L.divIcon({
  className: "",
  html: '<div style="width:16px;height:16px;border-radius:9999px;background:#16a34a;border:3px solid #fff;box-shadow:0 0 0 2px #0b3d5c,0 1px 4px rgba(0,0,0,.45)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/** Centro por defecto: Argentina, hasta que haya algún pin. */
const DEFAULT_CENTER: [number, number] = [-31.4, -64.2];
const DEFAULT_ZOOM = 4;

function FitToPoints({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastKey.current === fitKey) return;
    lastKey.current = fitKey;
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 11);
      return;
    }
    const bounds: LatLngBoundsExpression = points;
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [map, points, fitKey]);

  return null;
}

/**
 * Mapa de publicación: dos pines arrastrables, uno por extremo, y un tercero
 * opcional para el punto exacto de salida. Los mueve el geocode cuando el
 * fletero escribe la dirección, y el fletero los puede corregir a mano (un
 * "Rosario" mal geocodificado se arregla moviendo el pin, no escribiendo una
 * dirección imposible de adivinar).
 */
export function TripPinMap({
  origin,
  destination,
  onOriginChange,
  onDestinationChange,
  departure,
  onDepartureChange,
  fitKey,
  className = "",
}: TripPinMapProps) {
  const points: [number, number][] = [];
  if (departure) points.push([departure.lat, departure.lng]);
  if (origin) points.push([origin.lat, origin.lng]);
  if (destination) points.push([destination.lat, destination.lng]);

  return (
    <div className={`isolate overflow-hidden rounded-[10px] border border-line ${className}`}>
      <MapContainer
        center={(points[0] as [number, number] | undefined) ?? DEFAULT_CENTER}
        zoom={points.length > 0 ? 11 : DEFAULT_ZOOM}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        {origin && destination && (
          <Polyline
            positions={[
              [origin.lat, origin.lng],
              [destination.lat, destination.lng],
            ]}
            color="#0b3d5c"
            weight={3}
            opacity={0.7}
            dashArray="6 8"
          />
        )}
        {departure && (
          <Marker
            position={[departure.lat, departure.lng]}
            icon={departureIcon}
            draggable={Boolean(onDepartureChange)}
            title="punto exacto de salida: mové el pin si el lugar no es el correcto"
            eventHandlers={
              onDepartureChange
                ? {
                    dragend: (event) => {
                      const { lat, lng } = (event.target as L.Marker).getLatLng();
                      onDepartureChange({ lat, lng });
                    },
                  }
                : undefined
            }
          />
        )}
        {origin && (
          <Marker
            position={[origin.lat, origin.lng]}
            icon={originIcon}
            draggable
            title="origen: mové el pin si el lugar no es el correcto"
            eventHandlers={{
              dragend: (event) => {
                const { lat, lng } = (event.target as L.Marker).getLatLng();
                onOriginChange({ lat, lng });
              },
            }}
          />
        )}
        {destination && (
          <Marker
            position={[destination.lat, destination.lng]}
            icon={destinationIcon}
            draggable
            title="destino: mové el pin si el lugar no es el correcto"
            eventHandlers={{
              dragend: (event) => {
                const { lat, lng } = (event.target as L.Marker).getLatLng();
                onDestinationChange({ lat, lng });
              },
            }}
          />
        )}
        <FitToPoints points={points} fitKey={fitKey} />
      </MapContainer>
    </div>
  );
}
