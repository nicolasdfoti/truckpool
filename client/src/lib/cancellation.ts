/**
 * Textos de la política de retiro.
 *
 * Acá vive SOLO lo que el backend ya persistió en el cargo (depositAmount,
 * cancellationFeeAmount, depositPayment.status). La ventana de tiempo y el
 * monto a devolver NO se calculan en el cliente: se piden a
 * `GET /trips/:tripId/cargo-items/:cargoItemId/cancellation-quote`, que corre
 * la misma cuenta que el retiro real con lo que la empresa pagó de seña (U21). Antes el front tenía su propia copia con un `/ 2` hardcodeado, y si el
 * servidor cambiaba PARTIAL_REFUND_RATIO el confirm le prometía al usuario un
 * número distinto del que después le devolvían.
 */
import { api } from "../api/client";

export type CancellationQuote = {
  /** CLOSED: el viaje ya salió y la carga no se puede retirar */
  window: "FULL_REFUND" | "PARTIAL_REFUND" | "NO_REFUND" | "CLOSED";
  /** false desde la hora de salida: el retiro responde 409 */
  cancellable: boolean;
  /** cuánto se devuelve de la seña */
  refundAmount: number;
  /** cuánto se queda la plataforma (fee) */
  feeAmount: number;
};

/**
 * Le pregunta al backend cuánto devolvería ahora si se retirara esta carga. El
 * server mira la seña real: si no se pagó, devolución y retención vienen en 0
 * (antes se cotizaba con el monto de la seña aunque nunca se hubiera cobrado,
 * y el confirm decía «la seña no se devuelve» a quien no había pagado nada).
 * Devuelve null si no se pudo consultar, para que el llamador pueda redactar
 * sin número en vez de inventar uno: es preferible no prometer un monto a
 * prometer el equivocado.
 */
export async function fetchCancellationQuote(
  tripId: string,
  cargoItemId: string
): Promise<CancellationQuote | null> {
  try {
    return await api.get<CancellationQuote>(
      `/trips/${encodeURIComponent(tripId)}/cargo-items/${encodeURIComponent(cargoItemId)}/cancellation-quote`
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
