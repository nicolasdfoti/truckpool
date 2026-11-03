import type { Request, Response } from "express";
import * as paymentsService from "./payments.service.js";
import { AppError } from "../../lib/errors.js";
import { verifyWebhookSignature } from "../../lib/mercadopago.js";
import type {
  MpTestPreferenceBody,
  PaymentPreferenceBody,
  PaymentWebhookBody,
} from "./payments.schemas.js";

function getParam(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function getQuery(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return undefined;
}

export async function postPaymentPreference(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  // el body puede no venir (toda la validación la hace el schema)
  const body = (req.body ?? {}) as Exclude<PaymentPreferenceBody, null | undefined>;
  const preference = await paymentsService.createPaymentPreference(
    getParam(req, "id"),
    req.user.id,
    body.type ?? "DEPOSIT"
  );
  res.status(201).json(preference);
}

/**
 * GET /api/payments/mp/test — prueba de conexión con Mercado Pago.
 *
 * Endpoint de diagnóstico: no toca la base ni el ciclo de pagos, sólo pide
 * `GET /v1/payment_methods` para confirmar que `MP_ACCESS_TOKEN` sirve. El
 * token nunca se devuelve ni se loguea; la respuesta es sólo un booleano y
 * cuántos métodos habilitó la cuenta.
 */
export async function getMpTestConnection(_req: Request, res: Response) {
  res.json(await paymentsService.getMpConnectionStatus());
}

export async function postPaymentWebhook(req: Request, res: Response) {
  const body = (req.body ?? {}) as PaymentWebhookBody;

  verifyWebhookSignature({
    signatureHeader: req.headers["x-signature"] as string | undefined,
    requestIdHeader: req.headers["x-request-id"] as string | undefined,
    dataId: body.data?.id,
  });

  // MP también notifica merchant_order (y otros tipos) al mismo endpoint: su
  // data.id no es un pago. 200 para que no reintente, sin buscar ni consultar.
  if (body.type !== "payment") {
    res.json({ received: true, updated: false, status: null });
    return;
  }

  // data.status y ?preference_id no están firmados: no se leen. ?payment_id es
  // solo una pista para encontrar el pago (ver handlePaymentNotification).
  const result = await paymentsService.handlePaymentNotification({
    mpPaymentId: body.data?.id,
    hintPaymentId: getQuery(req, "payment_id"),
  });

  res.json({ received: true, ...result });
}

export async function postMpTestPreference(req: Request, res: Response) {
  const body = req.body as MpTestPreferenceBody;
  res.json(await paymentsService.getTestPreference(body));
}

/**
 * GET /api/payments/mp/:id — traza de un pago en Mercado Pago.
 *
 * `:id` es el id del pago EN MERCADO PAGO, no el interno. Devuelve el detalle
 * mapeado del pago (con `liveMode` explícito) más el `Payment` interno
 * correlacionado, si lo hay. Quién puede verlo lo decide el service: la empresa
 * o el transportista del viaje, o un ADMIN.
 */
export async function getPaymentTrace(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  res.json(await paymentsService.tracePayment(getParam(req, "id"), req.user));
}
