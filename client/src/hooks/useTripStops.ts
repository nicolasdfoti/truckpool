import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { retryUnlessDenied } from "../lib/queryRetry";
import type { StopItem, PublicTracking } from "../types/trip";

/**
 * paradas ordenadas del viaje (pickups): solo el fletero y las empresas con
 * carga viva. La página no la monta para el resto; si igual llega un 403 (la
 * empresa retiró su carga en otra pestaña), no se reintenta.
 */
export function useTripStops(tripId: string) {
  return useQuery({
    queryKey: ["tripStops", tripId],
    queryFn: () => api.get<StopItem[]>(`/trips/${tripId}/stops`),
    enabled: Boolean(tripId),
    retry: retryUnlessDenied,
  });
}

/** reordenar paradas — solo el transportista dueño */
export function useReorderTripStops(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (items: { cargoItemId: string; order: number }[]) =>
      api.patch<StopItem[]>(`/trips/${tripId}/stops/reorder`, { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tripStops", tripId] });
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    },
  });
}

/**
 * tracking público por trackingCode — sin auth. Se busca el código que se
 * envió, no lo que se va escribiendo; un 404 es la respuesta, no se reintenta.
 */
export function usePublicTracking(trackingCode: string | null) {
  return useQuery({
    queryKey: ["publicTracking", trackingCode],
    queryFn: () => api.get<PublicTracking | null>(`/tracking/${trackingCode}`),
    enabled: Boolean(trackingCode),
    retry: retryUnlessDenied,
  });
}
