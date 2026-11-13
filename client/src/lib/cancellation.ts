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
import type { CargoCancellationReason } from "../types/trip";

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
 * La etiqueta corta de una carga cancelada, según por qué (L7): «retirada» solo
 * si la retiró la empresa. Sin motivo (canceladas de antes), «cancelada».
 */
export function cancelledLabel(reason: CargoCancellationReason | null): string {
  if (reason === "COMPANY_WITHDREW") return "retirada";
  if (reason === "RESERVATION_EXPIRED") return "vencida";
  return "cancelada";
}

type CancelledItem = {
  depositAmount: number;
  cancellationFeeAmount: number | null;
  cancellationReason: CargoCancellationReason | null;
  depositPayment: { status: string } | null;
};

function currency(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

/**
 * RD5: cuánto se retuvo y cuánto volvió, con montos y en impersonal (la nota la
 * leen la empresa y el fletero). Antes decía «se quedaron 21 de la seña», sin
 * signo, sin formato y sin decir cuánto se devolvió.
 */
function retentionNote(prefix: string, depositAmount: number, fee: number): string {
  const refund = Math.max(0, Math.round((depositAmount - fee) * 100) / 100);
  if (refund === 0) return `${prefix}: se retuvo toda la seña (${currency(fee)}).`;
  return `${prefix}: se retuvieron ${currency(fee)} de la seña y se devolvieron ${currency(refund)}.`;
}

/**
 * Qué pasó con una carga cancelada y con su seña. Con fee 0 no se puede decir
 * "te devolvimos todo": también pasa cuando la seña nunca se cobró (o la
 * reserva venció sola), y ahí no se devolvió nada porque no había nada.
 */
export function cancellationNote(item: CancelledItem): string {
  const fee = item.cancellationFeeAmount;
  const seCobro =
    item.depositPayment?.status === "APPROVED" ||
    item.depositPayment?.status === "REFUNDED";
  // D3 y D6: sin penalidad, la seña cobrada vuelve entera
  const senaDelViaje = seCobro
    ? "la seña se devuelve entera."
    : "no se había cobrado la seña.";

  switch (item.cancellationReason) {
    case "TRIP_CANCELLED":
      return `cancelada porque se canceló el viaje. ${senaDelViaje}`;
    case "TRIP_DEPARTED":
      return `cancelada porque el viaje salió sin confirmarla. ${senaDelViaje}`;
    case "RESERVATION_EXPIRED":
      return "venció la reserva: no se pagó la seña a tiempo.";
    case "REFUNDED_BY_CARRIER":
      return "cancelada: el fletero devolvió la seña entera desde Mercado Pago.";
    case "COMPANY_WITHDREW":
      if (fee === null) return "retirada sin seña cobrada";
      if (fee > 0) return retentionNote("retirada", item.depositAmount, fee);
      return seCobro
        ? "retirada: se devolvió toda la seña."
        : "retirada sin seña cobrada";
    default:
      // de antes del motivo: no se sabe quién la canceló
      if (fee !== null && fee > 0)
        return retentionNote("cancelada", item.depositAmount, fee);
      return seCobro
        ? "cancelada y se devolvió toda la seña."
        : "cancelada sin seña cobrada";
  }
}
