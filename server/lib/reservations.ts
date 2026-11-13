import type { PaymentStatus } from "@prisma/client";

/**
 * Una reserva de espacio vale 24hs: si en ese plazo la empresa no abonó la
 * seña, el lugar vuelve a estar disponible para otro. La libera el scheduler
 * (ver releaseExpiredReservations en trips.service.ts y lib/jobs.ts).
 */
export const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

type DepositLike = { type: string; status: PaymentStatus; mpPaymentId: string | null };

/**
 * ¿La seña sostiene la reserva? Cobrada (APPROVED) o por acreditarse (pago
 * creado en MP y todavía pendiente: si se aprueba, la carga tiene que seguir
 * viva). Una seña rechazada, o una preference sin pago en MP, no sostienen
 * nada. Es la misma regla que `DEPOSIT_HOLDS_RESERVATION` (el filtro de Prisma
 * en trips.service.ts), en memoria.
 */
export function depositHoldsReservation(payments: DepositLike[]): boolean {
  const deposit = payments.find((p) => p.type === "DEPOSIT");
  if (deposit?.status === "APPROVED") return true;
  return deposit?.status === "PENDING" && deposit.mpPaymentId !== null;
}

/**
 * Hasta cuándo vale la reserva de una carga (L7): la fila PENDING sin seña
 * dice «reservado hasta …». null si no vence: la carga no está PENDING, la
 * seña la sostiene, o no se cargaron los pagos (antes que inventar una fecha).
 */
export function reservationExpiresAt(item: {
  status: string;
  createdAt: Date;
  payments?: DepositLike[] | undefined;
}): Date | null {
  if (item.status !== "PENDING" || !item.payments) return null;
  if (depositHoldsReservation(item.payments)) return null;
  return new Date(item.createdAt.getTime() + RESERVATION_TTL_MS);
}
