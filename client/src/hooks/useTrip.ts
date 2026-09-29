import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { TripDetail } from "../types/trip";

export function useTrip(id: string) {
  return useQuery({
    queryKey: ["trip", id],
    queryFn: () => api.get<TripDetail>(`/trips/${id}`),
    enabled: !!id,
  });
}
