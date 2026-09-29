import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { TripMessage } from "../types/trip";

export function useSendMessage(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { body: string; toUserId: string }) =>
      api.post<TripMessage>(`/trips/${tripId}/messages`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trip-messages", tripId] });
    },
  });
}
