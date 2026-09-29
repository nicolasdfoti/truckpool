import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";

export type MpConnectResponse = { authUrl: string };

/**
 * Pide al backend la URL de autorización de Mercado Pago y manda al usuario.
 *
 * El backend responde JSON con la URL (no redirige): el que decide el
 * `window.location.href` es el navegador, así que el usuario ve primero el
 * spinner del botón y, si algo falla, un mensaje en la página en vez de una
 * pantalla de error de la API.
 */
export function useConnectMp() {
  return useMutation({
    mutationFn: () => api.get<MpConnectResponse>("/users/me/mp-connect"),
    onSuccess: ({ authUrl }) => {
      window.location.href = authUrl;
    },
  });
}
