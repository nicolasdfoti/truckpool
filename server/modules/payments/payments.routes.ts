import { Router } from "express";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { validateBody } from "../../lib/validate.js";
import * as paymentsController from "./payments.controller.js";
import {
  mpTestPreferenceSchema,
  paymentPreferenceSchema,
  paymentWebhookSchema,
} from "./payments.schemas.js";

export const paymentsRouter = Router();

paymentsRouter.post(
  "/payments/webhook",
  validateBody(paymentWebhookSchema),
  paymentsController.postPaymentWebhook
);

paymentsRouter.post(
  "/cargo-items/:id/payment-preference",
  requireAuth,
  requireRole("COMPANY"),
  validateBody(paymentPreferenceSchema),
  paymentsController.postPaymentPreference
);

// Prueba de conexión con Mercado Pago (endpoint de diagnóstico, temporal).
// Usa el token de la PLATAFORMA, no el del usuario, así que va restringido a
// ADMIN: no es que un transportista no pueda ver que la integración anda, es
// que este chequeo no le dice nada útil a nadie más. El token no se devuelve
// nunca, ni siquiera en el error.
paymentsRouter.get(
  "/payments/mp/test",
  requireAuth,
  requireRole("ADMIN"),
  paymentsController.getMpTestConnection
);

// Endpoint temporal para crear una preference de Checkout Pro (solo ADMIN).
// Body: { title, quantity, unitPrice }. Devuelve preferenceId e initPoints.
paymentsRouter.post(
  "/payments/mp/test-preference",
  requireAuth,
  requireRole("ADMIN"),
  validateBody(mpTestPreferenceSchema),
  paymentsController.postMpTestPreference
);
