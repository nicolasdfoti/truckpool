import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { invalidateTripCargo } from "./invalidateTripCargo";
import type { Trip } from "../types/trip";

export function useUpdateTripStatus(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    // CANCELLED: el fletero cancela antes de salir (D6); las cargas activas se
    // cancelan con la seña devuelta entera
    mutationFn: (status: "IN_TRANSIT" | "COMPLETED" | "CANCELLED") =>
      api.patch<Trip>(`/trips/${tripId}/status`, { status }),
    // paradas, recorrido, cotización y perfil, además del viaje (RD4)
    onSuccess: () => invalidateTripCargo(queryClient, tripId),
  });
}
