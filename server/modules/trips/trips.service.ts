import { prisma } from "../../lib/prisma.js";
import { Prisma } from "@prisma/client";
import type { Trip } from "@prisma/client";
import {
  activeVolume,
  isActiveCargo,
  toCargoItemResponse,
  toTripSummary,
  tripAcceptsCargo,
} from "../../lib/mappers.js";
import { geocode, haversineKm, type LatLng } from "../../lib/geocode.js";
import { fetchRouteGeometry } from "../../lib/routing.js";
import { point, lineString, pointToLineDistance } from "@turf/turf";
import {
  formatPesos,
  isPriceInRange,
  priceRangeFor,
  rateFor,
} from "../../lib/pricing.js";
import { refundPayment } from "../../lib/mercadopago.js";
import { hoursUntilTrip, quoteCancellation } from "../../lib/cancellation.js";
import { balanceOf } from "../payments/payments.service.js";
import {
  manifestFileName,
  renderManifestPdf,
  type ManifestTrip,
} from "../../lib/manifestPdf.js";
import {
  balanceDueEmail,
  cargoAddedEmail,
  cargoCancelledEmail,
  cargoConfirmedEmail,
  tripStatusEmail,
} from "../../lib/email.js";
import { notifyUsers } from "../../lib/notifications.js";
import { endOfArgentinaDay, isTripDateAvailable } from "../../lib/dates.js";
import {
  AlreadyReviewedError,
  BalancePendingError,
  CarrierNotVerifiedError,
  CargoItemNotCancellableError,
  CargoItemNotFoundError,
  InvalidTransitionError,
  NotEnoughCapacityError,
  PaymentRequiredError,
  ReviewTargetRequiredError,
  TripAlreadyStartedError,
  TripDatePassedError,
  TripNotCompletedError,
  TripNotInTransitError,
  TripNotFoundError,
  TripNotOpenError,
} from "../../lib/errors.js";
import { AppError } from "../../lib/errors.js";
import type {
  CreateLocationInput,
  CreateMessageInput,
  CreateReviewInput,
  CreateTripInput,
  ListTripsQuery,
  ProximityFilter,
} from "./trips.schemas.js";
import type { CreateCargoItemInput } from "./trips.schemas.js";

const MAX_RETRIES = 3;

/**
 * Una reserva de espacio vale 24hs: si en ese plazo la empresa no abonó la
 * seña, el lugar vuelve a estar disponible para otro. No hay cron, el chequeo
 * es perezoso (ver releaseExpiredReservations).
 */
const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_STOP_DISTANCE_FROM_ROUTE_KM = Number(process.env.MAX_STOP_DISTANCE_FROM_ROUTE_KM ?? 8);

/**
 * Los avisos nunca pueden romper la operación de negocio que los dispara: si
 * la creación del aviso o el envío del email explota, se loguea y se sigue.
 * (notifyUsers ya es a prueba de errores de email; esto cubre el resto, como
 * que la base no responda al crear la Notification.)
 */
async function bestEffortNotify(send: () => Promise<unknown>): Promise<void> {
  try {
    await send();
  } catch (err) {
    console.error("[notificaciones] falló el aviso, la operación sigue:", err);
  }
}

/** los importes que se suman (o restan) en un email van redondeados como el backend cobra */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const ALLOWED_TRANSITIONS: Record<"IN_TRANSIT" | "COMPLETED", Trip["status"][]> = {
  IN_TRANSIT: ["OPEN", "FULL"],
  COMPLETED: ["IN_TRANSIT"],
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );
}

export async function listOpenTrips(filters: ListTripsQuery = {}, now: Date = new Date()) {
  const where: Prisma.TripWhereInput = { status: "OPEN" };

  // Un viaje deja de ser una oportunidad para sumar carga cuando llega su fecha,
  // aunque el estado siga OPEN. El corte es el último instante del día de hoy en
  // Argentina: más allá de ese instante el viaje es de un día posterior.
  const dateFilter: Prisma.DateTimeFilter = { gt: endOfArgentinaDay(now) };

  if (filters.origin) {
    where.origin = { contains: filters.origin, mode: "insensitive" };
  }
  if (filters.destination) {
    where.destination = { contains: filters.destination, mode: "insensitive" };
  }
  if (filters.dateFrom) {
    dateFilter.gte = startOfUtcDay(filters.dateFrom);
  }
  if (filters.dateTo) {
    dateFilter.lte = endOfUtcDay(filters.dateTo);
  }
  where.date = dateFilter;
  if (filters.features && filters.features.length > 0) {
    where.features = { hasEvery: filters.features };
  }

  // antes de contar lugares libres: una reserva vencida libera su espacio acá
  // mismo, sin depender de un job.
  await releaseExpiredReservations();

  const trips = await prisma.trip.findMany({
    where,
    include: { cargoItems: true, carrier: { select: { name: true } } },
    orderBy: { date: "asc" },
  });

  const filtered = applyProximityFilter(trips, filters);
  return filtered.map(toTripSummary);
}

type TripWithCoords = {
  originLat: number | null;
  originLng: number | null;
  destLat: number | null;
  destLng: number | null;
};

/**
 * Filtro por proximidad en memoria con haversine: a este volumen no hace falta
 * PostGIS. Los viajes sin coordenadas (creados antes de la feature, o cuyo
 * geocode falló) quedan afuera: no se puede afirmar que estén cerca.
 */
function applyProximityFilter<
  T extends TripWithCoords & { cargoItems: unknown[]; carrier: { name: string } },
>(
  trips: T[],
  filters: {
    nearOrigin?: ProximityFilter | undefined;
    nearDestination?: ProximityFilter | undefined;
  }
): T[] {
  if (!filters.nearOrigin && !filters.nearDestination) return trips;

  return trips.filter((trip) => {
    if (filters.nearOrigin) {
      const target: LatLng = {
        lat: filters.nearOrigin.lat,
        lng: filters.nearOrigin.lng,
      };
      if (
        trip.originLat === null ||
        trip.originLng === null ||
        haversineKm({ lat: trip.originLat, lng: trip.originLng }, target) >
          filters.nearOrigin.radiusKm
      ) {
        return false;
      }
    }
    if (filters.nearDestination) {
      const target: LatLng = {
        lat: filters.nearDestination.lat,
        lng: filters.nearDestination.lng,
      };
      if (
        trip.destLat === null ||
        trip.destLng === null ||
        haversineKm({ lat: trip.destLat, lng: trip.destLng }, target) >
          filters.nearDestination.radiusKm
      ) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Reserva vencida: una carga PENDING que no pagó su seña dentro de las 24hs
 * libera el lugar. Es perezoso a propósito (no hay cron ni worker en el stack):
 * cada vez que alguien mira los viajes o entra a uno, aprovechamos para
 * limpiar las reservas que ya vencieron.
 *
 * Solo se liberan cargas de viajes que todavía no salieron (OPEN/FULL): con el
 * camión en camino la reserva dejó de ser un espacio en un viaje futuro.
 * No avisamos por email a la empresa: es la consecuencia de no pagar, y el
 * transportista igual ve el lugar libre.
 */
export async function releaseExpiredReservations(
  now: Date = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - RESERVATION_TTL_MS);
  const expired = await prisma.cargoItem.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: cutoff },
      // la seña pagada reserva el lugar para siempre (la empresa todavía
      // puede confirmar o retirar). un pago rechazado tampoco bloquea: si
      // Mercado Pago lo marcó como no cobrado no hay nada que esperar.
      trip: { status: { in: ["OPEN", "FULL"] } },
      payments: { none: { type: "DEPOSIT", status: "APPROVED" } },
    },
    select: { id: true, tripId: true },
  });
  if (expired.length === 0) return 0;

  const byTrip = new Map<string, typeof expired>();
  for (const item of expired) {
    const bucket = byTrip.get(item.tripId);
    if (bucket) bucket.push(item);
    else byTrip.set(item.tripId, [item]);
  }

  let released = 0;
  for (const [tripId, items] of byTrip) {
    const ids = items.map((i) => i.id);
    // La búsqueda y el update no son atómicos: entre los dos la empresa puede
    // acreditar la seña (el webhook de Mercado Pago). Por eso el update vuelve
    // a exigir las mismas condiciones que el filtro: si el pago entró, la
    // reserva se mantiene y no perdemos la plata de la empresa. El updateMany
    // devuelve cuántos se liberaron, que puede ser menos que `ids`.
    const result = await prisma.cargoItem.updateMany({
      where: {
        id: { in: ids },
        status: "PENDING",
        trip: { status: { in: ["OPEN", "FULL"] } },
        payments: { none: { type: "DEPOSIT", status: "APPROVED" } },
      },
      // se libera el lugar sin cobrar nada: el filtro garantiza que no hay
      // seña acreditada, así que el fee es 0 (y no null, que significa "la
      // carga sigue viva").
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancellationFeeAmount: new Prisma.Decimal(0),
      },
    });

    released += result.count;

    // el lugar vuelve al viaje. Se relee el viaje porque el snapshot previo ya
    // no sirve: entre la búsqueda y el update las cargas pudieron cambiar.
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        status: true,
        capacityTotal: true,
        cargoItems: { select: { volume: true, status: true } },
      },
    });
    if (!trip) continue;
    const used = activeVolume(trip.cargoItems);
    if (trip.status === "FULL" && used < trip.capacityTotal) {
      await prisma.trip.update({ where: { id: tripId }, data: { status: "OPEN" } });
    }
  }

  return released;
}

export async function getTripById(id: string) {
  await releaseExpiredReservations();

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      cargoItems: { include: { payments: true, company: { select: { name: true } } } },
      carrier: { select: { name: true } },
      reviews: {
        orderBy: { createdAt: "desc" },
        include: {
          fromUser: { select: { name: true } },
          toUser: { select: { name: true } },
        },
      },
    },
  });
  if (!trip) throw new TripNotFoundError();

  return {
    id: trip.id,
    origin: trip.origin,
    destination: trip.destination,
    date: trip.date,
    departureTime: trip.departureTime,
    truckType: trip.truckType,
    capacityTotal: trip.capacityTotal,
    capacityUsed: activeVolume(trip.cargoItems),
    price: Number(trip.price),
    status: trip.status,
    // misma bandera que manda en el listado y en la respuesta de detalle: el
    // cliente la usa para no ofrecer el formulario de carga.
    acceptsCargo: tripAcceptsCargo(trip),
    carrierId: trip.carrierId,
    depositPercent: trip.depositPercent,
    cargoItems: trip.cargoItems.map(toCargoItemResponse),
    carrierName: trip.carrier.name,
    features: trip.features,
    reviews: trip.reviews.map(toReviewResponse),
  };
}

/**
 * Precio sugerido + rango válido para un viaje que aún no existe.
 *
 * Los dos strings llegan al mismo `geocode()` que usa createTrip, así que si el
 * front ya geocodificó cada campo para mover el pin, esta llamada pega
 * al cache y no gasta un request del rate limit de Nominatim.
 */
export async function estimateTripPrice(input: {
  origin: string;
  destination: string;
  truckType: string;
}) {
  const [origin, destination] = await Promise.all([
    geocode(input.origin),
    geocode(input.destination),
  ]);
  const rate = rateFor(input.truckType);
  const base = { truckType: input.truckType, rate };

  if (!origin || !destination) {
    return {
      ...base,
      geocoded: false,
      distanceKm: null,
      suggestedPrice: null,
      minPrice: null,
      maxPrice: null,
    };
  }

  const distanceKm = haversineKm(origin, destination);
  return { ...base, geocoded: true, ...priceRangeFor(input.truckType, distanceKm) };
}

/**
 * Cuánto se devolvería de una seña si se retirara ahora. El cliente lo pide
 * para el texto de confirmación en vez de recalcularlo con su propia copia de la
 * fórmula: si mañana PARTIAL_REFUND_RATIO deja de ser 0.5, este endpoint cambia
 * solo y el front no puede quedar prometiendo otra cosa.
 *
 * No toca la base ni descuenta nada: es una simulación con la misma función que
 * usa el retiro real, así que lo que dice es lo que va a pasar.
 */
export async function estimateCancellation(input: {
  depositAmount: number;
  tripDate: string;
}) {
  return quoteCancellation(input.depositAmount, hoursUntilTrip(input.tripDate));
}

export async function createTrip(carrierId: string, data: CreateTripInput) {
  const carrier = await prisma.user.findUnique({
    where: { id: carrierId },
    select: { verificationStatus: true, mpUserId: true },
  });
  if (!carrier) {
    throw new AppError("usuario no encontrado", 404, "USER_NOT_FOUND");
  }
  // publicar viajes es para transportistas verificados: sin DNI/CUIT aprobado
  // por un admin no pueden ofrecer capacidad.
  if (carrier.verificationStatus !== "VERIFIED") throw new CarrierNotVerifiedError();
  // Para recibir pagos con split (Marketplace) el carrier debe tener cuenta MP conectada.
  if (!carrier.mpUserId) {
    throw new AppError(
      "para publicar viajes debés conectar tu cuenta de Mercado Pago desde tu perfil",
      403,
      "MP_ACCOUNT_NOT_CONNECTED"
    );
  }

  // Geocodificar es best-effort: si Nominatim no responde o no encuentra el
  // lugar, el viaje se crea igual con las coordenadas en null. Son tres requests
  // encolados a 1/segundo por el rate limit de Nominatim, por eso el submit
  // tarda un poco más.
  const [origin, destination, departure] = await Promise.all([
    geocode(data.origin),
    geocode(data.destination),
    data.departureAddress ? geocode(data.departureAddress) : Promise.resolve(null),
  ]);

  // Con las dos puntas ya geocodificadas se puede sugerir precio y acotar lo
  // que el fletero puede pedir. Si falta alguna, no hay distancia: se deja el
  // precio sin restringir en vez de frenar la publicación por un geocode caído.
  if (origin && destination) {
    const range = priceRangeFor(data.truckType, haversineKm(origin, destination));
    if (!isPriceInRange(data.price, range)) {
      throw new AppError(
        `el precio está fuera del rango razonable para ${Math.round(range.distanceKm)} km: ` +
          `tiene que estar entre ${formatPesos(range.minPrice)} y ${formatPesos(range.maxPrice)} ` +
          `(sugerido ${formatPesos(range.suggestedPrice)}).`,
        400,
        "PRICE_OUT_OF_RANGE"
      );
    }
  }

  const trip = await prisma.trip.create({
    data: {
      carrierId,
      origin: data.origin,
      destination: data.destination,
      departureAddress: data.departureAddress ?? null,
      date: data.date,
      departureTime: data.departureTime ?? null,
      truckType: data.truckType,
      capacityTotal: data.capacityTotal,
      price: new Prisma.Decimal(data.price),
      depositPercent: data.depositPercent,
      features: data.features,
      originLat: origin?.lat ?? null,
      originLng: origin?.lng ?? null,
      destLat: destination?.lat ?? null,
      destLng: destination?.lng ?? null,
      departureLat: departure?.lat ?? null,
      departureLng: departure?.lng ?? null,
    },
    include: { cargoItems: true, carrier: { select: { name: true } } },
  });
  return toTripSummary(trip);
}

type BalanceDue = {
  company: { id: string };
  description: string;
  amount: number;
  priceShare: number;
  depositAmount: number;
};

type StatusChangeResult = {
  trip: ReturnType<typeof toTripSummary>;
  balancesDue: BalanceDue[];
};

export async function updateTripStatus(
  tripId: string,
  carrierId: string,
  status: "IN_TRANSIT" | "COMPLETED"
): Promise<ReturnType<typeof toTripSummary>> {
  // El cambio de estado y los saldos a cobrar se escriben juntos: si el viaje
  // quedara IN_TRANSIT sin sus pagos BALANCE, nadie podría cobrarlos y el
  // balance de la carga quedaría trucho.
  const result = await prisma.$transaction(
    async (tx): Promise<StatusChangeResult> => {
      const trip = await tx.trip.findUnique({
        where: { id: tripId },
        include: {
          cargoItems: {
            include: {
              payments: true,
              company: { select: { id: true } },
            },
          },
          carrier: { select: { name: true } },
        },
      });
      if (!trip) throw new TripNotFoundError();
      if (trip.carrierId !== carrierId) {
        throw new AppError(
          "solo el transportista del viaje puede actualizar su estado",
          403,
          "FORBIDDEN"
        );
      }
      if (!ALLOWED_TRANSITIONS[status].includes(trip.status)) {
        throw new InvalidTransitionError();
      }

      // completar el viaje es cerrar la cuenta: no se puede hasta que todas
      // las cargas confirmadas tenga su saldo abonado.
      if (status === "COMPLETED") {
        const pending = trip.cargoItems.filter(
          (item) => item.status === "CONFIRMED" && !isBalanceSettled(item)
        );
        if (pending.length > 0) throw new BalancePendingError(pending.length);
      }

      const updated = await tx.trip.update({
        where: { id: tripId },
        data: { status },
        include: { cargoItems: true, carrier: { select: { name: true } } },
      });

      const balancesDue: BalanceDue[] = [];
      if (status === "IN_TRANSIT") {
        for (const item of trip.cargoItems) {
          // solo las cargas confirmadas: una reserva sin pagar no viaja.
          if (item.status !== "CONFIRMED") continue;
          const amount = Number(balanceOf(item));
          if (amount <= 0) continue;

          const already = item.payments.find(
            (p) =>
              p.type === "BALANCE" && (p.status === "APPROVED" || p.status === "REFUNDED")
          );
          if (already) continue;

          await tx.payment.upsert({
            where: { cargoItemId_type: { cargoItemId: item.id, type: "BALANCE" } },
            create: { cargoItemId: item.id, amount, type: "BALANCE" },
            // si ya había un saldo pendiente no lo reiniciamos: puede ser que la
            // empresa ya tenga el link de pago de este mismo monto.
            update: {},
          });
          balancesDue.push({
            company: item.company,
            description: item.description,
            amount,
            priceShare: Number(item.priceShare),
            depositAmount: Number(item.depositAmount),
          });
        }
      }

      return { trip: toTripSummary(updated), balancesDue };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000 }
  );

  // Aviso de estado del viaje: una vez por empresa, aunque tenga varias cargas
  // (notifyUsers deduplica los ids, pero el aviso se arma con la descripción de
  // la primera carga para no duplicar texto). Los avisos nunca rompen la
  // actualización de estado.
  const items = await prisma.cargoItem.findMany({
    where: { tripId },
    select: { description: true, companyId: true },
    orderBy: { createdAt: "asc" },
  });
  const seenCompanies = new Set<string>();
  for (const item of items) {
    if (seenCompanies.has(item.companyId)) continue;
    seenCompanies.add(item.companyId);
    const statusTrip = {
      id: tripId,
      origin: result.trip.origin,
      destination: result.trip.destination,
      carrierName: result.trip.carrierName,
    };
    await bestEffortNotify(() =>
      notifyUsers([item.companyId], {
        type: "TRIP_STATUS_CHANGED",
        title:
          status === "IN_TRANSIT"
            ? `tu viaje va en camino: ${statusTrip.origin} → ${statusTrip.destination}`
            : `tu viaje se completó: ${statusTrip.origin} → ${statusTrip.destination}`,
        body:
          status === "IN_TRANSIT"
            ? `${statusTrip.carrierName} salió, donde va tu carga ${item.description.toLowerCase()}.`
            : `${statusTrip.origin} → ${statusTrip.destination} se completó y tu carga ${item.description.toLowerCase()} llegó a destino.`,
        tripId,
        email: (user) =>
          tripStatusEmail({
            company: user,
            trip: statusTrip,
            status,
            cargoDescription: item.description,
          }),
      })
    );
  }

  // El saldo se cobra ahora: le decimos a cada empresa cuánto y cómo pagarlo.
  // Si la empresa tiene varias cargas en el viaje va un solo email con la suma,
  // no uno por carga (y con el total, que es el número que de verdad tiene que
  // tener delante para pagar).
  const byCompany = new Map<
    string,
    {
      company: (typeof result.balancesDue)[number]["company"];
      balanceAmount: number;
      priceShare: number;
      depositAmount: number;
      descriptions: string[];
    }
  >();
  for (const balance of result.balancesDue) {
    const key = balance.company.id;
    const agg = byCompany.get(key);
    if (agg) {
      agg.balanceAmount = round2(agg.balanceAmount + balance.amount);
      agg.priceShare = round2(agg.priceShare + balance.priceShare);
      agg.depositAmount = round2(agg.depositAmount + balance.depositAmount);
      agg.descriptions.push(balance.description);
    } else {
      byCompany.set(key, {
        company: balance.company,
        balanceAmount: balance.amount,
        priceShare: balance.priceShare,
        depositAmount: balance.depositAmount,
        descriptions: [balance.description],
      });
    }
  }
  for (const agg of byCompany.values()) {
    const balanceTrip = {
      id: tripId,
      origin: result.trip.origin,
      destination: result.trip.destination,
      carrierName: result.trip.carrierName,
    };
    await bestEffortNotify(() =>
      notifyUsers([agg.company.id], {
        type: "BALANCE_DUE",
        title: `falta pagar el saldo de tu carga: ${balanceTrip.origin} → ${balanceTrip.destination}`,
        body: `tu carga va en camino: quedan $${agg.balanceAmount} de saldo de $${agg.priceShare} para cerrar el viaje.`,
        tripId,
        email: (user) =>
          balanceDueEmail({
            company: user,
            trip: balanceTrip,
            balanceAmount: agg.balanceAmount,
            priceShare: agg.priceShare,
            depositAmount: agg.depositAmount,
            descriptions: agg.descriptions,
          }),
      })
    );
  }

  return result.trip;
}

/** el saldo está saldado cuando el pago BALANCE existe y está APPROVED */
function isBalanceSettled(item: {
  priceShare: Prisma.Decimal;
  depositAmount: Prisma.Decimal;
  payments: { type: string; status: string }[];
}) {
  const balance = item.payments.find((p) => p.type === "BALANCE");
  if (balanceOf(item).lte(0)) return true;
  return balance?.status === "APPROVED";
}

export async function confirmCargoItem(
  tripId: string,
  cargoItemId: string,
  userId: string
) {
  const item = await prisma.cargoItem.findUnique({
    where: { id: cargoItemId },
    include: {
      payments: true,
      trip: {
        select: {
          origin: true,
          destination: true,
          carrier: { select: { name: true } },
        },
      },
    },
  });
  if (!item || item.tripId !== tripId) throw new CargoItemNotFoundError();
  if (item.status === "CONFIRMED") return toCargoItemResponse(item);

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { carrierId: true },
  });
  const isCarrier = trip?.carrierId === userId;
  const isCompany = item.companyId === userId;
  if (!isCarrier && !isCompany) {
    throw new AppError("no tenés permisos para confirmar esta carga", 403, "FORBIDDEN");
  }

  // lo que confirma la carga es la seña, no cualquier pago: el saldo todavía ni
  // existe hasta que el viaje sale.
  const deposit = item.payments.find((p) => p.type === "DEPOSIT");
  if (deposit?.status !== "APPROVED") throw new PaymentRequiredError();

  const updated = await prisma.cargoItem.update({
    where: { id: cargoItemId },
    data: { status: "CONFIRMED" },
    include: { payments: true },
  });

  // aviso a la empresa que confirmó la carga (in-app + email)
  const confirmTrip = {
    id: tripId,
    origin: item.trip?.origin ?? "",
    destination: item.trip?.destination ?? "",
    carrierName: item.trip?.carrier.name ?? "el transportista",
  };
  await bestEffortNotify(() =>
    notifyUsers([item.companyId], {
      type: "CARGO_CONFIRMED",
      title: `tu carga está confirmada: ${confirmTrip.origin} → ${confirmTrip.destination}`,
      body: `confirmamos ${updated.description.toLowerCase()} (${updated.volume} m³) en el viaje con ${confirmTrip.carrierName}.`,
      tripId,
      email: (user) =>
        cargoConfirmedEmail({
          company: user,
          trip: confirmTrip,
          description: updated.description,
          volume: updated.volume,
        }),
    })
  );

  return toCargoItemResponse(updated);
}

type CargoCancelledEmail = {
  carrierId: string;
  trip: { id: string; origin: string; destination: string };
  companyName: string;
  description: string;
  volume: number;
  remaining: number;
  capacityTotal: number;
  refundedAmount: number;
  feeAmount: number;
  window: string;
};

/**
 * Retirar una carga que sumó la empresa. Solo mientras la carga está PENDING y
 * el viaje no arrancó: una carga confirmada ya es un acuerdo con el
 * transportista, y con el camión en camino retirar carga no tiene sentido.
 *
 * La seña se devuelve según cuánto falta para que salga el viaje: entera con más
 * de 48hs, la mitad entre 24 y 48hs, nada por debajo de las 24hs (la seña queda
 * como costo de cancelación). Ver lib/cancellation.ts.
 *
 * El registro no se borra (queda como CANCELLED: es historial de lo que pasó
 * con el viaje) pero deja de ocupar lugar, y si el viaje estaba FULL por esta
 * carga vuelve a OPEN.
 *
 * PATRÓN OUTBOX (Fase 2.2): el reembolso a Mercado Pago NO se hace dentro de
 * esta transacción. En su lugar, si hay una seña pagada y la ventana de
 * cancelación prevé devolución, se crea una RefundRequest en PENDING. Un
 * processor separado (fuera de la TX, best-effort) la recoge, llama a
 * refundPayment (ya idempotente por Fase 2.1) y actualiza el status. Si la TX
 * hace rollback, la RefundRequest no se crea; si el processor falla, la
 * request queda en PENDING para reintento (manual o job). Así la transacción
 * de DB queda corta y no puede desincronizar dinero y base.
 */
export async function cancelCargoItem(
  tripId: string,
  cargoItemId: string,
  companyId: string
): Promise<CargoItemResponse> {
  let lastError: unknown;
  let outcome: { response: CargoItemResponse; email: CargoCancelledEmail } | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      outcome = await prisma.$transaction(
        async (tx) => {
          const item = await tx.cargoItem.findUnique({
            where: { id: cargoItemId },
            include: { payments: true, company: { select: { name: true } } },
          });
          if (!item || item.tripId !== tripId) throw new CargoItemNotFoundError();
          if (item.companyId !== companyId) {
            throw new AppError(
              "solo podés retirar una carga que sumaste vos",
              403,
              "FORBIDDEN"
            );
          }
          if (item.status === "CONFIRMED" || item.status === "CANCELLED") {
            throw new CargoItemNotCancellableError(item.status);
          }

          const trip = await tx.trip.findUnique({
            where: { id: tripId },
            include: { cargoItems: true },
          });
          if (!trip) throw new TripNotFoundError();
          if (trip.status !== "OPEN" && trip.status !== "FULL") {
            throw new TripAlreadyStartedError();
          }

          const deposit = item.payments.find((p) => p.type === "DEPOSIT");
          const paidDeposit =
            deposit?.status === "APPROVED" && deposit.mpPaymentId !== null
              ? deposit
              : null;
          const quote = quoteCancellation(
            Number(item.depositAmount),
            hoursUntilTrip(trip.date)
          );

          // Un fee es plata que se retiene de un pago que REALMENTE entró. Si la
          // empresa nunca pagó la seña (o el pago APPROVED no tiene mpPaymentId y
          // no se puede devolver) no hay nada retenido: el fee va en 0, igual que
          // el reembolso, en vez de inventar una deuda.
          const feeAmount = paidDeposit ? quote.feeAmount : 0;

          // OUTBOX: si hay seña pagada y la ventana dice que se devuelve algo,
          // creamos una RefundRequest en PENDING. El processor (fuera de la TX)
          // llamará a refundPayment y actualizará el Payment cuando termine.
          if (paidDeposit && quote.refundAmount > 0) {
            await tx.refundRequest.create({
              data: {
                cargoItemId,
                targetAmount: new Prisma.Decimal(quote.refundAmount),
                status: "PENDING",
              },
            });
          }

          const updated = await tx.cargoItem.update({
            where: { id: cargoItemId },
            data: {
              status: "CANCELLED",
              cancelledAt: new Date(),
              cancellationFeeAmount: new Prisma.Decimal(feeAmount),
            },
            include: { payments: true, company: { select: { name: true } } },
          });

          // el espacio vuelve al viaje. trip.cargoItems es el snapshot previo al
          // update, así que hay que excluir la carga que recién retiramos.
          const used = activeVolume(trip.cargoItems.filter((c) => c.id !== cargoItemId));
          if (trip.status === "FULL" && used < trip.capacityTotal) {
            await tx.trip.update({ where: { id: tripId }, data: { status: "OPEN" } });
          }

          // El email avisa la ventana (quote.window) y el fee. El monto real
          // devuelto se informará cuando el processor complete (o se puede
          // consultar en el cargo). No prometemos un número que aún no confirmó MP.
          return {
            response: toCargoItemResponse(updated),
            email: {
              carrierId: trip.carrierId,
              trip: { id: trip.id, origin: trip.origin, destination: trip.destination },
              companyName: item.company.name,
              description: item.description,
              volume: item.volume,
              remaining: trip.capacityTotal - used,
              capacityTotal: trip.capacityTotal,
              // refundedAmount: 0  (aún no procesado; el email no lo usa para
              // prometer un número, solo avisa que hubo retiro)
              refundedAmount: 0,
              feeAmount,
              window: quote.window,
            } satisfies CargoCancelledEmail,
          };
        },
        // timeout holgado: la transacción ya no espera a Mercado Pago, pero
        // Serializable + retry P2034 sigue necesitando margen.
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 15000,
        }
      );
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
        continue;
      }
      throw err;
    }
  }

  if (!outcome) throw lastError;

  // best-effort: notificamos al transportista (la carga ya está CANCELLED).
  await bestEffortNotify(() => {
    const data = outcome!.email;
    return notifyUsers([data.carrierId], {
      type: "CARGO_CANCELLED",
      title: `una carga se retiró de tu viaje ${data.trip.origin} → ${data.trip.destination}`,
      body: `${data.companyName} retiró ${data.description.toLowerCase()} (${data.volume} m³) del viaje.`,
      tripId: data.trip.id,
      email: (user) => cargoCancelledEmail({ ...data, carrier: user }),
    });
  });

  // OUTBOX processor: tras confirmar la TX, intentamos procesar reembolsos
  // pendientes de este cargo. Si falla, la RefundRequest queda en PENDING
  // y el próximo reintento (manual o job) la recogerá.
  await processRefundRequest(cargoItemId).catch(() => {
    // silencioso: el estado PENDING es la fuente de verdad para reintento
  });

  return outcome.response;
}

type CargoItemResponse = ReturnType<typeof toCargoItemResponse>;

type CargoAddedEmail = {
  carrierId: string;
  trip: { id: string; origin: string; destination: string };
  description: string;
  volume: number;
  remaining: number;
  capacityTotal: number;
};

function generateTrackingCode(tripId: string, cargoIndex: number): string {
  const suffix = tripId.slice(-4).toUpperCase();
  return `TP-${suffix}-C${cargoIndex}`;
}

/**
 * Calcula el orden de parada proyectando cada pickup sobre la línea recta
 * origen→destino del viaje (producto punto normalizado). Los items con
 * stopOrder manual se respetan y se intercalan en su posición.
 */
export function calculateStopOrder(
  trip: {
    originLat: number | null;
    originLng: number | null;
    destLat: number | null;
    destLng: number | null;
  },
  cargoItems: {
    id: string;
    pickupLat: number | null;
    pickupLng: number | null;
    stopOrder: number | null;
  }[]
): Map<string, number> {
  // si el viaje no tiene coordenadas, no se puede proyectar → orden por creación
  if (
    trip.originLat === null ||
    trip.originLng === null ||
    trip.destLat === null ||
    trip.destLng === null
  ) {
    const manual = cargoItems
      .filter((c) => c.stopOrder !== null)
      .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
    const auto = cargoItems.filter((c) => c.stopOrder === null);
    const order = new Map<string, number>();
    let idx = 1;
    for (const item of manual) {
      order.set(item.id, idx++);
    }
    for (const item of auto) {
      order.set(item.id, idx++);
    }
    return order;
  }

  // vector de la ruta origen→destino (trip ya validado no-null arriba, pero TS no lo sabe)
  const oLat = trip.originLat ?? 0;
  const oLng = trip.originLng ?? 0;
  const dLat = trip.destLat ?? 0;
  const dLng = trip.destLng ?? 0;
  const routeVec = { lat: dLat - oLat, lng: dLng - oLng };
  const routeLenSq = routeVec.lat ** 2 + routeVec.lng ** 2;

  // para cada carga sin stopOrder manual, calcular proyección
  const withProjection = cargoItems.map((item) => {
    let projection = 0;
    if (item.pickupLat !== null && item.pickupLng !== null && routeLenSq > 0) {
      const vec = { lat: item.pickupLat - oLat, lng: item.pickupLng - oLng };
      projection = (vec.lat * routeVec.lat + vec.lng * routeVec.lng) / routeLenSq;
    }
    return { ...item, projection };
  });

  // separar manuales y automáticos
  const manual = withProjection
    .filter((c) => c.stopOrder !== null)
    .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
  const auto = withProjection
    .filter((c) => c.stopOrder === null)
    .sort((a, b) => a.projection - b.projection);

  // intercalar: insertar automáticos en los huecos entre manuales
  const order = new Map<string, number>();
  let idx = 1;
  let autoIdx = 0;

  for (const item of manual) {
    // insertar automáticos cuya proyección caiga antes de este manual
    while (autoIdx < auto.length) {
      const autoItem = auto[autoIdx];
      if (!autoItem) break;
      if (
        autoItem.projection >=
        (item.stopOrder ?? 0) / (manual.length + auto.length + 1)
      )
        break;
      order.set(autoItem.id, idx++);
      autoIdx++;
    }
    order.set(item.id, idx++);
  }
  // resto de automáticos
  while (autoIdx < auto.length) {
    const autoItem = auto[autoIdx];
    if (!autoItem) break;
    order.set(autoItem.id, idx++);
    autoIdx++;
  }

  return order;
}

export async function addCargoItem(
  tripId: string,
  companyId: string,
  data: CreateCargoItemInput
): Promise<CargoItemResponse> {
  let lastError: unknown;
  let created: { response: CargoItemResponse; email: CargoAddedEmail } | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      created = await prisma.$transaction(
        async (tx) => {
          const trip = await tx.trip.findUnique({
            where: { id: tripId },
            include: { cargoItems: true },
          });
          if (!trip) throw new TripNotFoundError();
          if (trip.status !== "OPEN") throw new TripNotOpenError();
          // Al llegar la fecha del viaje (día calendario Argentina) ya no entra
          // carga nueva, aunque el estado siga OPEN. El estado no se toca: la
          // transición a IN_TRANSIT sigue siendo del transportista.
          if (!isTripDateAvailable(trip.date)) throw new TripDatePassedError();

          const used = activeVolume(trip.cargoItems);
          const remaining = trip.capacityTotal - used;
          if (trip.capacityTotal <= 0 || data.volume > remaining) {
            throw new NotEnoughCapacityError();
          }

          const priceShare = new Prisma.Decimal(trip.price)
            .mul(data.volume)
            .div(trip.capacityTotal)
            .toDecimalPlaces(2);

          // la seña sale de esta carga (no del viaje entero): cada empresa deja
          // su parte para que el transportista no le arme el espacio al aire.
          const depositAmount = priceShare
            .mul(trip.depositPercent)
            .div(100)
            .toDecimalPlaces(2);

          // geocodificar el pickup (best-effort: si falla, lat/lng quedan null)
          const pickupCoords = await geocode(data.pickupAddress);

          // validar distancia del pickup al trayecto del viaje (si tenemos coordenadas y geometría)
          if (pickupCoords) {
            const routeGeometry = await getTripRouteGeometry(tripId);
            if (routeGeometry && routeGeometry.length >= 2) {
              const pickupPoint = point([pickupCoords.lng, pickupCoords.lat]);
              const routeLine = lineString(routeGeometry);
              const distanceKm = pointToLineDistance(pickupPoint, routeLine, { units: "kilometers" });
              if (distanceKm > MAX_STOP_DISTANCE_FROM_ROUTE_KM) {
                throw new AppError(
                  `la parada está a ${distanceKm.toFixed(1)} km del trayecto, fuera del límite permitido (${MAX_STOP_DISTANCE_FROM_ROUTE_KM} km)`,
                  400,
                  "STOP_TOO_FAR_FROM_ROUTE"
                );
              }
            } else {
              console.warn(
                "[addCargoItem] no se pudo obtener geometría del trayecto (OSRM falló o no hay puntos); se omite validación de distancia para pickup:",
                data.pickupAddress
              );
            }
          }

          // trackingCode: TP-{ultimos4TripId}-C{n} donde n es el orden dentro del viaje
          const cargoIndex = trip.cargoItems.length + 1;
          const trackingCode = generateTrackingCode(tripId, cargoIndex);

          const item = await tx.cargoItem.create({
            data: {
              tripId,
              companyId,
              description: data.description,
              volume: data.volume,
              priceShare,
              depositAmount,
              pickupAddress: data.pickupAddress,
              pickupLat: pickupCoords?.lat ?? null,
              pickupLng: pickupCoords?.lng ?? null,
              trackingCode,
            },
          });

          // el pago de la seña nace junto con la carga: hasta que la empresa lo
          // pague (la preferencia de Mercado Pago se genera al tocar "pagar"),
          // la reserva tiene 24hs de plazo.
          const depositPayment = await tx.payment.create({
            data: { cargoItemId: item.id, amount: depositAmount, type: "DEPOSIT" },
          });

          const newUsed = used + data.volume;
          if (newUsed >= trip.capacityTotal) {
            await tx.trip.update({
              where: { id: tripId },
              data: { status: "FULL" },
            });
          }

          // el aviso al transportista se arma acá (dentro de la transacción)
          // pero se manda recién después del commit.
          return {
            response: toCargoItemResponse({ ...item, payments: [depositPayment] }),
            email: {
              carrierId: trip.carrierId,
              trip: { id: trip.id, origin: trip.origin, destination: trip.destination },
              description: item.description,
              volume: item.volume,
              remaining: trip.capacityTotal - newUsed,
              capacityTotal: trip.capacityTotal,
            },
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        }
      );
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
        continue;
      }
      // trackingCode unique constraint violation (P2002)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // reintentar generando un nuevo código (poco probable pero posible en concurrencia extrema)
        continue;
      }
      throw err;
    }
  }

  if (!created) throw lastError;

  // best-effort: si el aviso falla, la carga ya está creada igual.
  await bestEffortNotify(() => {
    const data = created!.email;
    return notifyUsers([data.carrierId], {
      type: "CARGO_ADDED",
      title: `nueva carga en tu viaje ${data.trip.origin} → ${data.trip.destination}`,
      body: `una empresa sumó ${data.description.toLowerCase()} (${data.volume} m³) a tu viaje.`,
      tripId: data.trip.id,
      email: (user) => cargoAddedEmail({ ...data, carrier: user }),
    });
  });
  return created.response;
}

export function toReviewResponse(review: {
  id: string;
  tripId: string;
  fromUserId: string;
  toUserId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  fromUser?: { name: string } | null;
  toUser?: { name: string } | null;
}) {
  return {
    id: review.id,
    tripId: review.tripId,
    fromUserId: review.fromUserId,
    toUserId: review.toUserId,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
    fromName: review.fromUser?.name ?? "",
    toName: review.toUser?.name ?? "",
  };
}

/**
 * Calificación de una parte del viaje a la otra. Solo al completar el viaje,
 * solo para quienes participaron (el fletero o una empresa con carga) y una
 * sola vez por dirección.
 */
export async function createReview(
  tripId: string,
  fromUserId: string,
  input: CreateReviewInput
) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      status: true,
      carrierId: true,
      cargoItems: {
        where: { status: { not: "CANCELLED" } },
        select: { companyId: true },
      },
    },
  });
  if (!trip) throw new TripNotFoundError();
  if (trip.status !== "COMPLETED") throw new TripNotCompletedError();

  const companyIds = [...new Set(trip.cargoItems.map((item) => item.companyId))];
  const isCarrier = trip.carrierId === fromUserId;
  const isCompany = companyIds.includes(fromUserId);
  if (!isCarrier && !isCompany) {
    throw new AppError(
      "solo podemás calificar a alguien con quien compartiste un viaje",
      403,
      "FORBIDDEN"
    );
  }

  const toUserId = resolveReviewTarget(input.toUserId, {
    isCarrier,
    companyIds,
    carrierId: trip.carrierId,
  });

  const existing = await prisma.review.findUnique({
    where: { tripId_fromUserId_toUserId: { tripId, fromUserId, toUserId } },
  });
  if (existing) throw new AlreadyReviewedError();

  const review = await prisma.review.create({
    data: {
      tripId,
      fromUserId,
      toUserId,
      rating: input.rating,
      comment: input.comment && input.comment.length > 0 ? input.comment : null,
    },
    include: {
      fromUser: { select: { name: true } },
      toUser: { select: { name: true } },
    },
  });
  return toReviewResponse(review);
}

function resolveReviewTarget(
  requestedToUserId: string | undefined,
  ctx: { isCarrier: boolean; companyIds: string[]; carrierId: string }
): string {
  if (requestedToUserId !== undefined) {
    const valid = ctx.isCarrier
      ? ctx.companyIds.includes(requestedToUserId)
      : requestedToUserId === ctx.carrierId;
    if (!valid) {
      throw new AppError(
        "esa persona no participó de este viaje como contraparte tuya",
        403,
        "FORBIDDEN"
      );
    }
    return requestedToUserId;
  }

  if (ctx.isCarrier) {
    if (ctx.companyIds.length > 1) throw new ReviewTargetRequiredError();
    const [onlyCompany] = ctx.companyIds;
    if (!onlyCompany) throw new ReviewTargetRequiredError();
    return onlyCompany;
  }

  return ctx.carrierId;
}

/**
 * Mensajería del viaje: solo hablan el transportista del viaje y las empresas
 * con carga en él. Cualquier otro usuario no existe para esta conversación.
 */
type TripParticipants = {
  carrier: { id: string; name: string };
  companies: { id: string; name: string }[];
  companyIds: string[];
};

async function resolveParticipants(tripId: string): Promise<TripParticipants> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      carrier: { select: { id: true, name: true } },
      cargoItems: { select: { company: { select: { id: true, name: true } } } },
    },
  });
  if (!trip) throw new TripNotFoundError();

  const companies = [
    ...new Map(trip.cargoItems.map((item) => [item.company.id, item.company])).values(),
  ];
  return {
    carrier: trip.carrier,
    companies,
    companyIds: companies.map((company) => company.id),
  };
}

function assertParticipant(
  participants: TripParticipants,
  userId: string,
  message = "solo podés escribir en los viajes donde tenés carga o sos el transportista"
) {
  const isCarrier = participants.carrier.id === userId;
  if (!isCarrier && !participants.companyIds.includes(userId)) {
    throw new AppError(message, 403, "FORBIDDEN");
  }
}

export function toMessageResponse(message: {
  id: string;
  tripId: string;
  fromUserId: string;
  toUserId: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
  fromUser?: { name: string } | null;
  toUser?: { name: string } | null;
}) {
  return {
    id: message.id,
    tripId: message.tripId,
    fromUserId: message.fromUserId,
    toUserId: message.toUserId,
    body: message.body,
    createdAt: message.createdAt,
    readAt: message.readAt,
    fromName: message.fromUser?.name ?? "",
    toName: message.toUser?.name ?? "",
  };
}

export async function listTripMessages(tripId: string, userId: string) {
  const participants = await resolveParticipants(tripId);
  assertParticipant(participants, userId);

  const messages = await prisma.message.findMany({
    where: { tripId },
    orderBy: { createdAt: "asc" },
    include: {
      fromUser: { select: { name: true } },
      toUser: { select: { name: true } },
    },
  });

  return {
    messages: messages.map(toMessageResponse),
    // para el selector del fletero cuando hay más de una empresa con carga
    participants: {
      carrier: participants.carrier,
      companies: participants.companies,
    },
  };
}

export async function createTripMessage(
  tripId: string,
  fromUserId: string,
  input: CreateMessageInput
) {
  const participants = await resolveParticipants(tripId);
  assertParticipant(participants, fromUserId);

  const targetIsCarrier = participants.carrier.id === input.toUserId;
  const targetIsCompany = participants.companyIds.includes(input.toUserId);
  if (!targetIsCarrier && !targetIsCompany) {
    throw new AppError(
      "esa persona no participa de este viaje",
      403,
      "NOT_A_PARTICIPANT"
    );
  }
  if (input.toUserId === fromUserId) {
    throw new AppError(
      "no te podés mandar un mensaje a vos mismo",
      400,
      "INVALID_TARGET"
    );
  }

  const message = await prisma.message.create({
    data: {
      tripId,
      fromUserId,
      toUserId: input.toUserId,
      // el schema ya trimmea; el trim extra evita guardar espacios sueltos.
      body: input.body.trim(),
    },
    include: {
      fromUser: { select: { name: true } },
      toUser: { select: { name: true } },
    },
  });

  // el chat ya tiene su propio "no leídos", así que el aviso no manda el texto
  // entero: es un nudge para que la persona mire la conversación.
  const preview = input.body.trim();
  await bestEffortNotify(() =>
    notifyUsers([input.toUserId], {
      type: "MESSAGE",
      title: `${message.fromUser.name} te escribió`,
      body: preview.length > 80 ? `${preview.slice(0, 80)}…` : preview,
      tripId,
    })
  );

  return toMessageResponse(message);
}

/** marca como leídos solo los mensajes dirigidos a quien está logueado */
export async function markTripMessagesRead(tripId: string, userId: string) {
  const participants = await resolveParticipants(tripId);
  assertParticipant(participants, userId);

  const { count } = await prisma.message.updateMany({
    where: { tripId, toUserId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: count };
}

/**
 * Remito/manifiesto del viaje en PDF. Solo lo pueden pedir el transportista
 * del viaje y las empresas con carga en él.
 */
export async function getTripManifest(
  tripId: string,
  userId: string
): Promise<{ pdf: Buffer; fileName: string }> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      origin: true,
      destination: true,
      date: true,
      departureTime: true,
      truckType: true,
      capacityTotal: true,
      price: true,
      status: true,
      carrierId: true,
      carrier: { select: { name: true } },
      cargoItems: {
        select: {
          status: true,
          description: true,
          volume: true,
          priceShare: true,
          company: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!trip) throw new TripNotFoundError();

  const isCarrier = trip.carrierId === userId;
  const isCompany = trip.cargoItems.some(
    (item) => item.company.id === userId && isActiveCargo(item)
  );
  if (!isCarrier && !isCompany) {
    throw new AppError(
      "solo podés descargar el manifiesto si sos el transportista o tenés carga en el viaje",
      403,
      "FORBIDDEN"
    );
  }

  const manifest: ManifestTrip = {
    id: trip.id,
    origin: trip.origin,
    destination: trip.destination,
    date: trip.date,
    departureTime: trip.departureTime,
    truckType: trip.truckType,
    capacityTotal: trip.capacityTotal,
    price: Number(trip.price),
    status: trip.status,
    carrierName: trip.carrier.name,
    // las cargas retiradas no van al remito: es el documento de lo que viaja.
    cargoItems: trip.cargoItems.filter(isActiveCargo).map((item) => ({
      description: item.description,
      volume: item.volume,
      priceShare: Number(item.priceShare),
      companyName: item.company.name,
    })),
  };

  return { pdf: await renderManifestPdf(manifest), fileName: manifestFileName(manifest) };
}

/**
 * Tracking GPS del viaje en tránsito. El transportista comparte la posición
 * desde el navegador; las empresas con carga en el viaje la siguen en un mapa.
 *
 * Solo tiene sentido con el viaje en tránsito: trackear un viaje que no arrancó
 * o que ya terminó no le sirve a nadie, así que lo bloqueamos con 403.
 */
// desempate por id: dos posiciones pueden caer en el mismo milisegundo y
// queremos que "la última" sea siempre la misma.
const LOCATION_ASC = [{ recordedAt: "asc" as const }, { id: "asc" as const }];

export function toLocationResponse(location: {
  id: string;
  lat: number;
  lng: number;
  recordedAt: Date;
}) {
  return {
    id: location.id,
    lat: location.lat,
    lng: location.lng,
    recordedAt: location.recordedAt,
  };
}

export async function recordTripLocation(
  tripId: string,
  userId: string,
  input: CreateLocationInput
) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { carrierId: true, status: true },
  });
  if (!trip) throw new TripNotFoundError();
  if (trip.carrierId !== userId) {
    throw new AppError(
      "solo el transportista del viaje puede compartir su ubicación",
      403,
      "FORBIDDEN"
    );
  }
  if (trip.status !== "IN_TRANSIT") throw new TripNotInTransitError();

  const location = await prisma.tripLocation.create({
    data: { tripId, lat: input.lat, lng: input.lng },
  });
  return toLocationResponse(location);
}

export async function getTripLocation(
  tripId: string,
  userId: string,
  options: { history: boolean }
) {
  // mismo chequeo que la mensajería: el transportista del viaje y las empresas
  // con carga en él.
  const participants = await resolveParticipants(tripId);
  assertParticipant(
    participants,
    userId,
    "solo podés ver la ubicación de los viajes donde tenés carga o sos el transportista"
  );

  if (options.history) {
    const track = await prisma.tripLocation.findMany({
      where: { tripId },
      orderBy: LOCATION_ASC,
    });
    const last = track.at(-1);
    return {
      location: last ? toLocationResponse(last) : null,
      track: track.map(toLocationResponse),
    };
  }

  const latest = await prisma.tripLocation.findFirst({
    where: { tripId },
    orderBy: LOCATION_ASC,
  });
  return { location: latest ? toLocationResponse(latest) : null };
}

/**
 * Paradas ordenadas del viaje (pickups). Devuelve la lista final combinando
 * stopOrder manual y proyección automática sobre la ruta origen→destino.
 * Solo para participantes del viaje (carrier o empresas con carga).
 */
export type StopItem = {
  cargoItemId: string;
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  trackingCode: string;
  description: string;
  volume: number;
  status: string;
  stopOrder: number;
};

export async function getTripStops(tripId: string, userId: string): Promise<StopItem[]> {
  const participants = await resolveParticipants(tripId);
  assertParticipant(participants, userId);

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      originLat: true,
      originLng: true,
      destLat: true,
      destLng: true,
      cargoItems: {
        where: { status: { not: "CANCELLED" } },
        select: {
          id: true,
          pickupAddress: true,
          pickupLat: true,
          pickupLng: true,
          trackingCode: true,
          description: true,
          volume: true,
          status: true,
          stopOrder: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!trip) throw new TripNotFoundError();

  const order = calculateStopOrder(
    {
      originLat: trip.originLat,
      originLng: trip.originLng,
      destLat: trip.destLat,
      destLng: trip.destLng,
    },
    trip.cargoItems.map((c) => ({
      id: c.id,
      pickupLat: c.pickupLat,
      pickupLng: c.pickupLng,
      stopOrder: c.stopOrder,
    }))
  );

  return trip.cargoItems
    .map((item) => ({
      cargoItemId: item.id,
      pickupAddress: item.pickupAddress,
      pickupLat: item.pickupLat,
      pickupLng: item.pickupLng,
      trackingCode: item.trackingCode,
      description: item.description,
      volume: item.volume,
      status: item.status,
      stopOrder: order.get(item.id) ?? 0,
    }))
    .sort((a, b) => a.stopOrder - b.stopOrder);
}

/**
 * Reordena las paradas manualmente. Solo el transportista dueño del viaje.
 * Body: array de { cargoItemId, order }.
 */
export async function reorderTripStops(
  tripId: string,
  carrierId: string,
  items: { cargoItemId: string; order: number }[]
): Promise<StopItem[]> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      carrierId: true,
      originLat: true,
      originLng: true,
      destLat: true,
      destLng: true,
    },
  });
  if (!trip) throw new TripNotFoundError();
  if (trip.carrierId !== carrierId) {
    throw new AppError(
      "solo el transportista del viaje puede reordenar las paradas",
      403,
      "FORBIDDEN"
    );
  }

  // validar que todos los cargoItemId pertenecen a este viaje y no están cancelados
  const cargoItems = await prisma.cargoItem.findMany({
    where: {
      id: { in: items.map((i) => i.cargoItemId) },
      tripId,
      status: { not: "CANCELLED" },
    },
    select: { id: true },
  });
  if (cargoItems.length !== items.length) {
    throw new AppError(
      "uno o más IDs de carga no pertenecen a este viaje o están cancelados",
      400,
      "INVALID_CARGO_ITEMS"
    );
  }

  // actualizar stopOrder en transacción
  await prisma.$transaction(
    items.map((item) =>
      prisma.cargoItem.update({
        where: { id: item.cargoItemId },
        data: { stopOrder: item.order },
      })
    )
  );

  // devolver lista ordenada actualizada
  return getTripStops(tripId, carrierId);
}

// --- ruta del viaje (mapa) -------------------------------------------------

export type RoutePointKind = "DEPARTURE" | "PICKUP" | "DESTINATION";

export type RoutePoint = {
  /** 1-based, correlativo sobre los puntos que sí tienen coordenadas */
  order: number;
  kind: RoutePointKind;
  /** texto corto para el tooltip del marker */
  label: string;
  /** la dirección tal como la escribió el usuario */
  address: string;
  lat: number;
  lng: number;
  cargoItemId: string | null;
  trackingCode: string | null;
};

export type TripRoute = {
  tripId: string;
  /** true si la partida es el punto exacto (departureAddress) y no el origin */
  departureIsExact: boolean;
  points: RoutePoint[];
  /**
   * true cuando algún punto del recorrido quedó fuera por no tener
   * coordenadas (geocode caído). El mapa dibuja lo que hay; no es un error.
   */
  incomplete: boolean;
};

type RouteCandidate = Omit<RoutePoint, "order">;

/**
 * El recorrido completo del viaje, en el orden en que el camión lo recorre:
 * punto exacto de partida (o el origin general si el fletero no indicó uno),
 * cada pickup de carga viva en su stopOrder, y el destino.
 *
 * Sin auth: el mapa del viaje es público, como el resto de /trips/:id.
 *
 * Los puntos sin coordenadas quedan afuera (no se pueden dibujar) y
 * `incomplete` avisale al cliente que drew una versión recortada.
 */
export async function getTripRoute(tripId: string): Promise<TripRoute> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      origin: true,
      destination: true,
      originLat: true,
      originLng: true,
      destLat: true,
      destLng: true,
      departureAddress: true,
      departureLat: true,
      departureLng: true,
      cargoItems: {
        where: { status: { not: "CANCELLED" } },
        select: {
          id: true,
          pickupAddress: true,
          pickupLat: true,
          pickupLng: true,
          trackingCode: true,
          description: true,
          stopOrder: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!trip) throw new TripNotFoundError();

  // el stopOrder se calcula con la línea origin→destino (Fase 14C): el
  // departureAddress es un refinamiento del punto de partida, no cambia el
  // criterio con el que ya está familiarizado el fletero.
  const order = calculateStopOrder(
    {
      originLat: trip.originLat,
      originLng: trip.originLng,
      destLat: trip.destLat,
      destLng: trip.destLng,
    },
    trip.cargoItems.map((c) => ({
      id: c.id,
      pickupLat: c.pickupLat,
      pickupLng: c.pickupLng,
      stopOrder: c.stopOrder,
    }))
  );

  const candidates: RouteCandidate[] = [];

  // partida: el punto exacto si se pudo geocodificar, si no el origin general.
  // (puede no tener ninguna de las dos: el viaje se creó con geocode caído)
  const hasExactDeparture =
    trip.departureLat !== null && trip.departureLng !== null;
  if (hasExactDeparture) {
    candidates.push({
      kind: "DEPARTURE",
      label: "salida",
      address: trip.departureAddress ?? trip.origin,
      lat: trip.departureLat as number,
      lng: trip.departureLng as number,
      cargoItemId: null,
      trackingCode: null,
    });
  } else if (trip.originLat !== null && trip.originLng !== null) {
    candidates.push({
      kind: "DEPARTURE",
      label: "salida",
      address: trip.origin,
      lat: trip.originLat,
      lng: trip.originLng,
      cargoItemId: null,
      trackingCode: null,
    });
  }

  const stops: RouteCandidate[] = trip.cargoItems
    .map((c) => ({
      kind: "PICKUP" as const,
      label: `retiro ${c.description}`,
      address: c.pickupAddress,
      lat: c.pickupLat as number,
      lng: c.pickupLng as number,
      cargoItemId: c.id,
      trackingCode: c.trackingCode,
    }))
    .filter((s) => s.lat !== null && s.lat !== undefined && s.lng !== null && s.lng !== undefined)
    .sort(
      (a, b) => (order.get(a.cargoItemId as string) ?? 0) - (order.get(b.cargoItemId as string) ?? 0)
    );

  candidates.push(...stops);

  if (trip.destLat !== null && trip.destLng !== null) {
    candidates.push({
      kind: "DESTINATION",
      label: "destino",
      address: trip.destination,
      lat: trip.destLat,
      lng: trip.destLng,
      cargoItemId: null,
      trackingCode: null,
    });
  }

  const points: RoutePoint[] = candidates.map((point, index) => ({
    ...point,
    order: index + 1,
  }));

  const drawn = points.length;
  const expected = (hasExactDeparture || trip.originLat !== null ? 1 : 0) + trip.cargoItems.length + (trip.destLat !== null ? 1 : 0);

  return {
    tripId,
    departureIsExact: hasExactDeparture,
    points,
    incomplete: drawn < expected,
  };
}

/**
 * Caché en memoria de la geometría por viaje.
 *
 * La clave incluye los propios puntos y el estado del viaje: si una carga entra
 * o se retira, o el fletero cambia el estado, la firma cambia y la geometría se
 * vuelve a pedir. Un viaje que no cambia reutiliza la respuesta en vez de pegarle
 * a OSRM en cada request.
 *
 * Guardamos `null` también (falló): repetir el fetch a OSRM en cada request de
 * un viaje que siempre falla solo gasta llamadas.
 */
const MAX_GEOMETRY_CACHE_ENTRIES = 500;
const routeGeometryCache = new Map<
  string,
  { signature: string; geometry: [number, number][] | null }
>();

function routeSignature(
  route: TripRoute,
  status: string
): string {
  return JSON.stringify([status, route.departureIsExact, route.points.map((p) => [p.lat, p.lng])]);
}

export function clearRouteGeometryCache() {
  routeGeometryCache.clear();
}

export function routeGeometryCacheSize() {
  return routeGeometryCache.size;
}

/**
 * Geometría de la ruta real (calles) del viaje, o null si OSRM no respondió,
 * tardó más de 5s, o el recorrido tiene menos de dos puntos. Nunca throw: el
 * frontend dibuja líneas rectas en ese caso.
 */
export async function getTripRouteGeometry(
  tripId: string
): Promise<[number, number][] | null> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { status: true },
  });
  if (!trip) throw new TripNotFoundError();

  const route = await getTripRoute(tripId);
  if (route.points.length < 2) return null;

  const signature = routeSignature(route, trip.status);
  const cached = routeGeometryCache.get(tripId);
  if (cached && cached.signature === signature) return cached.geometry;

  const geometry = await fetchRouteGeometry(
    route.points.map((p) => ({ lat: p.lat, lng: p.lng }))
  );

  if (routeGeometryCache.size >= MAX_GEOMETRY_CACHE_ENTRIES) {
    const oldest = routeGeometryCache.keys().next().value as string | undefined;
    if (oldest !== undefined) routeGeometryCache.delete(oldest);
  }
  routeGeometryCache.set(tripId, { signature, geometry });

  return geometry;
}

/**
 * Tracking público por trackingCode. Sin auth. Devuelve info limitada:
 * descripción (sin volumen/precio exacto), status, tramo general, fecha estimada.
 * NO expone priceShare, pickupAddress completa, ni datos de la empresa.
 */
export type PublicTracking = {
  trackingCode: string;
  description: string;
  status: string;
  trip: {
    origin: string;
    destination: string;
    date: string;
    departureTime: string | null;
    status: string;
  };
  cargoStatus: string;
};

export async function getPublicTracking(
  trackingCode: string
): Promise<PublicTracking | null> {
  const item = await prisma.cargoItem.findUnique({
    where: { trackingCode },
    include: {
      trip: {
        select: {
          origin: true,
          destination: true,
          date: true,
          departureTime: true,
          status: true,
        },
      },
    },
  });
  if (!item) return null;

  return {
    trackingCode: item.trackingCode,
    description: item.description,
    status: item.status,
    trip: {
      origin: item.trip.origin,
      destination: item.trip.destination,
      date: item.trip.date.toISOString(),
      departureTime: item.trip.departureTime,
      status: item.trip.status,
    },
    cargoStatus: item.status,
  };
}

/**
 * Processor de reembolsos (patrón outbox).
 *
 * Toma la RefundRequest PENDING del cargo indicado, llama a refundPayment
 * (idempotente: si MP ya devolvió, no duplica), y actualiza:
 * - RefundRequest: status -> COMPLETED (o FAILED si error irrecuperable)
 * - Payment: refundedAmount, y status -> REFUNDED si cubrió todo.
 *
 * Si falla la red o MP devuelve error transitorio, incrementa attempts y
 * guarda lastError; la request queda en PENDING para reintento. No lanza:
 * el caller (cancelCargoItem) ya confirmó la cancelación; el reembolso se
 * recupera después.
 */
export async function processRefundRequest(cargoItemId: string): Promise<void> {
  const req = await prisma.refundRequest.findUnique({
    where: { cargoItemId },
  });
  if (!req || req.status !== "PENDING") return; // nada que hacer

  // Marcar PROCESSING para evitar carreras si se llama concurrente
  await prisma.refundRequest.update({
    where: { id: req.id },
    data: { status: "PROCESSING" },
  });

  try {
    const payment = await prisma.payment.findUnique({
      where: { cargoItemId_type: { cargoItemId, type: "DEPOSIT" } },
    });
    if (!payment || payment.status !== "APPROVED" || !payment.mpPaymentId) {
      // no hay pago reembolsable: marcar completado (no hay nada que hacer)
      await prisma.refundRequest.update({
        where: { id: req.id },
        data: { status: "COMPLETED" },
      });
      return;
    }

    const targetAmount = Number(req.targetAmount);
    const refundedAmount = await refundPayment(payment.mpPaymentId, targetAmount);

    // actualizar Payment con lo que MP confirmó
    const fullyRefunded = refundedAmount >= Number(payment.amount);
    await prisma.payment.update({
      where: { id: payment.id },
      data: fullyRefunded
        ? { status: "REFUNDED", refundedAmount }
        : { refundedAmount },
    });

    await prisma.refundRequest.update({
      where: { id: req.id },
      data: { status: "COMPLETED" },
    });
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
    // no re-lanzamos: el caller ya confirmó la cancelación
  }
}

