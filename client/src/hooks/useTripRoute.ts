import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { TripRoute, TripRouteGeometry } from "../types/trip";

/**
 * Recorrido completo del viaje (partida → paradas de retiro en orden →
 * destino). Es público, como el resto del detalle del viaje.
 *
 * No cambia solo: una carga nueva o el fletero reordenando las paradas lo
 * cambian, y eso ya invalida ["trip", id] en la página de detalle. Con
 * staleTime largo no lo volvemos a pedir en cada render.
 */
export function useTripRoute(tripId: string) {
  return useQuery({
    queryKey: ["trip-route", tripId],
    queryFn: () => api.get<TripRoute>(`/trips/${tripId}/route`),
    enabled: Boolean(tripId),
    staleTime: 60 * 1000,
  });
}

/**
 * Geometría de la ruta real siguiendo calles (OSRM), o null si no se pudo.
 * El backend la cachea en memoria por viaje, así que pedirla junto con el
 * recorrido no multiplica los requests a OSRM.
 *
 * Un fallo acá no es un error de la pantalla: el mapa dibuja líneas rectas
 * igual. Por eso la query no re-lanza; si falla, `geometry` queda en null y el
 * mapa cae al fallback silencioso.
 */
export function useTripRouteGeometry(tripId: string) {
  return useQuery({
    queryKey: ["trip-route-geometry", tripId],
    queryFn: () => api.get<TripRouteGeometry>(`/trips/${tripId}/route-geometry`),
    enabled: Boolean(tripId),
    staleTime: 5 * 60 * 1000,
    // si OSRM no respondió, no insistimos en cada mount: la geometría real es
    // un extra, el recorrido ya se está dibujando sin ella
    retry: false,
  });
}
