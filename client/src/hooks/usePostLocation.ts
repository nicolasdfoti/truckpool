import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { TripLocationPoint } from "../types/trip";

/** El transportista manda su posición actual al backend. */
export function usePostLocation(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (position: { lat: number; lng: number }) =>
      api.post<TripLocationPoint>(`/trips/${tripId}/location`, position),
    onSuccess: () => {
      // el mapa que está mirando el mismo viaje se entera al toque
      queryClient.invalidateQueries({ queryKey: ["trip-location", tripId] });
    },
  });
}
