import type { PaymentStatus, RefundRequest } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { refundPayment, resolveCarrierMpToken } from "../../lib/mercadopago.js";
import { AppError, MpApiError } from "../../lib/errors.js";
import { alertAdmins } from "./alerts.service.js";

/**
 * Lo que pasó con la RefundRequest de una carga:
 * - `none`: no había nada pendiente, u otro processor la reclamó primero
 * - `completed`: terminó; `paymentStatus` es el estado en que quedó la seña
 *   (null si no había un pago reembolsable)
 * - `failed`: no salió; la request quedó PENDING para reintento, o FAILED si
 *   llegó al tope
 */
export type RefundOutcome =
  | { kind: "none" }
  | { kind: "completed"; paymentStatus: PaymentStatus | null }
  | { kind: "failed" };

/** a los 8 intentos fallidos la request pasa a FAILED y se avisa a los admins */
export const MAX_REFUND_ATTEMPTS = 8;

/** un PROCESSING sin novedades en 10 min se da por colgado y se retoma */
export const PROCESSING_TIMEOUT_MS = 10 * 60_000;

/** el transportista tiene 24 h para volver a conectar MP antes del FAILED */
export const CARRIER_DISCONNECTED_LIMIT_MS = 24 * 60 * 60_000;

/** cuántas requests mira el worker por estado en cada corrida */
const WORKER_BATCH = 100;

const MINUTE_MS = 60_000;

/**
 * Espera antes del próximo intento, contada desde el último (`updatedAt`):
 * 1, 2, 4… minutos según los intentos ya fallidos, con techo de 60. Sin
 * intentos fallidos no hay espera.
 */
export function refundBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(2 ** (attempts - 1), 60) * MINUTE_MS;
}

/**
 * Qué se guarda en `lastError`: el código, nunca el mensaje (puede traer datos
 * del pedido a MP). De MP, el código estable más lo que informó MP
 * ("MP_ERROR:400:2063"); de otro error propio, su código; si no, el nombre.
 */
function errorCode(err: unknown): string {
  if (err instanceof MpApiError)
    return err.mpCode ? `${err.code}:${err.mpCode}` : err.code;
  if (err instanceof AppError) return err.code;
  return err instanceof Error ? err.name : "UNKNOWN";
}

function isCarrierDisconnected(err: unknown): boolean {
  return err instanceof AppError && err.code === "MP_ACCOUNT_NOT_CONNECTED";
}

/**
 * Cierra el intento en curso. CAS sobre PROCESSING: si el worker ya dio este
 * intento por colgado y lo retomó, el processor tardío no pisa lo que pasó
 * después.
 */
function closeAttempt(
  id: string,
  data: Parameters<typeof prisma.refundRequest.updateMany>[0]["data"]
) {
  return prisma.refundRequest.updateMany({ where: { id, status: "PROCESSING" }, data });
}

async function alertRefundFailed(
  req: Pick<RefundRequest, "id" | "cargoItemId">,
  tripId: string | null,
  attempts: number,
  lastError: string
) {
  await alertAdmins(`REFUND_FAILED:${req.id}`, {
    tripId,
    title: "una devolución no se pudo hacer",
    body: `la devolución de la seña de la carga ${req.cargoItemId} quedó en FAILED (intentos: ${attempts}, último error: ${lastError}). hay que hacerla a mano desde la cuenta de Mercado Pago del transportista.`,
  });
}

/**
 * Processor de reembolsos (patrón outbox).
 *
 * Toma la RefundRequest PENDING de la carga, le pide el reembolso a Mercado
 * Pago y deja asentado:
 * - RefundRequest: COMPLETED; de vuelta a PENDING con el intento contado si
 *   falló; FAILED con alerta a los admins al llegar a MAX_REFUND_ATTEMPTS
 * - Payment: refundedAmount, y REFUNDED si cubrió el total
 *
 * Si el transportista no tiene MP conectado, el intento no cuenta: la request
 * queda PENDING, se avisa a los admins una vez y, si en 24 h no reconecta,
 * pasa a FAILED con alerta.
 *
 * El reclamo es un CAS PENDING→PROCESSING que también exige el `attempts`
 * leído: de dos processors concurrentes (el del retiro, el del webhook o el
 * worker) solo uno llama a MP.
 *
 * La clave de idempotencia es por intento (`refund-<request>-<attempts>`): si
 * MP guardara la respuesta de error de un intento bajo su clave, repetirla la
 * devolvería para siempre. Entre intentos el doble reembolso no puede pasar: el
 * CAS deja un solo intento en vuelo y `refundPayment` consulta lo ya devuelto
 * antes de pedir nada.
 *
 * No lanza por errores de MP: quien lo llama ya confirmó su operación y el
 * reembolso se recupera desde la request.
 */
export async function processRefundRequest(
  cargoItemId: string,
  now: Date = new Date()
): Promise<RefundOutcome> {
  const req = await prisma.refundRequest.findUnique({
    where: { cargoItemId },
  });
  if (!req || req.status !== "PENDING") return { kind: "none" };

  const claimed = await prisma.refundRequest.updateMany({
    where: { id: req.id, status: "PENDING", attempts: req.attempts },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) return { kind: "none" };

  let tripId: string | null = null;
  try {
    const payment = await prisma.payment.findUnique({
      where: { cargoItemId_type: { cargoItemId, type: "DEPOSIT" } },
      include: {
        cargoItem: {
          select: {
            tripId: true,
            trip: {
              select: { carrier: { select: { mpUserId: true, mpAccessToken: true } } },
            },
          },
        },
      },
    });
    if (!payment || payment.status !== "APPROVED" || !payment.mpPaymentId) {
      // no hay pago reembolsable: no hay nada que hacer
      await closeAttempt(req.id, { status: "COMPLETED", carrierDisconnectedAt: null });
      return { kind: "completed", paymentStatus: payment?.status ?? null };
    }
    tripId = payment.cargoItem.tripId;

    let accessToken: string;
    try {
      // el pago vive en la cuenta MP del transportista: se devuelve con su token
      ({ accessToken } = resolveCarrierMpToken(payment.cargoItem.trip.carrier));
    } catch (err) {
      if (!isCarrierDisconnected(err)) throw err;
      await holdForCarrier(req, tripId, now);
      return { kind: "failed" };
    }

    const targetAmount = Number(req.targetAmount);
    const refundedAmount = await refundPayment(
      payment.mpPaymentId,
      targetAmount,
      accessToken,
      { idempotencyKey: `refund-${req.id}-${req.attempts}` }
    );

    // actualizar Payment con lo que MP confirmó
    const fullyRefunded = refundedAmount >= Number(payment.amount);
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: fullyRefunded ? { status: "REFUNDED", refundedAmount } : { refundedAmount },
    });

    await closeAttempt(req.id, { status: "COMPLETED", carrierDisconnectedAt: null });
    return { kind: "completed", paymentStatus: updated.status };
  } catch (err) {
    const attempts = req.attempts + 1;
    const lastError = errorCode(err);
    const failed = attempts >= MAX_REFUND_ATTEMPTS;
    await closeAttempt(req.id, {
      status: failed ? "FAILED" : "PENDING",
      attempts,
      lastError,
      carrierDisconnectedAt: null,
    });
    if (failed) await alertRefundFailed(req, tripId, attempts, lastError);
    return { kind: "failed" };
  }
}

/**
 * El transportista no tiene MP conectado: el reembolso no puede salir con
 * ningún token (el pago vive en su cuenta). No cuenta como intento; se avisa a
 * los admins enseguida (una vez por request) y se espera 24 h desde que se
 * detectó. Pasado ese plazo, FAILED con alerta.
 */
async function holdForCarrier(req: RefundRequest, tripId: string | null, now: Date) {
  const since = req.carrierDisconnectedAt ?? now;
  const expired = now.getTime() - since.getTime() >= CARRIER_DISCONNECTED_LIMIT_MS;
  const lastError = "MP_ACCOUNT_NOT_CONNECTED";

  await closeAttempt(req.id, {
    status: expired ? "FAILED" : "PENDING",
    lastError,
    carrierDisconnectedAt: since,
  });

  if (expired) {
    await alertRefundFailed(req, tripId, req.attempts, lastError);
    return;
  }
  await alertAdmins(`REFUND_CARRIER_DISCONNECTED:${req.id}`, {
    tripId,
    title: "una devolución espera a que el transportista conecte Mercado Pago",
    body: `la devolución de la seña de la carga ${req.cargoItemId} no puede salir: el transportista no tiene Mercado Pago conectado. si no lo conecta en 24 h, queda en FAILED y hay que resolverla a mano.`,
  });
}

/**
 * Un PROCESSING colgado (el processor se cayó a mitad de camino): vuelve a
 * PENDING contando el intento, o a FAILED con alerta si era el último. CAS
 * contra lo leído: si el processor original terminó en el medio, no se toca.
 *
 * No paga dos veces: el pedido a MP tiene timeout (lib/mercadopago.ts), así que
 * a los 10 min el intento original ya no está en vuelo, y `refundPayment` lee
 * lo ya devuelto antes de pedir nada.
 */
async function resumeStale(req: RefundRequest): Promise<boolean> {
  const attempts = req.attempts + 1;
  const failed = attempts >= MAX_REFUND_ATTEMPTS;
  const lastError = "PROCESSING_TIMEOUT";
  const resumed = await prisma.refundRequest.updateMany({
    where: {
      id: req.id,
      status: "PROCESSING",
      attempts: req.attempts,
      updatedAt: req.updatedAt,
    },
    data: { status: failed ? "FAILED" : "PENDING", attempts, lastError },
  });
  if (resumed.count === 0) return false;

  if (failed) {
    const item = await prisma.cargoItem.findUnique({
      where: { id: req.cargoItemId },
      select: { tripId: true },
    });
    await alertRefundFailed(req, item?.tripId ?? null, attempts, lastError);
  }
  return true;
}

/** sin el mensaje: puede traer datos de la base o de MP */
function logWorkerError(err: unknown) {
  console.error("[refunds] falló una request en el worker", {
    name: err instanceof Error ? err.name : typeof err,
    code: err instanceof AppError ? err.code : undefined,
  });
}

/**
 * Worker del outbox de reembolsos (lo corre el scheduler cada minuto).
 *
 * 1. Retoma los PROCESSING colgados hace más de 10 min.
 * 2. Procesa los PENDING cuyo backoff ya venció (`refundBackoffMs`).
 *
 * Cada request va por separado: un error en una no corta la corrida.
 */
export async function processPendingRefunds(
  now: Date = new Date()
): Promise<{ retomadas: number; procesadas: number }> {
  const stale = await prisma.refundRequest.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: new Date(now.getTime() - PROCESSING_TIMEOUT_MS) },
    },
    orderBy: { updatedAt: "asc" },
    take: WORKER_BATCH,
  });
  let retomadas = 0;
  for (const req of stale) {
    try {
      if (await resumeStale(req)) retomadas++;
    } catch (err) {
      logWorkerError(err);
    }
  }

  const pending = await prisma.refundRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { updatedAt: "asc" },
    take: WORKER_BATCH,
  });
  let procesadas = 0;
  for (const req of pending) {
    if (req.updatedAt.getTime() + refundBackoffMs(req.attempts) > now.getTime()) continue;
    try {
      await processRefundRequest(req.cargoItemId, now);
      procesadas++;
    } catch (err) {
      logWorkerError(err);
    }
  }

  return { retomadas, procesadas };
}
