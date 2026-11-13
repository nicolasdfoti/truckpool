import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { invalidateTripCargo } from "./invalidateTripCargo";
import type { CargoItem } from "../types/trip";

/** D1: solo el fletero del viaje confirma (a la empresa el server le da 403) */
export function useConfirmCargoItem(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cargoItemId: string) =>
      api.patch<CargoItem>(`/trips/${tripId}/cargo-items/${cargoItemId}`, {}),
    // paradas, recorrido, cotización y perfil, además del viaje (RD4)
    onSuccess: () => invalidateTripCargo(queryClient, tripId),
  });
}
