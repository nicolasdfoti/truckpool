import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CargoItem } from "../types/trip";

export function useAddCargoItem(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { description: string; volume: number; pickupAddress: string }) =>
      api.post<CargoItem>(`/trips/${tripId}/cargo-items`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      // la carga nueva es una parada más (y la empresa pasa a verlas)
      queryClient.invalidateQueries({ queryKey: ["tripStops", tripId] });
    },
  });
}
