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

  const result = await paymentsService.handlePaymentNotification({
    preferenceId: getQuery(req, "preference_id") ?? getQuery(req, "pref_id"),
    paymentId: getQuery(req, "payment_id"),
    mpPaymentId: body.data?.id,
    status: body.data?.status,
  });

  res.json({ received: true, ...result });
}

export async function postMpTestPreference(req: Request, res: Response) {
  const body = req.body as MpTestPreferenceBody;
  res.json(await paymentsService.getTestPreference(body));
}
