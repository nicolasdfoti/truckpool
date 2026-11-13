import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CargoItem, CargoItemPayment, PaymentType, TripDetail } from "../types/trip";

/** cada cuánto se consulta y hasta cuándo (03§1.1) */
export const PAYMENT_POLL_MS = 3_000;
export const PAYMENT_POLL_LIMIT_MS = 60_000;

/** un estado de pago que ya no va a cambiar solo mientras la empresa mira */
function isSettled(payment: CargoItemPayment | null | undefined) {
  return Boolean(payment && payment.status !== "PENDING");
}

/**
 * U16: el estado real de un pago para /pagos/retorno. Lee el detalle del viaje
 * (la empresa ve su carga con sus pagos) cada 3 s hasta que el pago deja de
 * estar PENDING o pasan 60 s. Nunca mira el `?status` que pone MP en la URL.
 */
export function usePaymentStatus(
  target: { tripId: string; cargoItemId: string; type: PaymentType } | null
) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => setTimedOut(true), PAYMENT_POLL_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [target]);

  const query = useQuery({
    queryKey: ["trip", target?.tripId ?? ""],
    queryFn: () => api.get<TripDetail>(`/trips/${encodeURIComponent(target!.tripId)}`),
    enabled: Boolean(target),
    refetchInterval: (q) => {
      if (timedOut) return false;
      const item = q.state.data?.cargoItems.find((c) => c.id === target?.cargoItemId);
      const payment =
        target?.type === "BALANCE" ? item?.balancePayment : item?.depositPayment;
      // sin la carga (no es tuya, o se retiró) tampoco hay nada que esperar
      if (q.state.data && (!item || isSettled(payment))) return false;
      return PAYMENT_POLL_MS;
    },
    refetchIntervalInBackground: true,
    retry: 1,
  });

  const trip = query.data ?? null;
  const item: CargoItem | null =
    trip?.cargoItems.find((c) => c.id === target?.cargoItemId) ?? null;
  const payment =
    (target?.type === "BALANCE" ? item?.balancePayment : item?.depositPayment) ?? null;

  return { trip, item, payment, timedOut, isError: query.isError };
}
