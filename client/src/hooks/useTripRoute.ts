import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { retryUnlessDenied } from "../lib/queryRetry";
import type { TripRoute, TripRouteGeometry } from "../types/trip";

/**
 * Recorrido del viaje (partida → paradas de retiro en orden → destino). Con
 * sesión y solo para el fletero y las empresas con carga viva (U7): al resto
 * el server le responde 401/403, así que la página no lo pide (`enabled`).
 *
 * No cambia solo: reservar, retirar una carga o reordenar las paradas lo
 * cambian, y esas mutaciones lo invalidan. Con staleTime largo no lo volvemos a
 * pedir en cada render.
 */
export function useTripRoute(tripId: string, enabled = true) {
  return useQuery({
    queryKey: ["trip-route", tripId],
    queryFn: () => api.get<TripRoute>(`/trips/${tripId}/route`),
    enabled: enabled && Boolean(tripId),
    staleTime: 60 * 1000,
    retry: retryUnlessDenied,
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
export function useTripRouteGeometry(tripId: string, enabled = true) {
  return useQuery({
    queryKey: ["trip-route-geometry", tripId],
    queryFn: () => api.get<TripRouteGeometry>(`/trips/${tripId}/route-geometry`),
    enabled: enabled && Boolean(tripId),
    staleTime: 5 * 60 * 1000,
    // si OSRM no respondió, no insistimos en cada mount: la geometría real es
    // un extra, el recorrido ya se está dibujando sin ella
    retry: false,
  });
}
