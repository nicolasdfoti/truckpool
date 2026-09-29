import { useQuery } from "@tanstack/react-query";
import { api, getToken } from "../api/client";
import type { Notification } from "../types/notification";

/**
 * Avisos del usuario logueado, con polling cada 20 segundos mientras haya
 * sesión: es lo que hace que la campanita se actualice sola sin websockets.
 * Sin token no se consulta (la campanilla tampoco se muestra).
 */
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<Notification[]>("/notifications"),
    enabled: enabled && Boolean(getToken()),
    refetchInterval: 20000,
  });
}
