import { prisma } from "../../lib/prisma.js";
import { Prisma } from "@prisma/client";
import type { PaymentStatus, Role, Trip } from "@prisma/client";
import {
  activeVolume,
  CARRIER_CAN_CHARGE,
  carrierCanCharge,
  isActiveCargo,
  toCargoItemResponse,
  toCargoQuoteResponse,
  toReviewResponse,
  toStopResponse,
  toTripDetailResponse,
  toTripSummary,
  type StopItem,
} from "../../lib/mappers.js";
import { geocode, haversineKm, type LatLng } from "../../lib/geocode.js";
import { fetchRouteGeometry } from "../../lib/routing.js";
import { generateTrackingCode, normalizeTrackingCode } from "../../lib/trackingCode.js";
import { point, lineString, pointToLineDistance } from "@turf/turf";
import { cargoPrice, priceRangeFor, rateFor } from "../../lib/pricing.js";
import {
  departureInstant,
  hoursUntilDeparture,
  quoteCancellation,
  type CancellationQuote,
} from "../../lib/cancellation.js";
import { balanceOf } from "../payments/payments.service.js";
import { processRefundRequest } from "../payments/refunds.service.js";
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
import {
  endOfArgentinaDay,
  isTripDateAvailable,
  startOfArgentinaDay,
} from "../../lib/dates.js";
import {
  AlreadyReviewedError,
  BalanceChargedBackError,
  BalancePendingError,
  CarrierNotVerifiedError,
  CargoItemCancelledError,
  CargoItemNotCancellableError,
  CargoItemNotFoundError,
  InvalidTransitionError,
  NotEnoughCapacityError,
  PaymentInFlightError,
  PaymentRequiredError,
  TripAlreadyStartedError,
  TripDatePassedError,
  TripNotCompletedError,
  TripNotInTransitError,
  TripNotFoundError,
  TripNotOpenError,
  TooManyPendingError,
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
 * Corre una transacción Serializable y la reintenta ante un conflicto de
 * serialización (P2034) o una seña que se movió en el medio
 * (PaymentInFlightError). Si no se resuelve en MAX_RETRIES, sube el último error.
 */
async function retryOnConflict<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
        continue;
      }
      if (err instanceof PaymentInFlightError) continue;
      throw err;
    }
  }
  throw lastError;
}

/**
 * Una reserva de espacio vale 24hs: si en ese plazo la empresa no abonó la
 * seña, el lugar vuelve a estar disponible para otro. La libera el scheduler
 * (ver releaseExpiredReservations y lib/jobs.ts).
 */
const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Una seña que sostiene la reserva: cobrada (APPROVED) o por acreditarse (pago
 * creado en MP y todavía pendiente). Una carga PENDING sin una de estas es una
 * reserva sin seña: vence a las 24 h (`releaseExpiredReservations`) y cuenta
 * para el tope de reservas sin seña (U15).
 */
const DEPOSIT_HOLDS_RESERVATION = {
  type: "DEPOSIT",
  OR: [{ status: "APPROVED" }, { status: "PENDING", mpPaymentId: { not: null } }],
} satisfies Prisma.PaymentWhereInput;

/**
 * U15: reservas sin seña (PENDING sin `DEPOSIT_HOLDS_RESERVATION`) que puede
 * tener una empresa a la vez en viajes que no salieron: en total y en un mismo
 * viaje. Sin tope, una empresa podía tomar el lugar de varios viajes 24 h sin
 * pagar nada.
 */
export const MAX_UNPAID_RESERVATIONS = 3;
export const MAX_UNPAID_RESERVATIONS_PER_TRIP = 1;

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
    // name y code: un error de Prisma trae la consulta y sus parámetros (U6)
    console.error("[notificaciones] falló el aviso, la operación sigue", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
  }
}

/** los importes que se suman (o restan) en un email van redondeados como el backend cobra */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type TripStatusChange = "IN_TRANSIT" | "COMPLETED" | "CANCELLED";

const ALLOWED_TRANSITIONS: Record<TripStatusChange, Trip["status"][]> = {
  IN_TRANSIT: ["OPEN", "FULL"],
  COMPLETED: ["IN_TRANSIT"],
  // D6: el fletero cancela un viaje que todavía no salió. Es final.
  CANCELLED: ["OPEN", "FULL"],
};

export async function listOpenTrips(filters: ListTripsQuery = {}, now: Date = new Date()) {
  // un fletero sin MP no puede cobrar la seña: su viaje no se ofrece
  const where: Prisma.TripWhereInput = { status: "OPEN", carrier: CARRIER_CAN_CHARGE };

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
  // días completos en Argentina, como el día de un viaje (lib/dates.ts)
  if (filters.dateFrom) {
    dateFilter.gte = startOfArgentinaDay(filters.dateFrom);
  }
  if (filters.dateTo) {
    dateFilter.lte = endOfArgentinaDay(filters.dateTo);
  }
  where.date = dateFilter;
  if (filters.features && filters.features.length > 0) {
    where.features = { hasEvery: filters.features };
  }

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
 * Una reserva vencida: PENDING desde antes del corte y sin una seña que la
 * sostenga. La seña aprobada reserva el lugar (la empresa todavía puede
 * confirmar o retirar) y la seña por acreditarse también (el pago ya existe en
 * MP y todavía está pendiente: si se aprueba, la carga tiene que seguir viva).
 * Una seña rechazada, o una preference sin pago en MP, no sostienen nada.
 */
function isExpiredReservation(
  item: {
    status: string;
    createdAt: Date;
    payments: { type: string; status: PaymentStatus; mpPaymentId: string | null }[];
  },
  cutoff: Date
): boolean {
  if (item.status !== "PENDING" || item.createdAt >= cutoff) return false;
  const deposit = item.payments.find((p) => p.type === "DEPOSIT");
  if (deposit?.status === "APPROVED") return false;
  if (deposit?.status === "PENDING" && deposit.mpPaymentId !== null) return false;
  return true;
}

/**
 * Reserva vencida: una carga PENDING que no pagó su seña dentro de las 24hs
 * libera el lugar. Lo corre el scheduler cada minuto (lib/jobs.ts); ya no se
 * hace al listar ni al mirar un viaje.
 *
 * Solo se liberan cargas de viajes que todavía no salieron (OPEN/FULL): con el
 * camión en camino la reserva dejó de ser un espacio en un viaje futuro.
 * No avisamos a la empresa: es la consecuencia de no pagar, y el
 * transportista igual ve el lugar libre.
 *
 * La búsqueda solo elige los viajes. Cada viaje va en su propia TX
 * Serializable que relee el viaje con sus cargas y pagos, cancela las vencidas
 * con `cancelCargoForTrip` (fee 0, con CAS sobre la seña: si el webhook la
 * aprobó en el medio, la TX se reintenta y la reserva se mantiene) y, si
 * quedó lugar, pasa el viaje de FULL a OPEN en la misma TX. Un `addCargoItem`
 * concurrente choca por serialización (P2034) y uno de los dos se reintenta
 * con lo que hay ahora.
 *
 * Un viaje que falla no corta la corrida: se loguea y lo retoma la próxima.
 */
export async function releaseExpiredReservations(
  now: Date = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - RESERVATION_TTL_MS);
  const candidates = await prisma.cargoItem.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: cutoff },
      trip: { status: { in: ["OPEN", "FULL"] } },
      payments: { none: DEPOSIT_HOLDS_RESERVATION },
    },
    select: { tripId: true },
    distinct: ["tripId"],
  });

  let released = 0;
  for (const { tripId } of candidates) {
    try {
      released += await releaseTripReservations(tripId, cutoff, now);
    } catch (err) {
      console.error("[reservas] no se pudieron liberar las reservas de un viaje", {
        name: err instanceof Error ? err.name : typeof err,
        code: err instanceof AppError ? err.code : undefined,
      });
    }
  }
  return released;
}

async function releaseTripReservations(
  tripId: string,
  cutoff: Date,
  now: Date
): Promise<number> {
  return retryOnConflict(() =>
    prisma.$transaction(
      async (tx) => {
        const trip = await tx.trip.findUnique({
          where: { id: tripId },
          include: { cargoItems: { include: { payments: true } } },
        });
        if (!trip || (trip.status !== "OPEN" && trip.status !== "FULL")) return 0;

        const expired = trip.cargoItems.filter((item) =>
          isExpiredReservation(item, cutoff)
        );
        if (expired.length === 0) return 0;

        await cancelCargoForTrip(tx, expired, now);

        // el lugar vuelve al viaje, con las cargas que se leyeron en esta TX
        const expiredIds = new Set(expired.map((item) => item.id));
        const used = activeVolume(
          trip.cargoItems.filter((item) => !expiredIds.has(item.id))
        );
        if (trip.status === "FULL" && used < trip.capacityTotal) {
          await tx.trip.update({ where: { id: tripId }, data: { status: "OPEN" } });
        }
        return expired.length;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000 }
    )
  );
}

/** detalle del viaje según quién lo mira (U7, ver toTripDetailResponse) */
export async function getTripById(id: string, viewer: { id: string } | null) {
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      cargoItems: {
        include: { payments: true, company: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
      carrier: { select: { name: true } },
      reviews: {
        orderBy: { createdAt: "desc" },
        include: { toUser: { select: { name: true } } },
      },
    },
  });
  if (!trip) throw new TripNotFoundError();

  return toTripDetailResponse(trip, viewer);
}

/**
 * Precio sugerido + rango de referencia (±15 %) para un viaje que aún no existe.
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
  // más de 5.000 km: sin sugerencia (D5), pero con la distancia para que el
  // client explique por qué
  const range = priceRangeFor(input.truckType, distanceKm) ?? {
    distanceKm,
    suggestedPrice: null,
    minPrice: null,
    maxPrice: null,
  };
  return { ...base, geocoded: true, ...range };
}

/**
 * Cuánto pagaría una empresa por `volume` m³ en este viaje: precio de la carga,
 * seña y saldo. Es la misma fórmula que cobra `addCargoItem` (`cargoPrice`),
 * así el resumen antes de reservar no puede prometer otro número. No mira la
 * capacidad libre ni el estado del viaje: eso lo decide la reserva.
 */
export async function quoteCargoPrice(tripId: string, volume: number) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { price: true, capacityTotal: true, depositPercent: true },
  });
  if (!trip) throw new TripNotFoundError();
  return toCargoQuoteResponse(cargoPrice(trip, volume), {
    volume,
    depositPercent: trip.depositPercent,
  });
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
  departureTime?: string | null | undefined;
}) {
  return quoteCancellation(
    input.depositAmount,
    hoursUntilDeparture({ date: input.tripDate, departureTime: input.departureTime })
  );
}

/** desde la salida, con el viaje en camino o con saldo: no hay retiro */
const CLOSED_QUOTE: CancellationQuote = {
  window: "CLOSED",
  cancellable: false,
  refundAmount: 0,
  feeAmount: 0,
};

/**
 * La seña que de verdad entró y se puede devolver: APPROVED y con el pago de MP
 * asentado. Una seña sin pagar, por acreditarse o APPROVED sin `mpPaymentId` no
 * retiene nada: ni se devuelve ni hay fee.
 */
function paidDepositOf<
  P extends { type: string; status: PaymentStatus; mpPaymentId: string | null },
>(payments: P[]): P | null {
  const deposit = payments.find((p) => p.type === "DEPOSIT");
  return deposit?.status === "APPROVED" && deposit.mpPaymentId !== null ? deposit : null;
}

/**
 * Lo que pasaría si la empresa retirara esta carga ahora. Es la única cuenta:
 * la usan el retiro (`cancelCargoItem`) y la cotización por carga (U21), así
 * que lo que se le muestra es lo que se hace.
 *
 * - CLOSED si el viaje ya no está OPEN/FULL, si llegó la salida (contra día +
 *   hora en ART, U11) o si la carga tiene saldo (el saldo nace al salir).
 * - Si la seña no se cobró, la ventana es la real pero sin montos: no hay nada
 *   que devolver ni que retener (U21).
 */
function cargoCancellationQuote(
  item: {
    depositAmount: Prisma.Decimal;
    payments: { type: string; status: PaymentStatus; mpPaymentId: string | null }[];
  },
  trip: { status: Trip["status"]; date: Date; departureTime: string | null },
  now: Date = new Date()
): CancellationQuote {
  if (trip.status !== "OPEN" && trip.status !== "FULL") return CLOSED_QUOTE;
  if (item.payments.some((p) => p.type === "BALANCE")) return CLOSED_QUOTE;
  const quote = quoteCancellation(
    Number(item.depositAmount),
    hoursUntilDeparture(trip, now)
  );
  if (!quote.cancellable) return CLOSED_QUOTE;
  if (!paidDepositOf(item.payments)) return { ...quote, refundAmount: 0, feeAmount: 0 };
  return quote;
}

/**
 * U21: cuánto se le devolvería y cuánto se retendría a la empresa si retirara
 * su carga ahora, con lo que de verdad pagó de seña. Solo la empresa dueña.
 * No toca nada: el retiro real vuelve a leer todo dentro de su TX.
 */
export async function getCargoCancellationQuote(
  tripId: string,
  cargoItemId: string,
  companyId: string
): Promise<CancellationQuote> {
  const item = await prisma.cargoItem.findUnique({
    where: { id: cargoItemId },
    include: { payments: true },
  });
  if (!item || item.tripId !== tripId) throw new CargoItemNotFoundError();
  if (item.companyId !== companyId) {
    throw new AppError(
      "solo podés consultar el retiro de una carga que sumaste vos",
      403,
      "FORBIDDEN"
    );
  }
  if (item.status === "CANCELLED") throw new CargoItemNotCancellableError();

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { status: true, date: true, departureTime: true },
  });
  if (!trip) throw new TripNotFoundError();
  return cargoCancellationQuote(item, trip);
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

  // El precio no se valida contra la sugerencia (D5 = b): la sugerencia
  // depende de un geocode best-effort, así que es una referencia que el client
  // muestra con un aviso fuera de ±15 %, no un límite.

  const trip = await prisma.trip.create({
    data: {
      carrierId,
      origin: data.origin,
      destination: data.destination,
      departureAddress: data.departureAddress ?? null,
      date: data.date,
      departureTime: data.departureTime,
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
  cancelled: CancelledByTrip[];
};

/** una carga que cancela el viaje (no la empresa), con lo que se le devuelve */
type CancelledByTrip = {
  cargoItemId: string;
  companyId: string;
  description: string;
  /** la seña cobrada que vuelve entera por el outbox; 0 si no había seña cobrada */
  refundAmount: number;
};

type CargoForTripCancellation = {
  id: string;
  companyId: string;
  description: string;
  depositAmount: Prisma.Decimal;
  payments: {
    id: string;
    type: string;
    status: PaymentStatus;
    mpPaymentId: string | null;
  }[];
};

/**
 * Cancela, dentro de la TX del viaje, cargas que la empresa no retiró: las
 * PENDING al salir el viaje (D3) y, en D6, las activas de un viaje cancelado.
 * La cancelación no es de la empresa, así que no hay penalidad: la seña cobrada
 * vuelve entera por el outbox (RefundRequest por `depositAmount`, congelado al
 * reservar) y el fee queda en 0.
 *
 * Igual que `cancelCargoItem`, escribe la fila de la seña con un CAS sobre el
 * estado leído: si el webhook la aprobó en el medio, PaymentInFlightError y el
 * llamador reintenta la TX, que ve la seña APPROVED y encola la devolución. Una
 * seña todavía por acreditarse no se devuelve acá: si MP la aprueba después, el
 * webhook ve la carga CANCELLED con fee 0 y la devuelve entera
 * (`refundIfCancelled`).
 */
async function cancelCargoForTrip(
  tx: Prisma.TransactionClient,
  items: CargoForTripCancellation[],
  now: Date
): Promise<CancelledByTrip[]> {
  const cancelled: CancelledByTrip[] = [];
  for (const item of items) {
    const deposit = item.payments.find((p) => p.type === "DEPOSIT");
    if (deposit) {
      const held = await tx.payment.updateMany({
        where: { id: deposit.id, status: deposit.status },
        data: { updatedAt: now },
      });
      if (held.count === 0) {
        throw new PaymentInFlightError(
          "una seña se está acreditando en este momento: probá de nuevo en unos segundos"
        );
      }
    }

    const paid = paidDepositOf(item.payments) !== null;
    if (paid) {
      await tx.refundRequest.create({
        data: {
          cargoItemId: item.id,
          targetAmount: new Prisma.Decimal(item.depositAmount),
          status: "PENDING",
        },
      });
    }

    await tx.cargoItem.update({
      where: { id: item.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancellationFeeAmount: new Prisma.Decimal(0),
      },
    });

    cancelled.push({
      cargoItemId: item.id,
      companyId: item.companyId,
      description: item.description,
      refundAmount: paid ? Number(item.depositAmount) : 0,
    });
  }
  return cancelled;
}

/**
 * Aviso de estado del viaje: una vez por empresa, aunque tenga varias cargas
 * (notifyUsers deduplica los ids, pero el aviso se arma con la descripción de
 * la primera carga para no duplicar texto). Solo a las cargas que viajan: una
 * retirada o cancelada no "va en camino" ni "llegó a destino". Los avisos
 * nunca rompen la actualización de estado.
 */
async function notifyTripStatusChange(
  tripId: string,
  trip: { origin: string; destination: string; carrierName: string },
  status: "IN_TRANSIT" | "COMPLETED"
) {
  const items = await prisma.cargoItem.findMany({
    where: { tripId, status: "CONFIRMED" },
    select: { description: true, companyId: true },
    orderBy: { createdAt: "asc" },
  });
  const seenCompanies = new Set<string>();
  for (const item of items) {
    if (seenCompanies.has(item.companyId)) continue;
    seenCompanies.add(item.companyId);
    const statusTrip = {
      id: tripId,
      origin: trip.origin,
      destination: trip.destination,
      carrierName: trip.carrierName,
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
}

/** D6: un viaje que no pasó a IN_TRANSIT 24 h después de la salida se cancela solo */
export const NO_DEPARTURE_CANCEL_AFTER_MS = 24 * 60 * 60 * 1000;

/** cuántos viajes mira la auto-cancelación por corrida */
const AUTO_CANCEL_BATCH = 100;

/**
 * Quién cambia el estado del viaje: el fletero dueño, o el scheduler cuando el
 * viaje no salió a tiempo (D6, auto-cancelación).
 */
type StatusActor = { by: "CARRIER"; carrierId: string } | { by: "NO_DEPARTURE" };

/** desde cuándo un viaje que no salió se cancela solo: 24 h después de la salida */
function noDepartureDeadline(trip: { date: Date; departureTime: string | null }): Date {
  return new Date(
    departureInstant(trip.date, trip.departureTime).getTime() +
      NO_DEPARTURE_CANCEL_AFTER_MS
  );
}

export async function updateTripStatus(
  tripId: string,
  carrierId: string,
  status: TripStatusChange
): Promise<ReturnType<typeof toTripSummary>> {
  const trip = await applyTripStatus(
    tripId,
    status,
    { by: "CARRIER", carrierId },
    new Date()
  );
  // el fletero nunca se saltea: lo que no puede hacer lanza adentro
  if (!trip) throw new InvalidTransitionError();
  return trip;
}

/**
 * D6 (b): cancela los viajes OPEN/FULL que no pasaron a IN_TRANSIT 24 h después
 * de la salida (`departureInstant`; sin hora, las 23:59 ART del día). Lo corre
 * el scheduler (lib/jobs.ts). Es el mismo camino que la cancelación del
 * fletero: las cargas activas se cancelan con `cancelCargoForTrip` y la seña
 * cobrada vuelve entera por el outbox. Cancela también los viajes sin cargas.
 *
 * La búsqueda es un superconjunto (el plazo vence después de `date`, porque la
 * salida nunca es más de un día antes) y el plazo se filtra acá. Dentro de la
 * TX se vuelve a chequear estado y plazo: si el fletero lo pasó a IN_TRANSIT
 * en el medio, no se toca. Un viaje que falla no corta la corrida.
 */
export async function autoCancelUndepartedTrips(now: Date = new Date()): Promise<number> {
  const candidates = await prisma.trip.findMany({
    where: { status: { in: ["OPEN", "FULL"] }, date: { lte: now } },
    select: { id: true, date: true, departureTime: true },
    orderBy: { date: "asc" },
    take: AUTO_CANCEL_BATCH,
  });

  let cancelled = 0;
  for (const trip of candidates) {
    if (noDepartureDeadline(trip) > now) continue;
    try {
      const done = await applyTripStatus(
        trip.id,
        "CANCELLED",
        { by: "NO_DEPARTURE" },
        now
      );
      if (done) cancelled++;
    } catch (err) {
      console.error("[viajes] no se pudo auto-cancelar un viaje que no salió", {
        name: err instanceof Error ? err.name : typeof err,
        code: err instanceof AppError ? err.code : undefined,
      });
    }
  }
  return cancelled;
}

/**
 * Cambia el estado del viaje. Devuelve null solo si el scheduler se saltea el
 * viaje porque al releerlo ya no corresponde cancelarlo (CAS).
 */
async function applyTripStatus(
  tripId: string,
  status: TripStatusChange,
  actor: StatusActor,
  now: Date
): Promise<ReturnType<typeof toTripSummary> | null> {
  // El cambio de estado y los saldos a cobrar se escriben juntos: si el viaje
  // quedara IN_TRANSIT sin sus pagos BALANCE, nadie podría cobrarlos y el
  // balance de la carga quedaría trucho. Lo mismo con las cargas PENDING que se
  // cancelan al salir (D3). Serializable con reintento: la seña de una carga
  // PENDING se puede estar acreditando en el mismo momento.
  const result = await retryOnConflict(() =>
    prisma.$transaction(
      async (tx): Promise<StatusChangeResult | null> => {
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
        if (actor.by === "CARRIER") {
          if (trip.carrierId !== actor.carrierId) {
            throw new AppError(
              "solo el transportista del viaje puede actualizar su estado",
              403,
              "FORBIDDEN"
            );
          }
          if (!ALLOWED_TRANSITIONS[status].includes(trip.status)) {
            throw new InvalidTransitionError();
          }
        } else if (
          // CAS del scheduler: si el viaje ya salió o se canceló, o su salida
          // ya no está vencida, no se toca
          !ALLOWED_TRANSITIONS[status].includes(trip.status) ||
          noDepartureDeadline(trip) > now
        ) {
          return null;
        }

        // completar el viaje es cerrar la cuenta: no se puede hasta que todas
        // las cargas confirmadas tenga su saldo abonado.
        if (status === "COMPLETED") {
          // un saldo con contracargo no se puede volver a cobrar: no es "por
          // pagar", lo resuelve un admin (no hay herramienta todavía, ver L9)
          const chargedBack = trip.cargoItems.filter(
            (item) =>
              item.status === "CONFIRMED" &&
              item.payments.some(
                (p) => p.type === "BALANCE" && p.status === "CHARGED_BACK"
              )
          );
          if (chargedBack.length > 0) {
            throw new BalanceChargedBackError(chargedBack.length);
          }

          const pending = trip.cargoItems.filter(
            (item) => item.status === "CONFIRMED" && !isBalanceSettled(item)
          );
          if (pending.length > 0) throw new BalancePendingError(pending.length);
        }

        // D3: al salir, lo que no se confirmó no viaja. D6: un viaje cancelado
        // no lleva nada (PENDING ni CONFIRMED). Antes del update del viaje, así
        // el resumen que se devuelve ya trae esas cargas CANCELLED.
        const toCancel =
          status === "IN_TRANSIT"
            ? trip.cargoItems.filter((item) => item.status === "PENDING")
            : status === "CANCELLED"
              ? trip.cargoItems.filter(
                  (item) => item.status === "PENDING" || item.status === "CONFIRMED"
                )
              : [];
        const cancelled = await cancelCargoForTrip(tx, toCancel, now);

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
                p.type === "BALANCE" &&
                (p.status === "APPROVED" || p.status === "REFUNDED")
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

        return { trip: toTripSummary(updated), balancesDue, cancelled };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000 }
    )
  );
  if (!result) return null;

  // Aviso de estado del viaje (un viaje cancelado avisa con CARGO_CANCELLED, abajo)
  if (status !== "CANCELLED") await notifyTripStatusChange(tripId, result.trip, status);

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

  // D3 y D6: a cada empresa cuya carga no viaja, qué pasó y qué se le devuelve
  const ruta = `${result.trip.origin} → ${result.trip.destination}`;
  for (const item of result.cancelled) {
    const desc = item.description.toLowerCase();
    const motivo =
      status !== "CANCELLED"
        ? `el viaje salió sin que tu carga ${desc} estuviera confirmada, así que no viaja.`
        : actor.by === "NO_DEPARTURE"
          ? `el viaje no salió dentro de las 24 h posteriores a la salida, así que tu carga ${desc} no viaja.`
          : `${result.trip.carrierName} canceló el viaje, así que tu carga ${desc} no viaja.`;
    const plata =
      item.refundAmount > 0
        ? `te devolvemos la seña entera ($${item.refundAmount}).`
        : "no se cobró la seña; si se llega a acreditar, te la devolvemos entera.";
    await bestEffortNotify(() =>
      notifyUsers([item.companyId], {
        type: "CARGO_CANCELLED",
        title:
          status === "CANCELLED"
            ? `se canceló el viaje: ${ruta}`
            : `tu carga se canceló: ${ruta}`,
        body: `${motivo} ${plata}`,
        tripId,
      })
    );
  }

  // D6 automática: el fletero se entera de que el viaje se canceló sin él.
  // Solo in-app: el email queda para L7.
  if (actor.by === "NO_DEPARTURE") {
    const n = result.cancelled.length;
    const cargas =
      n === 0
        ? "no tenía cargas activas."
        : `${n === 1 ? "se canceló 1 carga" : `se cancelaron ${n} cargas`} y a cada empresa se le devuelve la seña cobrada.`;
    await bestEffortNotify(() =>
      notifyUsers([result.trip.carrierId], {
        type: "TRIP_STATUS_CHANGED",
        title: `se canceló tu viaje: ${ruta}`,
        body: `no pasó a «en tránsito» dentro de las 24 h posteriores a la salida, así que lo cancelamos. ${cargas}`,
        tripId,
        email: false,
      })
    );
  }

  // OUTBOX: las devoluciones ya quedaron encoladas en la TX; si MP falla acá,
  // la RefundRequest queda PENDING y la retoma el worker
  for (const item of result.cancelled) {
    if (item.refundAmount <= 0) continue;
    await processRefundRequest(item.cargoItemId).catch(() => {});
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
  if (item.status === "CANCELLED") throw new CargoItemCancelledError();

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

  // CAS sobre PENDING: la empresa puede retirar la carga entre la lectura y
  // acá, y la confirmación no puede revivir una carga retirada
  let updated;
  try {
    updated = await prisma.cargoItem.update({
      where: { id: cargoItemId, status: "PENDING" },
      data: { status: "CONFIRMED" },
      include: { payments: true },
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")) {
      throw err;
    }
    const current = await prisma.cargoItem.findUnique({
      where: { id: cargoItemId },
      include: { payments: true },
    });
    // la confirmó otro (el transportista y la empresa a la vez): ya está, y el
    // aviso lo manda el que ganó
    if (current?.status === "CONFIRMED") return toCargoItemResponse(current);
    throw new CargoItemCancelledError();
  }

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
 * Retirar una carga que sumó la empresa, PENDING o CONFIRMED, hasta la hora de
 * salida y con el viaje OPEN/FULL (D4: una confirmada se retira con la misma
 * penalidad). Después de la salida, 409 aunque el viaje siga OPEN.
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
          if (item.status === "CANCELLED") throw new CargoItemNotCancellableError();

          const trip = await tx.trip.findUnique({
            where: { id: tripId },
            include: { cargoItems: true },
          });
          if (!trip) throw new TripNotFoundError();
          // CLOSED con el viaje en camino, desde la salida (día + hora en ART,
          // U11) aunque el fletero no haya marcado IN_TRANSIT (si no sale, D6
          // devuelve la seña entera), o con saldo (el saldo nace al salir: la
          // carga ya viajó, y el outbox solo devuelve la seña).
          const quote = cargoCancellationQuote(item, trip);
          if (!quote.cancellable) throw new TripAlreadyStartedError();

          const deposit = item.payments.find((p) => p.type === "DEPOSIT");

          // La seña puede estar en vuelo: el webhook la aprueba con un CAS fuera
          // de esta TX. Escribir la fila ordena las dos cosas. Si el webhook la
          // cambió después de nuestra lectura, Serializable aborta (P2034) o el
          // CAS no encuentra el estado leído, y el reintento ve la seña APPROVED
          // y encola su devolución. Si escribimos primero, el CAS del webhook
          // espera a que commiteemos y su relectura ve la carga CANCELLED.
          if (deposit) {
            const held = await tx.payment.updateMany({
              where: { id: deposit.id, status: deposit.status },
              data: { updatedAt: new Date() },
            });
            if (held.count === 0) throw new PaymentInFlightError();
          }

          // Un fee es plata que se retiene de un pago que REALMENTE entró. Si la
          // empresa nunca pagó la seña (o el pago APPROVED no tiene mpPaymentId y
          // no se puede devolver) la cotización ya trae fee y devolución en 0, en
          // vez de inventar una deuda. El CAS de arriba garantiza que la seña
          // sigue como la leyó la cotización.
          const feeAmount = quote.feeAmount;

          // OUTBOX: si la ventana dice que se devuelve algo de una seña pagada,
          // creamos una RefundRequest en PENDING. El processor (fuera de la TX)
          // llamará a refundPayment y actualizará el Payment cuando termine.
          if (quote.refundAmount > 0) {
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
      if (err instanceof PaymentInFlightError) continue;
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

  // U10: Nominatim (cola de 1 req/s) y OSRM (hasta 5 s) van antes de abrir la
  // TX y una sola vez: con la TX Serializable abierta la estiraban hasta su
  // timeout y la exponían a más conflictos, y cada reintento los repetía.
  // Best-effort: sin coordenadas o sin geometría no se valida la distancia.
  const pickupCoords = await geocode(data.pickupAddress);
  const routeGeometry = pickupCoords ? await getFullRouteGeometry(tripId) : null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      created = await prisma.$transaction(
        async (tx) => {
          const trip = await tx.trip.findUnique({
            where: { id: tripId },
            include: {
              cargoItems: true,
              carrier: { select: { mpUserId: true, mpAccessToken: true } },
            },
          });
          if (!trip) throw new TripNotFoundError();
          if (trip.status !== "OPEN") throw new TripNotOpenError();
          // Al llegar la fecha del viaje (día calendario Argentina) ya no entra
          // carga nueva, aunque el estado siga OPEN. El estado no se toca: la
          // transición a IN_TRANSIT sigue siendo del transportista.
          if (!isTripDateAvailable(trip.date)) throw new TripDatePassedError();
          // sin MP el fletero no puede cobrar la seña: la reserva tomaría el
          // lugar 24 h para nada. Mismo código que la preference.
          if (!carrierCanCharge(trip.carrier)) {
            throw new AppError(
              "este viaje no puede recibir pagos por ahora: el fletero no tiene Mercado Pago conectado",
              409,
              "MP_ACCOUNT_NOT_CONNECTED"
            );
          }

          // U15: el tope se cuenta dentro de la TX Serializable: dos reservas
          // simultáneas de la misma empresa chocan (P2034) y el reintento
          // vuelve a contar con la que ya entró.
          const unpaid = await tx.cargoItem.findMany({
            where: {
              companyId,
              status: "PENDING",
              trip: { status: { in: ["OPEN", "FULL"] } },
              payments: { none: DEPOSIT_HOLDS_RESERVATION },
            },
            select: { tripId: true },
          });
          if (
            unpaid.filter((c) => c.tripId === tripId).length >=
            MAX_UNPAID_RESERVATIONS_PER_TRIP
          ) {
            throw new TooManyPendingError(
              "ya tenés una reserva sin seña en este viaje: pagala o retirala antes de sumar otra carga"
            );
          }
          if (unpaid.length >= MAX_UNPAID_RESERVATIONS) {
            throw new TooManyPendingError(
              `ya tenés ${MAX_UNPAID_RESERVATIONS} reservas sin seña: pagá o retirá alguna antes de reservar otra`
            );
          }

          const used = activeVolume(trip.cargoItems);
          const remaining = trip.capacityTotal - used;
          if (trip.capacityTotal <= 0 || data.volume > remaining) {
            throw new NotEnoughCapacityError();
          }

          // la seña sale de esta carga (no del viaje entero): cada empresa deja
          // su parte para que el transportista no le arme el espacio al aire.
          const { priceShare, depositAmount } = cargoPrice(trip, data.volume);

          // validar distancia del pickup al trayecto del viaje (si tenemos
          // coordenadas y geometría). Es una cuenta pura sobre lo que se buscó
          // antes de la TX; va acá para que los chequeos de estado y capacidad
          // sigan respondiendo primero.
          if (pickupCoords) {
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
              // el viaje y no la dirección de retiro (U6)
              console.warn(
                "[addCargoItem] sin geometría del trayecto (OSRM falló o no hay puntos): se omite validar la distancia del retiro",
                { tripId }
              );
            }
          }

          // aleatorio (U9): el formato viejo se podía adivinar desde el id del viaje
          const trackingCode = generateTrackingCode();

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
        // reintentar generando un nuevo código (con 80 bits, prácticamente imposible)
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

/**
 * Calificación de una empresa al fletero que llevó su carga. Solo al completar
 * el viaje, solo la empresa con carga activa en él y una sola vez.
 *
 * El fletero no califica: el rating de un servicio que él mismo prestó no es un
 * dato que la plataforma pueda usar, y abre la puerta a represalias contra el
 * transportista. Por eso el rol se chequea acá además del `requireRole` de la
 * ruta: la autorización real nunca vive solo en el middleware.
 *
 * El destinatario tampoco se recibe del cliente: es siempre el fletero del viaje,
 * derivado del viaje mismo, así que no hay forma de calificar a un tercero.
 */
export async function createReview(
  tripId: string,
  fromUserId: string,
  fromRole: Role,
  input: CreateReviewInput
) {
  if (fromRole !== "COMPANY") {
    throw new AppError(
      "solo las empresas pueden calificar un viaje",
      403,
      "FORBIDDEN"
    );
  }

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

  const hasCargo = trip.cargoItems.some((item) => item.companyId === fromUserId);
  if (!hasCargo) {
    throw new AppError(
      "solo podés calificar un viaje en el que tengas carga",
      403,
      "FORBIDDEN"
    );
  }

  const toUserId = trip.carrierId;

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
    include: { toUser: { select: { name: true } } },
  });
  return toReviewResponse(review);
}

/**
 * Quiénes tienen algo que ver con el viaje: el transportista y las empresas con
 * carga en él. `companyIds` incluye a las que retiraron todas sus cargas
 * (CANCELLED); `activeCompanyIds` solo a las que tienen alguna carga viva.
 * Ubicación y paradas son solo para las activas (U8): quien retiró su carga no
 * sigue viendo por dónde anda el camión.
 */
type TripParticipants = {
  carrier: { id: string; name: string };
  companies: { id: string; name: string }[];
  companyIds: string[];
  activeCompanyIds: string[];
};

async function resolveParticipants(tripId: string): Promise<TripParticipants> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      carrier: { select: { id: true, name: true } },
      cargoItems: {
        select: { status: true, company: { select: { id: true, name: true } } },
      },
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
    activeCompanyIds: [
      ...new Set(trip.cargoItems.filter(isActiveCargo).map((item) => item.company.id)),
    ],
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

/** como assertParticipant, pero la empresa tiene que tener alguna carga viva */
function assertActiveParticipant(
  participants: TripParticipants,
  userId: string,
  message: string
) {
  const isCarrier = participants.carrier.id === userId;
  if (!isCarrier && !participants.activeCompanyIds.includes(userId)) {
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

/**
 * Qué mensajes ve cada uno (U8): el fletero, los suyos con cada empresa; la
 * empresa, solo su conversación con el fletero. Empresa↔empresa no existe.
 * La empresa que retiró todas sus cargas conserva su conversación (D9): puede
 * necesitar hablar del reembolso.
 */
function conversationWhere(participants: TripParticipants, userId: string) {
  const carrierId = participants.carrier.id;
  if (userId === carrierId) {
    return { OR: [{ fromUserId: userId }, { toUserId: userId }] };
  }
  return {
    OR: [
      { fromUserId: userId, toUserId: carrierId },
      { fromUserId: carrierId, toUserId: userId },
    ],
  };
}

export async function listTripMessages(tripId: string, userId: string) {
  const participants = await resolveParticipants(tripId);
  assertParticipant(participants, userId);
  const isCarrier = participants.carrier.id === userId;

  const messages = await prisma.message.findMany({
    where: { tripId, ...conversationWhere(participants, userId) },
    orderBy: { createdAt: "asc" },
    include: {
      fromUser: { select: { name: true } },
      toUser: { select: { name: true } },
    },
  });

  return {
    messages: messages.map(toMessageResponse),
    // para el selector del fletero cuando hay más de una empresa con carga
    // (también las que retiraron su carga, D9). La empresa no se entera de
    // qué otras empresas cargan en el viaje.
    participants: {
      carrier: participants.carrier,
      companies: isCarrier ? participants.companies : [],
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

  if (input.toUserId === fromUserId) {
    throw new AppError(
      "no te podés mandar un mensaje a vos mismo",
      400,
      "INVALID_TARGET"
    );
  }
  const targetIsCarrier = participants.carrier.id === input.toUserId;
  const targetIsCompany = participants.companyIds.includes(input.toUserId);
  if (!targetIsCarrier && !targetIsCompany) {
    throw new AppError(
      "esa persona no participa de este viaje",
      403,
      "NOT_A_PARTICIPANT"
    );
  }
  // U8: la empresa solo habla con el fletero, nunca con otra empresa
  const senderIsCarrier = participants.carrier.id === fromUserId;
  if (!senderIsCarrier && !targetIsCarrier) {
    throw new AppError(
      "solo podés escribirle al transportista del viaje",
      403,
      "FORBIDDEN"
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
 * del viaje y las empresas con carga viva en él.
 *
 * El fletero recibe el remito completo. Una empresa, solo su carga y los
 * totales del viaje (m³ ocupados y cantidad de cargas): nada de lo que llevan,
 * quiénes son ni cuánto pagan las demás (L2 ítem 9, U7).
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

  // las cargas retiradas no van al remito: es el documento de lo que viaja.
  const live = trip.cargoItems.filter(isActiveCargo);
  const listed = isCarrier ? live : live.filter((item) => item.company.id === userId);

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
    scope: isCarrier ? "FULL" : "COMPANY",
    usedVolume: live.reduce((sum, item) => sum + item.volume, 0),
    cargoCount: live.length,
    cargoItems: listed.map((item) => ({
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
const LOCATION_DESC = [{ recordedAt: "desc" as const }, { id: "desc" as const }];

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
  // el transportista del viaje y las empresas con alguna carga viva en él
  const participants = await resolveParticipants(tripId);
  assertActiveParticipant(
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

  // la última posición: con el orden ascendente, findFirst devolvía la primera
  const latest = await prisma.tripLocation.findFirst({
    where: { tripId },
    orderBy: LOCATION_DESC,
  });
  return { location: latest ? toLocationResponse(latest) : null };
}

/**
 * Paradas ordenadas del viaje (pickups). Devuelve la lista final combinando
 * stopOrder manual y proyección automática sobre la ruta origen→destino.
 * Solo para el transportista y las empresas con alguna carga viva en el viaje.
 * El fletero ve todas completas; la empresa, las suyas completas y las ajenas
 * como "otra parada", con el orden y el volumen (U19, ver toStopResponse).
 */
export async function getTripStops(tripId: string, userId: string): Promise<StopItem[]> {
  const participants = await resolveParticipants(tripId);
  assertActiveParticipant(
    participants,
    userId,
    "solo podés ver las paradas de los viajes donde tenés carga o sos el transportista"
  );
  const isCarrier = participants.carrier.id === userId;

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
          companyId: true,
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
    .map((item) =>
      toStopResponse(
        item,
        order.get(item.id) ?? 0,
        isCarrier || item.companyId === userId ? "FULL" : "OTHER"
      )
    )
    .sort((a, b) => a.stopOrder - b.stopOrder);
}

/**
 * Reordena las paradas manualmente. Solo el transportista dueño del viaje.
 * Body: array de { cargoItemId, order }.
 *
 * D2 = b: con el viaje en camino también se puede (las rutas cambian en la
 * realidad), pero se avisa a cada empresa cuya parada cambió de lugar. Un viaje
 * COMPLETED o CANCELLED no tiene paradas por delante: 409.
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
      status: true,
      origin: true,
      destination: true,
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
  if (trip.status === "COMPLETED" || trip.status === "CANCELLED") {
    throw new AppError(
      "el viaje ya terminó o se canceló: no se pueden reordenar las paradas",
      409,
      "INVALID_STATUS_TRANSITION"
    );
  }

  // el orden de antes y el de después salen de la misma cuenta que muestra
  // getTripStops, así se avisa justo a quien ve su parada en otro lugar
  const moved = await prisma.$transaction(async (tx) => {
    const stops = await tx.cargoItem.findMany({
      where: { tripId, status: { not: "CANCELLED" } },
      select: {
        id: true,
        companyId: true,
        pickupAddress: true,
        pickupLat: true,
        pickupLng: true,
        stopOrder: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // todos los cargoItemId tienen que ser cargas vivas de este viaje, sin repetir
    const live = new Set(stops.map((s) => s.id));
    const ids = items.map((i) => i.cargoItemId);
    if (!ids.every((id) => live.has(id)) || new Set(ids).size !== ids.length) {
      throw new AppError(
        "uno o más IDs de carga no pertenecen a este viaje o están cancelados",
        400,
        "INVALID_CARGO_ITEMS"
      );
    }

    for (const item of items) {
      await tx.cargoItem.update({
        where: { id: item.cargoItemId },
        data: { stopOrder: item.order },
      });
    }

    const newOrder = new Map(items.map((i) => [i.cargoItemId, i.order]));
    const before = calculateStopOrder(trip, stops);
    const after = calculateStopOrder(
      trip,
      stops.map((s) => ({ ...s, stopOrder: newOrder.get(s.id) ?? s.stopOrder }))
    );
    return stops
      .filter((s) => before.get(s.id) !== after.get(s.id))
      .map((s) => ({
        companyId: s.companyId,
        pickupAddress: s.pickupAddress,
        position: after.get(s.id) ?? 0,
        total: stops.length,
      }));
  });

  // antes de salir el orden todavía es un plan: el aviso es para un cambio en
  // camino. Un aviso por empresa, con cada una de sus paradas que se movió.
  if (trip.status === "IN_TRANSIT" && moved.length > 0) {
    const byCompany = new Map<string, typeof moved>();
    for (const stop of moved) {
      byCompany.set(stop.companyId, [...(byCompany.get(stop.companyId) ?? []), stop]);
    }
    for (const [companyId, stops] of byCompany) {
      await bestEffortNotify(() =>
        notifyUsers([companyId], {
          type: "STOPS_REORDERED",
          title: `cambió el orden de las paradas del viaje ${trip.origin} → ${trip.destination}`,
          body: stops
            .map(
              (s) =>
                `tu retiro en ${s.pickupAddress} pasó a ser la parada ${s.position} de ${s.total}.`
            )
            .join(" "),
          tripId,
        })
      );
    }
  }

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
 * Qué paradas entran en el recorrido: todas (fletero dueño, y la validación
 * interna de distancia de addCargoItem) o solo las de una empresa.
 */
type RouteScope = { kind: "FULL" } | { kind: "COMPANY"; companyId: string };

async function loadRouteTrip(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      status: true,
      carrierId: true,
      origin: true,
      destination: true,
      originLat: true,
      originLng: true,
      destLat: true,
      destLng: true,
      departureAddress: true,
      departureLat: true,
      departureLng: true,
      // todas las cargas, con su estado: el filtro de vivas se hace acá abajo
      // para poder distinguir al ex participante de un tercero
      cargoItems: {
        select: {
          id: true,
          companyId: true,
          status: true,
          pickupAddress: true,
          pickupLat: true,
          pickupLng: true,
          description: true,
          stopOrder: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!trip) throw new TripNotFoundError();
  return trip;
}

type RouteTrip = Awaited<ReturnType<typeof loadRouteTrip>>;

/**
 * Qué parte del recorrido le toca a quien mira (U7): el fletero dueño lo ve
 * entero; una empresa con carga viva, la salida, sus retiros y el destino.
 * Cualquier otro (ex participante, empresa sin carga, otro fletero) → 403.
 */
function routeScopeFor(trip: RouteTrip, viewerId: string): RouteScope {
  if (trip.carrierId === viewerId) return { kind: "FULL" };
  const hasActiveCargo = trip.cargoItems.some(
    (item) => item.companyId === viewerId && isActiveCargo(item)
  );
  if (!hasActiveCargo) {
    throw new AppError(
      "solo podés ver el recorrido de los viajes donde tenés carga " +
        "o sos el transportista",
      403,
      "FORBIDDEN"
    );
  }
  return { kind: "COMPANY", companyId: viewerId };
}

/**
 * El recorrido en el orden en que el camión lo hace: punto exacto de partida
 * (o el origin general si el fletero no indicó uno), cada pickup visible en su
 * stopOrder, y el destino.
 *
 * Los puntos sin coordenadas quedan afuera (no se pueden dibujar) e
 * `incomplete` le avisa al cliente que dibujó una versión recortada. Solo
 * cuentan los puntos que el scope deja ver: una parada ajena sin coordenadas
 * no se delata.
 */
function buildTripRoute(tripId: string, trip: RouteTrip, scope: RouteScope): TripRoute {
  const live = trip.cargoItems.filter(isActiveCargo);

  // el stopOrder se calcula con la línea origin→destino (Fase 14C) y sobre
  // todas las cargas vivas: así la empresa ve sus retiros en el mismo orden
  // relativo que el fletero.
  const order = calculateStopOrder(
    {
      originLat: trip.originLat,
      originLng: trip.originLng,
      destLat: trip.destLat,
      destLng: trip.destLng,
    },
    live.map((c) => ({
      id: c.id,
      pickupLat: c.pickupLat,
      pickupLng: c.pickupLng,
      stopOrder: c.stopOrder,
    }))
  );

  const visible =
    scope.kind === "FULL" ? live : live.filter((c) => c.companyId === scope.companyId);

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
    });
  } else if (trip.originLat !== null && trip.originLng !== null) {
    candidates.push({
      kind: "DEPARTURE",
      label: "salida",
      address: trip.origin,
      lat: trip.originLat,
      lng: trip.originLng,
      cargoItemId: null,
    });
  }

  const stops: RouteCandidate[] = visible
    .map((c) => ({
      kind: "PICKUP" as const,
      label: `retiro ${c.description}`,
      address: c.pickupAddress,
      lat: c.pickupLat as number,
      lng: c.pickupLng as number,
      cargoItemId: c.id,
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
    });
  }

  const points: RoutePoint[] = candidates.map((point, index) => ({
    ...point,
    order: index + 1,
  }));

  const drawn = points.length;
  const expected =
    (hasExactDeparture || trip.originLat !== null ? 1 : 0) +
    visible.length +
    (trip.destLat !== null ? 1 : 0);

  return {
    tripId,
    departureIsExact: hasExactDeparture,
    points,
    incomplete: drawn < expected,
  };
}

/**
 * GET /trips/:id/route: el recorrido que le toca ver a `viewerId` (ver
 * routeScopeFor). Ningún punto lleva trackingCode (U9): el código se ve en las
 * paradas y en el detalle de la propia carga.
 */
export async function getTripRoute(tripId: string, viewerId: string): Promise<TripRoute> {
  const trip = await loadRouteTrip(tripId);
  return buildTripRoute(tripId, trip, routeScopeFor(trip, viewerId));
}

/**
 * Caché en memoria de la geometría, por viaje y por scope: la del fletero (el
 * recorrido completo) y la de cada empresa (solo sus puntos) van en entradas
 * separadas, para que nadie reciba una geometría calculada con paradas ajenas.
 *
 * La firma incluye los propios puntos y el estado del viaje: si una carga entra
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

function geometryCacheKey(tripId: string, scope: RouteScope): string {
  return scope.kind === "FULL"
    ? `${tripId}|full`
    : `${tripId}|company:${scope.companyId}`;
}

export function clearRouteGeometryCache() {
  routeGeometryCache.clear();
}

export function routeGeometryCacheSize() {
  return routeGeometryCache.size;
}

/**
 * Geometría de la ruta real (calles) del recorrido, o null si OSRM no respondió,
 * tardó más de 5s, o el recorrido tiene menos de dos puntos. Nunca throw por
 * OSRM: el frontend dibuja líneas rectas en ese caso.
 */
async function routeGeometryFor(
  tripId: string,
  trip: RouteTrip,
  scope: RouteScope
): Promise<[number, number][] | null> {
  const route = buildTripRoute(tripId, trip, scope);
  if (route.points.length < 2) return null;

  const key = geometryCacheKey(tripId, scope);
  const signature = routeSignature(route, trip.status);
  const cached = routeGeometryCache.get(key);
  if (cached && cached.signature === signature) return cached.geometry;

  const geometry = await fetchRouteGeometry(
    route.points.map((p) => ({ lat: p.lat, lng: p.lng }))
  );

  if (routeGeometryCache.size >= MAX_GEOMETRY_CACHE_ENTRIES) {
    const oldest = routeGeometryCache.keys().next().value as string | undefined;
    if (oldest !== undefined) routeGeometryCache.delete(oldest);
  }
  routeGeometryCache.set(key, { signature, geometry });

  return geometry;
}

/**
 * GET /trips/:id/route-geometry: la geometría del recorrido que le toca ver a
 * `viewerId`. A una empresa se le calcula solo con la salida, sus retiros y el
 * destino; no con la ruta completa recortada, que dejaría ver por dónde pasa
 * el camión a buscar las otras cargas.
 */
export async function getTripRouteGeometry(
  tripId: string,
  viewerId: string
): Promise<[number, number][] | null> {
  const trip = await loadRouteTrip(tripId);
  return routeGeometryFor(tripId, trip, routeScopeFor(trip, viewerId));
}

/**
 * Geometría del recorrido completo, sin chequeo de acceso. Solo para uso
 * interno (la validación de distancia de addCargoItem); nunca se devuelve
 * a un cliente.
 */
export async function getFullRouteGeometry(
  tripId: string
): Promise<[number, number][] | null> {
  const trip = await loadRouteTrip(tripId);
  return routeGeometryFor(tripId, trip, { kind: "FULL" });
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

/** con el viaje así, el código viejo deja de andar (el nuevo sigue) */
const LEGACY_CODE_EXPIRED: ReadonlySet<string> = new Set(["COMPLETED", "CANCELLED"]);

const PUBLIC_TRACKING_INCLUDE = {
  trip: {
    select: {
      origin: true,
      destination: true,
      date: true,
      departureTime: true,
      status: true,
    },
  },
} as const;

export async function getPublicTracking(
  input: string
): Promise<PublicTracking | null> {
  const code = normalizeTrackingCode(input);
  if (!code) return null;

  const item = await prisma.cargoItem.findUnique({
    where: { trackingCode: code },
    include: PUBLIC_TRACKING_INCLUDE,
  });
  if (item) return toPublicTracking(item, item.trackingCode);

  // códigos de antes de U9: valen hasta que el viaje termina o se cancela
  const legacy = await prisma.cargoItem.findUnique({
    where: { legacyTrackingCode: code },
    include: PUBLIC_TRACKING_INCLUDE,
  });
  if (!legacy?.legacyTrackingCode || LEGACY_CODE_EXPIRED.has(legacy.trip.status)) {
    return null;
  }
  // se responde con el código buscado: quien tiene el viejo no se entera del nuevo
  return toPublicTracking(legacy, legacy.legacyTrackingCode);
}

function toPublicTracking(
  item: {
    description: string;
    status: string;
    trip: {
      origin: string;
      destination: string;
      date: Date;
      departureTime: string | null;
      status: string;
    };
  },
  trackingCode: string
): PublicTracking {
  return {
    trackingCode,
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
