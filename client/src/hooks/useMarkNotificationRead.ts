import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

const KEY = ["notifications"];

function useInvalidateNotifications() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: KEY });
}

/**
 * Marca un aviso como leído. El server lo filtra por userId, así que marcar el
 * de otro no hace nada: el invalidate de todas formas deja la lista igual.
 */
export function useMarkNotificationRead() {
  const invalidate = useInvalidateNotifications();

  return useMutation({
    mutationFn: (id: string) =>
      api.patch<{ updated: boolean }>(`/notifications/${id}/read`, {}),
    onSuccess: invalidate,
  });
}

/** "marcar todas como leídas": el server solo toca las no leídas del usuario */
export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications();

  return useMutation({
    mutationFn: () => api.patch<{ updated: number }>("/notifications/read-all", {}),
    onSuccess: invalidate,
  });
}
