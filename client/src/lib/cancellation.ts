/**
 * Textos de la política de retiro.
 *
 * Acá vive SOLO lo que el backend ya persistió en el cargo (depositAmount,
 * cancellationFeeAmount, depositPayment.status). La ventana de tiempo y el
 * monto a devolver NO se calculan en el cliente: se piden a
 * `GET /trips/cancellation-quote`, que corre la misma función que el retiro
 * real. Antes el front tenía su propia copia con un `/ 2` hardcodeado, y si el
 * servidor cambiaba PARTIAL_REFUND_RATIO el confirm le prometía al usuario un
 * número distinto del que después le devolvían.
 */
import { api } from "../api/client";

export type CancellationQuote = {
  window: "FULL_REFUND" | "PARTIAL_REFUND" | "NO_REFUND";
  /** cuánto se devuelve de la seña */
  refundAmount: number;
  /** cuánto se queda la plataforma (fee) */
  feeAmount: number;
};

/**
 * Le pregunta al backend cuánto devolvería ahora. Devuelve null si no se pudo
 * consultar, para que el llamador pueda redacción sin número en vez de inventar
 * uno: es preferible no prometer un monto a prometer el equivocado.
 */
export async function fetchCancellationQuote(
  depositAmount: number,
  tripDate: string
): Promise<CancellationQuote | null> {
  try {
    return await api.get<CancellationQuote>(
      `/trips/cancellation-quote?depositAmount=${depositAmount}&tripDate=${encodeURIComponent(tripDate)}`
    );
  } catch {
    return null;
  }
}

/**
 * Qué se le dice a la empresa al ver una carga retirada. Con fee 0 no se puede
 * decir "te devolvimos todo": también pasa cuando la seña nunca se cobró (o la
 * reserva venció sola), y ahí no se devolvió nada porque no había nada.
 */
export function cancellationNote(item: {
  depositAmount: number;
  cancellationFeeAmount: number | null;
  depositPayment: { status: string } | null;
}): string {
  const fee = item.cancellationFeeAmount;
  if (fee === null) return "retirada sin seña cobrada";
  if (fee > 0)
    return `retirada con costo: se quedaron ${item.cancellationFeeAmount} de la seña.`;
  const seCobro =
    item.depositPayment?.status === "APPROVED" ||
    item.depositPayment?.status === "REFUNDED";
  return seCobro ? "retirada y te devolvimos toda la seña." : "retirada sin seña cobrada";
}
