import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/** marca como leídos los mensajes dirigidos al usuario logueado en el viaje */
export function useMarkMessagesRead(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api.patch<{ updated: number }>(`/trips/${tripId}/messages/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trip-messages", tripId] });
    },
  });
}
