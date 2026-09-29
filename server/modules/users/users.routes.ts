import { Router } from "express";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { validateBody } from "../../lib/validate.js";
import * as usersController from "./users.controller.js";
import {
  requestVerificationSchema,
  reviewVerificationSchema,
  updateProfileSchema,
  createTripRequestSchema,
  respondTripRequestSchema,
} from "./users.schemas.js";

const paramId = "/:id";

export const usersRouter = Router();
export const carriersRouter = Router();
export const adminRouter = Router();

usersRouter.get("/me", requireAuth, usersController.getMe);
usersRouter.patch(
  "/me",
  requireAuth,
  validateBody(updateProfileSchema),
  usersController.patchMe
);
usersRouter.patch(
  "/me/availability",
  requireAuth,
  requireRole("CARRIER"),
  validateBody(updateProfileSchema), // solo valida isAvailableNow
  usersController.patchAvailability
);

// Mercado Pago Marketplace OAuth
usersRouter.get(
  "/me/mp-connect",
  requireAuth,
  requireRole("CARRIER"),
  usersController.getMpConnect
);
usersRouter.get("/me/mp-callback", usersController.getMpCallback);
usersRouter.get(
  "/me/trips",
  requireAuth,
  requireRole("CARRIER"),
  usersController.getMyTrips
);
usersRouter.get(
  "/me/cargo-items",
  requireAuth,
  requireRole("COMPANY"),
  usersController.getMyCargoItems
);

usersRouter.patch(
  "/me/verification",
  requireAuth,
  requireRole("CARRIER"),
  validateBody(requestVerificationSchema),
  usersController.patchVerification
);

// Solicitudes de viaje (trip requests)
usersRouter.post(
  "/trip-requests",
  requireAuth,
  requireRole("COMPANY"),
  validateBody(createTripRequestSchema),
  usersController.createTripRequest
);
usersRouter.get(
  "/trip-requests/received",
  requireAuth,
  requireRole("CARRIER"),
  usersController.getReceivedTripRequests
);
usersRouter.get(
  "/trip-requests/sent",
  requireAuth,
  requireRole("COMPANY"),
  usersController.getSentTripRequests
);
usersRouter.patch(
  "/trip-requests/:id/respond",
  requireAuth,
  requireRole("CARRIER"),
  validateBody(respondTripRequestSchema),
  usersController.respondTripRequest
);

carriersRouter.get("/", usersController.getCarriers);
carriersRouter.get(paramId, usersController.getCarrierProfile);

adminRouter.get(
  "/stats",
  requireAuth,
  requireRole("ADMIN"),
  usersController.getAdminStats
);
adminRouter.get(
  "/verifications",
  requireAuth,
  requireRole("ADMIN"),
  usersController.getPendingVerifications
);
adminRouter.patch(
  "/verifications/:userId",
  requireAuth,
  requireRole("ADMIN"),
  validateBody(reviewVerificationSchema),
  usersController.patchVerificationReview
);
