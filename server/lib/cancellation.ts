/**
 * Política de retiro de carga. Es la fuente de verdad del backend: el cliente
 * tiene una copia (client/src/lib/cancellation.ts) solo para mostrar la
 * estimación antes de confirmar, y nunca decide el resultado real.
 *
 * Todo se mide contra la fecha del viaje, no contra cuándo se creó la carga:
 * lo que importa al transportista es cuánto le falta para salir.
 */
export const FULL_REFUND_HOURS = 48;
export const PARTIAL_REFUND_HOURS = 24;
/** entre 24 y 48 horas se devuelve la mitad de la seña */
export const PARTIAL_REFUND_RATIO = 0.5;

export type CancellationWindow = "FULL_REFUND" | "PARTIAL_REFUND" | "NO_REFUND";

export function hoursUntilTrip(tripDate: Date | string, now: Date = new Date()): number {
  return (new Date(tripDate).getTime() - now.getTime()) / 3_600_000;
}

/**
 * > 48h: se devuelve toda la seña.
 * 24-48h: se devuelve la mitad.
 * < 24h: no se devuelve nada, la seña queda como costo de cancelación.
 *
 * Los bordes caen en la ventana más estricta a propósito: justo en 48h todavía
 * hay margen de gestión, justo en 24h ya no.
 */
export function cancellationWindow(hours: number): CancellationWindow {
  if (hours > FULL_REFUND_HOURS) return "FULL_REFUND";
  if (hours >= PARTIAL_REFUND_HOURS) return "PARTIAL_REFUND";
  return "NO_REFUND";
}

export type CancellationQuote = {
  window: CancellationWindow;
  /** cuánto se devuelve de la seña */
  refundAmount: number;
  /** cuánto se queda la plataforma (fee) */
  feeAmount: number;
};

/** Estimación del retiro a partir de la seña y de las horas que faltan. */
export function quoteCancellation(
  depositAmount: number,
  hours: number
): CancellationQuote {
  const window = cancellationWindow(hours);
  if (window === "FULL_REFUND") {
    return { window, refundAmount: depositAmount, feeAmount: 0 };
  }
  if (window === "PARTIAL_REFUND") {
    const refundAmount = round2(depositAmount * PARTIAL_REFUND_RATIO);
    return { window, refundAmount, feeAmount: round2(depositAmount - refundAmount) };
  }
  return { window, refundAmount: 0, feeAmount: depositAmount };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
