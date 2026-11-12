import { Router } from "express";
import { optionalAuth, requireAuth, requireRole } from "../../lib/auth.js";
import { validateBody, validateQuery } from "../../lib/validate.js";
import * as tripsController from "./trips.controller.js";
import {
  cancellationQuoteQuerySchema,
  cargoQuoteQuerySchema,
  createCargoItemSchema,
  createMessageSchema,
  createReviewSchema,
  createTripSchema,
  createLocationSchema,
  geocodeQuerySchema,
  listTripsQuerySchema,
  locationQuerySchema,
  priceEstimateQuerySchema,
  reorderStopsSchema,
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
// cotización de una carga por volumen, antes de reservar (pública)
tripsRouter.get(
  "/:id/cargo-quote",
  validateQuery(cargoQuoteQuerySchema),
  tripsController.getCargoQuote
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
// público, pero cada rol ve lo suyo (U7): la sesión es opcional
tripsRouter.get("/:id", optionalAuth, tripsController.getTrip);
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
// U21: la cotización del retiro de una carga, con lo que la empresa pagó
tripsRouter.get(
  "/:tripId/cargo-items/:cargoItemId/cancellation-quote",
  requireAuth,
  requireRole("COMPANY"),
  tripsController.getCargoCancellationQuote
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
// Solo las empresas (las que mandan la carga) califican el viaje. El fletero
// queda afuera: calificar un servicio que él mismo prestó no aporta nada que la
// plataforma no pueda verificar sola, y abre la puerta a represalias.
tripsRouter.post(
  "/:id/reviews",
  requireAuth,
  requireRole("COMPANY"),
  validateBody(createReviewSchema),
  tripsController.postReview
);

// Paradas (pickups) del viaje
tripsRouter.get("/:id/stops", requireAuth, tripsController.getTripStops);
tripsRouter.patch(
  "/:id/stops/reorder",
  requireAuth,
  requireRole("CARRIER"),
  validateBody(reorderStopsSchema),
  tripsController.reorderTripStops
);

// Recorrido del viaje para el mapa. Con sesión y solo para participantes
// activos (U7): el service decide qué paradas ve cada uno.
tripsRouter.get("/:id/route", requireAuth, tripsController.getTripRoute);
tripsRouter.get("/:id/route-geometry", requireAuth, tripsController.getTripRouteGeometry);

// Tracking público (sin auth)
tripsRouter.get("/tracking/:trackingCode", tripsController.getPublicTracking);
