import type { PaymentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { refundPayment, resolveCarrierMpToken } from "../../lib/mercadopago.js";

/**
 * Lo que pasó con la RefundRequest de una carga:
 * - `none`: no había nada pendiente, u otro processor la reclamó primero
 * - `completed`: terminó; `paymentStatus` es el estado en que quedó la seña
 *   (null si no había un pago reembolsable)
 * - `failed`: MP falló; la request volvió a PENDING para reintento
 */
export type RefundOutcome =
  | { kind: "none" }
  | { kind: "completed"; paymentStatus: PaymentStatus | null }
  | { kind: "failed" };

/**
 * Processor de reembolsos (patrón outbox).
 *
 * Toma la RefundRequest PENDING de la carga, le pide el reembolso a Mercado
 * Pago y deja asentado:
 * - RefundRequest: COMPLETED, o de vuelta a PENDING con attempts+1 si falló
 * - Payment: refundedAmount, y REFUNDED si cubrió el total
 *
 * El reclamo es un CAS PENDING→PROCESSING que también exige el `attempts`
 * leído: de dos processors concurrentes (el del retiro, el del webhook o un
 * job) solo uno llama a MP.
 *
 * La clave de idempotencia es por intento (`refund-<request>-<attempts>`): si
 * MP guardara la respuesta de error de un intento bajo su clave, repetirla la
 * devolvería para siempre. Entre intentos el doble reembolso no puede pasar: el
 * CAS deja un solo intento en vuelo y `refundPayment` consulta lo ya devuelto
 * antes de pedir nada.
 *
 * No lanza: quien lo llama ya confirmó su operación y el reembolso se recupera
 * desde la request.
 */
export async function processRefundRequest(cargoItemId: string): Promise<RefundOutcome> {
  const req = await prisma.refundRequest.findUnique({
    where: { cargoItemId },
  });
  if (!req || req.status !== "PENDING") return { kind: "none" };

  const claimed = await prisma.refundRequest.updateMany({
    where: { id: req.id, status: "PENDING", attempts: req.attempts },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) return { kind: "none" };

  try {
    const payment = await prisma.payment.findUnique({
      where: { cargoItemId_type: { cargoItemId, type: "DEPOSIT" } },
      include: {
        cargoItem: {
          select: {
            trip: {
              select: { carrier: { select: { mpUserId: true, mpAccessToken: true } } },
            },
          },
        },
      },
    });
    if (!payment || payment.status !== "APPROVED" || !payment.mpPaymentId) {
      // no hay pago reembolsable: no hay nada que hacer
      await prisma.refundRequest.update({
        where: { id: req.id },
        data: { status: "COMPLETED" },
      });
      return { kind: "completed", paymentStatus: payment?.status ?? null };
    }

    const targetAmount = Number(req.targetAmount);
    // el pago vive en la cuenta MP del transportista: se devuelve con su token
    const { accessToken } = resolveCarrierMpToken(payment.cargoItem.trip.carrier);
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

    await prisma.refundRequest.update({
      where: { id: req.id },
      data: { status: "COMPLETED" },
    });
    return { kind: "completed", paymentStatus: updated.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.refundRequest.update({
      where: { id: req.id },
      data: {
        status: "PENDING",
        attempts: { increment: 1 },
        lastError: message.slice(0, 500),
      },
    });
    return { kind: "failed" };
  }
}
