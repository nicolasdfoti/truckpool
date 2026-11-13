import { QueryClient } from "@tanstack/react-query";
import { retryUnlessDenied } from "./queryRetry";

// RD10: ninguna query reintenta un 401/403/404 (es la respuesta, no una falla
// de red). Antes un viaje o un fletero inexistente mostraba ~8 s de skeleton
// antes del error, y /solicitudes sin sesión, 8 s y después nada.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: retryUnlessDenied } },
});
