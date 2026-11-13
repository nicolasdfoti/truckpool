import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { PaymentType } from "../types/trip";
import { saveLastPayment } from "../lib/lastPayment";

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
    onSuccess: (preference, { cargoItemId, type = "DEPOSIT" }) => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      // para /pagos/retorno si MP no vuelve solo (APP_URL local)
      saveLastPayment({ tripId, cargoItemId, type });
      window.location.href = preference.initPoint;
    },
  });
}
