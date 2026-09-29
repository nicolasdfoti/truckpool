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
    },
  });
}
