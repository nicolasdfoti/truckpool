import type { Request, Response } from "express";
import * as tripsService from "./trips.service.js";
import type {
  ListTripsQuery,
  LocationQuery,
  PriceEstimateQuery,
  CancellationQuoteQuery,
} from "./trips.schemas.js";
import { AppError } from "../../lib/errors.js";
import { geocode } from "../../lib/geocode.js";

function getParam(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export async function getTrips(_req: Request, res: Response) {
  const filters = (res.locals.query ?? {}) as ListTripsQuery;
  const trips = await tripsService.listOpenTrips(filters);
  res.json(trips);
}

/**
 * GET /api/trips/price-estimate — precio sugerido para un viaje que todavía no
 * existe, más el rango que puede elegir el fletero.
 *
 * Nunca 400 por geocode caído: responde 200 con `geocoded: false` y los
 * números en null. El front usa eso para mostrar el input libre en vez de
 * romper el form por un servicio de terceros que no respondió.
 */
export async function getPriceEstimate(_req: Request, res: Response) {
  const query = (res.locals.query ?? {}) as PriceEstimateQuery;
  const estimate = await tripsService.estimateTripPrice({
    origin: query.origin,
    destination: query.destination,
    truckType: query.truckType,
  });
  res.json(estimate);
}

/**
 * Simulación del retiro: cuánto se devolvería de la seña ahora. Va sin auth
 * porque no lee nada de la base ni de la sesión, solo corre la política de
 * cancelación con los números que le mande el front.
 */
export async function getCancellationQuote(_req: Request, res: Response) {
  const query = (res.locals.query ?? {}) as CancellationQuoteQuery;
  const quote = await tripsService.estimateCancellation({
    depositAmount: query.depositAmount,
    tripDate: query.tripDate,
  });
  res.json(quote);
}

/**
 * Geocode de una dirección libre para la búsqueda por ruta. 400 con mensaje
 * claro si Nominatim no la resuelve: mejor avisar que devolver viajes que en
 * realidad no están cerca de donde el usuario cree.
 */
export async function getGeocode(_req: Request, res: Response) {
  const address = String(res.locals.query?.address ?? "").trim();
  const point = await geocode(address);
  if (!point) {
    throw new AppError(
      `no encontramos la dirección "${address}". probá con una ciudad o un barrio.`,
      400,
      "GEOCODE_NOT_FOUND"
    );
  }
  res.json({ address, ...point });
}

export async function getTrip(req: Request, res: Response) {
  const trip = await tripsService.getTripById(getParam(req, "id"));
  res.json(trip);
}

export async function postTrip(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const trip = await tripsService.createTrip(req.user.id, req.body);
  res.status(201).json(trip);
}

export async function postCargoItem(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const item = await tripsService.addCargoItem(
    getParam(req, "id"),
    req.user.id,
    req.body
  );
  res.status(201).json(item);
}

export async function patchTripStatus(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const trip = await tripsService.updateTripStatus(
    getParam(req, "id"),
    req.user.id,
    req.body.status
  );
  res.json(trip);
}

export async function patchCargoItem(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const item = await tripsService.confirmCargoItem(
    getParam(req, "tripId"),
    getParam(req, "cargoItemId"),
    req.user.id
  );
  res.json(item);
}

/**
 * La empresa retira una carga que sumó. 409 si ya estaba confirmada o si el
 * viaje arrancó; 403 si la carga es de otra empresa.
 */
export async function deleteCargoItem(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const item = await tripsService.cancelCargoItem(
    getParam(req, "tripId"),
    getParam(req, "cargoItemId"),
    req.user.id
  );
  res.json(item);
}

export async function postReview(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const review = await tripsService.createReview(
    getParam(req, "id"),
    req.user.id,
    req.body
  );
  res.status(201).json(review);
}

export async function getTripMessages(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const result = await tripsService.listTripMessages(getParam(req, "id"), req.user.id);
  res.json(result);
}

export async function postTripMessage(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const message = await tripsService.createTripMessage(
    getParam(req, "id"),
    req.user.id,
    req.body
  );
  res.status(201).json(message);
}

export async function patchTripMessagesRead(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const result = await tripsService.markTripMessagesRead(
    getParam(req, "id"),
    req.user.id
  );
  res.json(result);
}

/**
 * El transportista comparte su posición. 403 si el viaje no está en tránsito:
 * no tiene sentido trackear un viaje que no arrancó o que ya terminó.
 */
export async function postTripLocation(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const location = await tripsService.recordTripLocation(
    getParam(req, "id"),
    req.user.id,
    req.body
  );
  res.status(201).json(location);
}

/**
 * Última posición conocida del viaje, o null si todavía no hay ninguna.
 * Con ?history=true viene además el recorrido completo para dibujar la ruta.
 */
export async function getTripLocation(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const { history } = (res.locals.query ?? {}) as LocationQuery;
  const result = await tripsService.getTripLocation(getParam(req, "id"), req.user.id, {
    history: history ?? false,
  });
  res.json(result);
}

export async function getTripManifestPdf(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const { pdf, fileName } = await tripsService.getTripManifest(
    getParam(req, "id"),
    req.user.id
  );

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}.pdf"`);
  res.setHeader("Content-Length", String(pdf.length));
  res.send(pdf);
}

/**
 * GET /api/trips/:id/stops — lista ordenada de paradas (pickups).
 * Solo para participantes del viaje.
 */
export async function getTripStops(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const stops = await tripsService.getTripStops(getParam(req, "id"), req.user.id);
  res.json(stops);
}

/**
 * PATCH /api/trips/:id/stops/reorder — reordena paradas manualmente.
 * Solo el transportista dueño del viaje.
 * Body: array de { cargoItemId, order }.
 */
export async function reorderTripStops(req: Request, res: Response) {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  const { items } = req.body as { items: { cargoItemId: string; order: number }[] };
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError(
      "se requiere un array de items con cargoItemId y order",
      400,
      "INVALID_BODY"
    );
  }
  const stops = await tripsService.reorderTripStops(
    getParam(req, "id"),
    req.user.id,
    items
  );
  res.json(stops);
}

/**
 * GET /api/tracking/:trackingCode — tracking público por código.
 * Sin auth. Devuelve info limitada sin exponer precio, dirección exacta, ni datos de la empresa.
 */
export async function getPublicTracking(req: Request, res: Response) {
  const code = getParam(req, "trackingCode");
  const tracking = await tripsService.getPublicTracking(code);
  if (!tracking) {
    throw new AppError("código de seguimiento no encontrado", 404, "TRACKING_NOT_FOUND");
  }
  res.json(tracking);
}
