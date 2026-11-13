import type { PaymentType } from "../types/trip";

/**
 * El último pago que se mandó a Mercado Pago desde este navegador (duda A de
 * L7). Con APP_URL local la preference no lleva back_urls y MP no vuelve solo:
 * quien entra a mano a /pagos/retorno, sin parámetros, ve el estado de ese pago.
 * Es solo una ayuda para encontrarlo: el estado sale siempre del server.
 */
export type LastPayment = { tripId: string; cargoItemId: string; type: PaymentType };

const KEY = "truckpool_last_payment";
/** pasado este tiempo, el pago guardado ya no es «el que acabás de hacer» */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function saveLastPayment(payment: LastPayment) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...payment, savedAt: Date.now() }));
  } catch {
    // sin storage (modo privado): /pagos/retorno pide los parámetros
  }
}

export function readLastPayment(): LastPayment | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<LastPayment> & { savedAt?: number };
    if (
      typeof data.tripId !== "string" ||
      typeof data.cargoItemId !== "string" ||
      (data.type !== "DEPOSIT" && data.type !== "BALANCE") ||
      typeof data.savedAt !== "number" ||
      Date.now() - data.savedAt > MAX_AGE_MS
    ) {
      return null;
    }
    return { tripId: data.tripId, cargoItemId: data.cargoItemId, type: data.type };
  } catch {
    return null;
  }
}
