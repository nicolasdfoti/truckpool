import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { StopItem, PublicTracking } from "../types/trip";

/** paradas ordenadas del viaje (pickups) — solo participantes */
export function useTripStops(tripId: string) {
  return useQuery({
    queryKey: ["tripStops", tripId],
    queryFn: () => api.get<StopItem[]>(`/trips/${tripId}/stops`),
    enabled: Boolean(tripId),
  });
}

/** reordenar paradas — solo el transportista dueño */
export function useReorderTripStops(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (items: { cargoItemId: string; order: number }[]) =>
      api.patch<StopItem[]>(`/trips/${tripId}/stops/reorder`, { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tripStops", tripId] });
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    },
  });
}

/** tracking público por trackingCode — sin auth */
export function usePublicTracking(trackingCode: string) {
  return useQuery({
    queryKey: ["publicTracking", trackingCode],
    queryFn: () => api.get<PublicTracking | null>(`/tracking/${trackingCode}`),
    enabled: Boolean(trackingCode),
  });
}
