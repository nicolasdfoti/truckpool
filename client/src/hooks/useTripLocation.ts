import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { TripLocationResponse } from "../types/trip";

/**
 * Ubicación del viaje: la última posición conocida y, si se pide, el recorrido
 * completo. Son datos que cambian solos, así que va por polling: cada 15
 * segundos mientras el viaje está en tránsito y nada más cuando terminó (no
 * tiene sentido seguir preguntando por un viaje cerrado).
 */
export function useTripLocation(
  tripId: string,
  options: { enabled?: boolean; history?: boolean; isInTransit?: boolean } = {}
) {
  const { enabled = true, history = false, isInTransit = true } = options;

  return useQuery({
    queryKey: ["trip-location", tripId, history],
    queryFn: () =>
      api.get<TripLocationResponse>(
        `/trips/${tripId}/location${history ? "?history=true" : ""}`
      ),
    enabled: enabled && Boolean(tripId),
    refetchInterval: isInTransit ? 15000 : false,
  });
}
