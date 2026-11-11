import { ApiError } from "../api/client";

/**
 * Reintentos de TanStack Query sin insistir en lo que no va a cambiar: un 401,
 * 403 o 404 es la respuesta, no una falla de red. Reintentarlo solo estira el
 * skeleton varios segundos antes de mostrar el error (03/Detalle#2).
 */
export function retryUnlessDenied(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return false;
  return failureCount < 3;
}
