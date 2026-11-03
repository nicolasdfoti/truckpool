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

// Diagnósticos de Mercado Pago: solo fuera de producción. En prod no se montan
// (responden el 404 genérico): usan el token de la plataforma o exponen el
// detalle de un pago, y no le sirven a ningún usuario real.
if (process.env.NODE_ENV !== "production") {
  // Prueba de conexión con Mercado Pago. Usa el token de la PLATAFORMA, no el
  // del usuario, así que va restringido a ADMIN. El token no se devuelve nunca,
  // ni siquiera en el error. Va ANTES de /payments/mp/:id: si no, "test" se
  // toma como un id de pago y esta ruta nunca se alcanza.
  paymentsRouter.get(
    "/payments/mp/test",
    requireAuth,
    requireRole("ADMIN"),
    paymentsController.getMpTestConnection
  );

  // Preference de Checkout Pro de prueba (solo ADMIN).
  // Body: { title, quantity, unitPrice }. Devuelve preferenceId e initPoints.
  paymentsRouter.post(
    "/payments/mp/test-preference",
    requireAuth,
    requireRole("ADMIN"),
    validateBody(mpTestPreferenceSchema),
    paymentsController.postMpTestPreference
  );

  // Traza de un pago de Mercado Pago. El control de acceso NO es requireRole:
  // la visibilidad la resuelve `tracePayment` en el service según quién es el
  // dueño del recurso (la empresa o el transportista del viaje) o si es ADMIN.
  // Va con requireAuth sí o sí, así que nunca hay una consulta a MP sin sesión.
  paymentsRouter.get("/payments/mp/:id", requireAuth, paymentsController.getPaymentTrace);
}
