import { Router } from "express";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { validateBody } from "../../lib/validate.js";
import * as paymentsController from "./payments.controller.js";
import { paymentPreferenceSchema, paymentWebhookSchema } from "./payments.schemas.js";

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
