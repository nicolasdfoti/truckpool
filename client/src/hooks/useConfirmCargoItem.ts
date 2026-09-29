import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CargoItem } from "../types/trip";

export function useConfirmCargoItem(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cargoItemId: string) =>
      api.patch<CargoItem>(`/trips/${tripId}/cargo-items/${cargoItemId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}
