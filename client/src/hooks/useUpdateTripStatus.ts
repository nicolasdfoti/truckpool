import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Trip } from "../types/trip";

export function useUpdateTripStatus(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (status: "IN_TRANSIT" | "COMPLETED") =>
      api.patch<Trip>(`/trips/${tripId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}
