import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { TripMessages } from "../types/trip";

/**
 * Mensajería del viaje con polling simple: cada 5 segundos mientras el
 * componente esté montado (sin websockets).
 */
export function useTripMessages(tripId: string, enabled = true) {
  return useQuery({
    queryKey: ["trip-messages", tripId],
    queryFn: () => api.get<TripMessages>(`/trips/${tripId}/messages`),
    enabled: enabled && Boolean(tripId),
    refetchInterval: 5000,
  });
}
