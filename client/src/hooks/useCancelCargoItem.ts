import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CargoItem } from "../types/trip";

/**
 * Retira una carga que la empresa sumó y todavía está pendiente. El backend la
 * marca CANCELLED y libera el lugar, así que refrescamos el viaje (capacityUsed
 * y estado FULL/OPEN) y el listado de viajes.
 */
export function useCancelCargoItem(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cargoItemId: string) =>
      api.delete<CargoItem>(`/trips/${tripId}/cargo-items/${cargoItemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}
