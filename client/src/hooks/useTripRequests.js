import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
/** Solicitudes recibidas por el carrier (solo PENDING) */
export function useReceivedTripRequests() {
    return useQuery({
        queryKey: ["tripRequests", "received"],
        queryFn: () => api.get("/users/trip-requests/received"),
    });
}
/** Solicitudes enviadas por la company */
export function useSentTripRequests() {
    return useQuery({
        queryKey: ["tripRequests", "sent"],
        queryFn: () => api.get("/users/trip-requests/sent"),
    });
}
/** Crear una solicitud de viaje (COMPANY) */
export function useCreateTripRequest() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data) => api.post("/users/trip-requests", data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tripRequests", "sent"] });
            queryClient.invalidateQueries({ queryKey: ["carriers"] });
        },
    });
}
/** Responder a una solicitud (CARRIER) */
export function useRespondTripRequest() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }) => api.patch(`/users/trip-requests/${id}/respond`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tripRequests", "received"] });
            queryClient.invalidateQueries({ queryKey: ["tripRequests", "sent"] });
            queryClient.invalidateQueries({ queryKey: ["trips"] });
        },
    });
}
