import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CreateReviewInput, Review } from "../types/trip";

export function useCreateReview(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateReviewInput) =>
      api.post<Review>(`/trips/${tripId}/reviews`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
      queryClient.invalidateQueries({ queryKey: ["me", "profile"] });
    },
  });
}
