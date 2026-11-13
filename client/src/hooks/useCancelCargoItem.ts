import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { invalidateTripCargo } from "./invalidateTripCargo";
import type { CargoItem } from "../types/trip";

/**
 * Retira una carga que la empresa sumó y todavía está pendiente. El backend la
 * marca CANCELLED y libera el lugar, así que se refresca el viaje (capacityUsed
 * y estado FULL/OPEN) y todo lo que sale de sus cargas.
 */
export function useCancelCargoItem(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cargoItemId: string) =>
      api.delete<CargoItem>(`/trips/${tripId}/cargo-items/${cargoItemId}`),
    // paradas, recorrido, cotización y perfil, además del viaje (RD4)
    onSuccess: () => invalidateTripCargo(queryClient, tripId),
  });
}
