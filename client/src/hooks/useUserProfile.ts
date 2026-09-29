import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  CarrierProfile,
  CarrierSummary,
  ProfileInput,
  ProfileUser,
  VerificationDecision,
  VerificationRequest,
} from "../types/user";
import type { Trip } from "../types/trip";
import type { MyCargoItem } from "../types/user";

export function useMyProfile(enabled = true) {
  return useQuery({
    queryKey: ["me", "profile"],
    queryFn: async () => {
      const res = await api.get<{ user: ProfileUser }>("/users/me");
      return res.user;
    },
    enabled,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ProfileInput) =>
      api.patch<{ user: ProfileUser }>("/users/me", data),
    onSuccess: (res) => {
      queryClient.setQueryData(["me", "profile"], res.user);
    },
  });
}

export function useMyTrips(enabled = true) {
  return useQuery({
    queryKey: ["me", "trips"],
    queryFn: () => api.get<Trip[]>("/users/me/trips"),
    enabled,
  });
}

export function useMyCargoItems(enabled = true) {
  return useQuery({
    queryKey: ["me", "cargo-items"],
    queryFn: () => api.get<MyCargoItem[]>("/users/me/cargo-items"),
    enabled,
  });
}

export function useCarriers() {
  return useQuery({
    queryKey: ["carriers"],
    queryFn: () => api.get<CarrierSummary[]>("/carriers"),
  });
}

export function useCarrier(id: string | undefined) {
  return useQuery({
    queryKey: ["carriers", id],
    queryFn: () => api.get<CarrierProfile>(`/carriers/${id}`),
    enabled: Boolean(id),
  });
}

/** el fletero manda su DNI/CUIT y queda PENDING hasta que un admin lo apruebe */
export function useRequestVerification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taxId: string) =>
      api.patch<{ user: ProfileUser }>("/users/me/verification", { taxId }),
    onSuccess: (res) => {
      queryClient.setQueryData(["me", "profile"], res.user);
    },
  });
}

/** toggle de disponibilidad (CARRIER) - usa endpoint dedicado /users/me/availability */
export function useToggleAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (isAvailable: boolean) =>
      api.patch<{ user: ProfileUser }>("/users/me/availability", { isAvailableNow: isAvailable }),
    onSuccess: (res) => {
      queryClient.setQueryData(["me", "profile"], res.user);
    },
  });
}

export function usePendingVerifications(enabled = true) {
  return useQuery({
    queryKey: ["admin", "verifications"],
    queryFn: () => api.get<VerificationRequest[]>("/admin/verifications"),
    enabled,
  });
}

export function useReviewVerification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { userId: string } & VerificationDecision) =>
      api.patch<{ user: ProfileUser }>(`/admin/verifications/${input.userId}`, {
        approve: input.approve,
        ...(input.note ? { note: input.note } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "verifications"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
