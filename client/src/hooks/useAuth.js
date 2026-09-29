import { useQuery } from "@tanstack/react-query";
import { api, getToken, setToken } from "../api/client";
import { queryClient } from "../lib/queryClient";
/**
 * Cierra sesión.
 *
 * Primero le pide al server que revoque el token y recién después lo borra del
 * navegador: si se borrara primero, el request saldría sin Authorization y el
 * token seguiría sirviendo del lado del server hasta que expirara. El 204 no
 * hace falta esperarlo para que la UI reaccione, pero se espera igual para que
 * un logout fallido sea visible en vez de silencioso.
 */
export async function logout() {
    try {
        if (getToken())
            await api.post("/auth/logout");
    }
    catch {
        // si el server no está o el token ya no servía, el token local se borra igual
    }
    setToken(null);
    queryClient.clear();
}
export function useAuth() {
    const query = useQuery({
        queryKey: ["me"],
        queryFn: async () => {
            if (!getToken())
                return null;
            try {
                const result = await api.get("/auth/me");
                return result.user;
            }
            catch {
                setToken(null);
                return null;
            }
        },
        staleTime: 5 * 60 * 1000,
    });
    return {
        user: query.data ?? null,
        isLoading: query.isLoading,
        isAuthenticated: query.data !== null,
        logout,
    };
}
