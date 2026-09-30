import { Router } from "express";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { validateBody, validateQuery } from "../../lib/validate.js";
import * as tripsController from "./trips.controller.js";
import {
  cancellationQuoteQuerySchema,
  createCargoItemSchema,
  createMessageSchema,
  createReviewSchema,
  createTripSchema,
  createLocationSchema,
  geocodeQuerySchema,
  listTripsQuerySchema,
  locationQuerySchema,
  priceEstimateQuerySchema,
  updateTripStatusSchema,
} from "./trips.schemas.js";

export const tripsRouter = Router();

tripsRouter.get("/", validateQuery(listTripsQuerySchema), tripsController.getTrips);
tripsRouter.get(
  "/geocode",
  validateQuery(geocodeQuerySchema),
  tripsController.getGeocode
);
// antes de "/:id": si no, el router matchearía "price-estimate" como un id
tripsRouter.get(
  "/price-estimate",
  validateQuery(priceEstimateQuerySchema),
  tripsController.getPriceEstimate
);
// antes de "/:id": si no, el router matchearía "cancellation-quote" como un id
tripsRouter.get(
  "/cancellation-quote",
  validateQuery(cancellationQuoteQuerySchema),
  tripsController.getCancellationQuote
);
tripsRouter.get("/:id/manifest.pdf", requireAuth, tripsController.getTripManifestPdf);
tripsRouter.get(
  "/:id/location",
  requireAuth,
  validateQuery(locationQuerySchema),
  tripsController.getTripLocation
);
tripsRouter.post(
  "/:id/location",
  requireAuth,
  requireRole("CARRIER"),
  validateBody(createLocationSchema),
  tripsController.postTripLocation
);
tripsRouter.get("/:id", tripsController.getTrip);
tripsRouter.post(
  "/",
  requireAuth,
  requireRole("CARRIER"),
  validateBody(createTripSchema),
  tripsController.postTrip
);
tripsRouter.post(
  "/:id/cargo-items",
  requireAuth,
  requireRole("COMPANY"),
  validateBody(createCargoItemSchema),
  tripsController.postCargoItem
);
tripsRouter.patch(
  "/:id/status",
  requireAuth,
  requireRole("CARRIER"),
  validateBody(updateTripStatusSchema),
  tripsController.patchTripStatus
);
tripsRouter.delete(
  "/:tripId/cargo-items/:cargoItemId",
  requireAuth,
  requireRole("COMPANY"),
  tripsController.deleteCargoItem
);
tripsRouter.patch(
  "/:tripId/cargo-items/:cargoItemId",
  requireAuth,
  tripsController.patchCargoItem
);
tripsRouter.get("/:id/messages", requireAuth, tripsController.getTripMessages);
tripsRouter.post(
  "/:id/messages",
  requireAuth,
  validateBody(createMessageSchema),
  tripsController.postTripMessage
);
tripsRouter.patch(
  "/:id/messages/read",
  requireAuth,
  tripsController.patchTripMessagesRead
);
tripsRouter.post(
  "/:id/reviews",
  requireAuth,
  validateBody(createReviewSchema),
  tripsController.postReview
);

// Paradas (pickups) del viaje
tripsRouter.get("/:id/stops", requireAuth, tripsController.getTripStops);
tripsRouter.patch(
  "/:id/stops/reorder",
  requireAuth,
  requireRole("CARRIER"),
  tripsController.reorderTripStops
);

// Recorrido del viaje para el mapa. Sin auth: el mapa es público, como
// GET /:id. "route" y "route-geometry" van declarados antes de "/:id" para que
// quede explícito que no los matchea el id.
tripsRouter.get("/:id/route", tripsController.getTripRoute);
tripsRouter.get("/:id/route-geometry", tripsController.getTripRouteGeometry);

// Tracking público (sin auth)
tripsRouter.get("/tracking/:trackingCode", tripsController.getPublicTracking);
