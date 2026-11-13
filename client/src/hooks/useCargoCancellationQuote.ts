import { useQuery } from "@tanstack/react-query";
import { fetchCancellationQuote } from "../lib/cancellation";

/**
 * U21: cuánto se devuelve y cuánto se retiene si la empresa retira esta carga
 * ahora, con lo que de verdad pagó de seña. Se pide al abrir el diálogo de
 * retiro (cargoItemId null = cerrado) y siempre fresco: la ventana depende de
 * la hora. `null` en data es «no se pudo consultar»: el diálogo no inventa un
 * monto.
 */
export function useCargoCancellationQuote(tripId: string, cargoItemId: string | null) {
  return useQuery({
    queryKey: ["cargo-cancellation-quote", tripId, cargoItemId],
    queryFn: () => fetchCancellationQuote(tripId, cargoItemId ?? ""),
    enabled: Boolean(tripId && cargoItemId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
