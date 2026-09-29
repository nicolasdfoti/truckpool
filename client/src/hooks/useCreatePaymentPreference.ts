import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { PaymentType } from "../types/trip";

export type PaymentPreference = {
  paymentId: string;
  cargoItemId: string;
  type: PaymentType;
  amount: number;
  status: "PENDING";
  initPoint: string;
};

/** Por defecto paga la seña: el saldo se pide explícitamente con type: "BALANCE". */
export function useCreatePaymentPreference(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      cargoItemId,
      type = "DEPOSIT",
    }: {
      cargoItemId: string;
      type?: PaymentType;
    }) =>
      api.post<PaymentPreference>(`/cargo-items/${cargoItemId}/payment-preference`, {
        type,
      }),
    onSuccess: (preference) => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      window.location.href = preference.initPoint;
    },
  });
}
