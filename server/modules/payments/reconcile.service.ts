import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  resolveCarrierMpToken,
  searchPaymentsByExternalReference,
} from "../../lib/mercadopago.js";
import { AppError } from "../../lib/errors.js";
import { handlePaymentNotification } from "./payments.service.js";
import { alertAdmins } from "./alerts.service.js";

/** un pago que cambió hace menos de esto todavía puede recibir su webhook */
export const RECONCILE_GRACE_MS = 10 * 60_000;

/** fuera de lo que sostiene algo vivo, un pago se concilia hasta 7 días desde su último cambio */
export const RECONCILE_STALE_LIMIT_MS = 7 * 24 * 60 * 60_000;

/** cuántos pagos mira cada corrida */
export const RECONCILE_BATCH = 100;

/**
 * Por dónde sigue la próxima corrida (id del último pago revisado). En memoria:
 * con una sola instancia alcanza, y un reinicio solo vuelve a empezar desde el
 * principio. Hace falta porque un pago sin resolver no cambia su `updatedAt`:
 * ordenando por antigüedad, los mismos 100 taparían al resto para siempre.
 */
let cursor: string | null = null;

/** para los tests: la próxima corrida arranca desde el principio */
export function resetReconcileCursor() {
  cursor = null;
}

/**
 * Lo que un pago sostiene mientras su viaje sigue: la seña de una carga activa
 * en un viaje que no salió (si se acredita, la carga tiene que seguir viva) y el
 * saldo de un viaje en camino (un saldo cobrado sin aviso bloquea el
 * COMPLETED). Esos se concilian sin límite de antigüedad.
 */
const SOSTIENE_ALGO_VIVO: Prisma.PaymentWhereInput[] = [
  {
    type: "DEPOSIT",
    cargoItem: {
      status: { in: ["PENDING", "CONFIRMED"] },
      trip: { status: { in: ["OPEN", "FULL"] } },
    },
  },
  { type: "BALANCE", cargoItem: { trip: { status: "IN_TRANSIT" } } },
];

/**
 * Conciliación de pagos con Mercado Pago (lo corre el scheduler cada 15 min),
 * por si se pierde un webhook (p. ej. un túnel que se reinició).
 *
 * Mira los pagos PENDING y REJECTED que llegaron a MP (tienen preference) y no
 * cambiaron en los últimos 10 min. Sin límite de antigüedad si sostienen algo
 * vivo (ver SOSTIENE_ALGO_VIVO); si no, hasta 7 días desde su último cambio:
 * cubre la seña que MP aprueba después de que la carga se canceló (D3, D6 o
 * una reserva vencida), que hay que devolver.
 *
 * Por cada pago busca en MP, con el token del fletero, los pagos con su
 * `external_reference` (el id local), así encuentra también un segundo intento
 * con otra tarjeta:
 * - PENDING: cada pago de MP, del más viejo al más nuevo, pasa por
 *   `handlePaymentNotification`, como si hubieran llegado sus webhooks: la
 *   misma máquina de estados, el CAS, el control de monto, `refundIfCancelled`
 *   y las alertas. Un pago de MP todavía pendiente deja asentado su
 *   `mpPaymentId` (la seña pasa a estar por acreditarse).
 * - REJECTED: no se mueve. Si MP tiene un pago aprobado, se avisa a los
 *   admins una sola vez.
 *
 * Un fletero sin MP conectado o un error de MP en un pago no cortan la corrida.
 */
export async function reconcilePendingPayments(
  now: Date = new Date()
): Promise<{ revisados: number }> {
  const graceCutoff = new Date(now.getTime() - RECONCILE_GRACE_MS);
  const staleCutoff = new Date(now.getTime() - RECONCILE_STALE_LIMIT_MS);

  const payments = await prisma.payment.findMany({
    where: {
      status: { in: ["PENDING", "REJECTED"] },
      mpPreferenceId: { not: null },
      updatedAt: { lt: graceCutoff },
      OR: [...SOSTIENE_ALGO_VIVO, { updatedAt: { gte: staleCutoff } }],
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    select: {
      id: true,
      status: true,
      cargoItem: {
        select: {
          tripId: true,
          trip: {
            select: { carrier: { select: { mpUserId: true, mpAccessToken: true } } },
          },
        },
      },
    },
    orderBy: { id: "asc" },
    take: RECONCILE_BATCH,
  });

  // la próxima corrida sigue desde acá; si no se llenó la tanda, vuelve a empezar
  cursor = payments.length === RECONCILE_BATCH ? payments.at(-1)!.id : null;

  for (const payment of payments) {
    try {
      await reconcileOne(payment);
    } catch (err) {
      console.error("[conciliación] no se pudo conciliar un pago", {
        name: err instanceof Error ? err.name : typeof err,
        code: err instanceof AppError ? err.code : undefined,
      });
    }
  }
  return { revisados: payments.length };
}

async function reconcileOne(payment: {
  id: string;
  status: string;
  cargoItem: {
    tripId: string;
    trip: { carrier: { mpUserId: string | null; mpAccessToken: string | null } };
  };
}) {
  const { accessToken } = resolveCarrierMpToken(payment.cargoItem.trip.carrier);
  const found = await searchPaymentsByExternalReference(payment.id, accessToken);

  if (payment.status === "REJECTED") {
    const approved = found.find((mp) => mp.state === "APPROVED");
    if (!approved) return;
    await alertAdmins(`REJECTED_BUT_APPROVED:${payment.id}:${approved.id}`, {
      tripId: payment.cargoItem.tripId,
      title: "pago rechazado acá y aprobado en Mercado Pago",
      body: `el pago ${payment.id} figura rechazado, pero MP tiene aprobado el pago ${approved.id} con su referencia. no se cambió nada: revisalo en Mercado Pago.`,
    });
    return;
  }

  for (const mp of found) {
    await handlePaymentNotification({ mpPaymentId: mp.id, hintPaymentId: payment.id });
  }
}
