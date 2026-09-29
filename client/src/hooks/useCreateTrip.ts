import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Trip, TripInput } from "../types/trip";

export function useCreateTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: TripInput) => api.post<Trip>("/trips", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}
