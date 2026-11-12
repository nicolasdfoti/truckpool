import { Prisma } from "@prisma/client";
import type { CargoItem, CargoItemStatus, Payment, Trip } from "@prisma/client";
import { isTripDateAvailable } from "./dates.js";
import type { CargoPrice } from "./pricing.js";

/**
 * Una carga retirada (CANCELLED) queda en el historial pero no cuenta: ni para
 * la capacidad ocupada ni para los totales del manifiesto. Todo lo que sume
 * volúmenes o importes de un viaje tiene que pasar por acá.
 */
export function isActiveCargo(item: { status: CargoItemStatus }) {
  return item.status !== "CANCELLED";
}

export function activeVolume(items: { volume: number; status: CargoItemStatus }[]) {
  return items.filter(isActiveCargo).reduce((sum, item) => sum + item.volume, 0);
}

export type TripWithCargo = Trip & {
  cargoItems: CargoItem[];
  carrier?: { name: string } | null;
};

/**
 * ¿Este viaje todavía puede recibir cargas? Es la regla de disponibilidad, y es
 * derivada: la fecha no se guarda ni se cambia, se compara contra el día de hoy
 * en Argentina. El estado guardado manda por delante: aunque la fecha siga
 * siendo futura, un viaje FULL o IN_TRANSIT no entra carga.
 *
 * Vive acá (y no duplicado en cada service) porque la usan tanto el resumen
 * de viajes como la respuesta de detalle.
 */
export function tripAcceptsCargo(trip: { status: Trip["status"]; date: Date }) {
  return trip.status === "OPEN" && isTripDateAvailable(trip.date);
}

/**
 * Filtro de Prisma para el fletero que puede cobrar: con cuenta de Mercado Pago
 * conectada y su token (lo mismo que exige `resolveCarrierMpToken`). Un viaje de
 * un fletero sin MP no se lista ni se reserva: la empresa recién se enteraba al
 * pagar la seña, con el lugar tomado 24 h (03/Pagar seña#1).
 */
export const CARRIER_CAN_CHARGE = {
  mpUserId: { not: null },
  mpAccessToken: { not: null },
} satisfies Prisma.UserWhereInput;

/** el mismo chequeo en memoria (vacío o ausente también es no conectado) */
export function carrierCanCharge(carrier: {
  mpUserId?: string | null;
  mpAccessToken?: string | null;
}): boolean {
  return Boolean(carrier.mpUserId && carrier.mpAccessToken);
}

export function toTripSummary(trip: TripWithCargo) {
  const used = activeVolume(trip.cargoItems);
  return {
    id: trip.id,
    origin: trip.origin,
    destination: trip.destination,
    date: trip.date,
    // null en los viajes publicados antes de la hora de salida: el cliente lo
    // muestra solo si viene.
    departureTime: trip.departureTime,
    truckType: trip.truckType,
    capacityTotal: trip.capacityTotal,
    capacityUsed: used,
    price: Number(trip.price),
    status: trip.status,
    // Derivado, no persistido: un viaje acepta carga nueva sólo si está OPEN y
    // su fecha (día calendario Argentina) todavía no llegó. El cliente usa esta
    // bandera para no ofrecer el formulario; el backend igual valida en
    // addCargoItem, así que saltarse la UI no habilita nada.
    acceptsCargo: tripAcceptsCargo(trip),
    carrierId: trip.carrierId,
    carrierName: trip.carrier?.name ?? "",
    features: trip.features,
    // la lista de viajes muestra cuánto se deja de seña: es el número que la
    // empresa necesita para decidir si le sirve.
    depositPercent: trip.depositPercent,
    // la comisión que se lleva la plataforma en este viaje. No es secreto:
    // sale de multiplicar el priceShare, que ya es público.
    platformFeePercent: trip.platformFeePercent,
    // el punto exacto de salida (depósito/galpón) no va en el resumen: es
    // público y la dirección del fletero solo la ven él y sus empresas (U7).
  };
}

export type CargoItemWithPayments = CargoItem & {
  payments?: Payment[];
  company?: { name: string } | null;
};

/**
 * D7 (c): el reparto neto de un pago, después de lo devuelto. La comisión es
 * solo sobre lo efectivamente cobrado, y MP devuelve la comisión en proporción
 * a lo reembolsado (verificado con pago real, ver D7 en docs/review/04-launch.md).
 * Se deriva acá y no se guarda: `platformFeeAmount` y `carrierAmount` siguen
 * siendo lo pactado en la preference.
 *
 * - comisión neta = comisión × (cobrado − devuelto) / cobrado, a centavos
 * - neto del fletero = lo que quedó cobrado − comisión neta (suman lo cobrado)
 * - REFUNDED sin `refundedAmount` asentado cuenta como devuelto entero
 * - CHARGED_BACK: null, porque no sabemos qué hace MP con la comisión
 * - sin reparto asentado: null
 *
 * El redondeo de MP no está verificado: puede diferir en un centavo del suyo.
 * Antes de facturar la comisión esto pasa a (b) o (d) (ver D7 en L4).
 */
function netSplit(payment: Payment): {
  netPlatformFeeAmount: number | null;
  netCarrierAmount: number | null;
} {
  const none = { netPlatformFeeAmount: null, netCarrierAmount: null };
  // `== null`: también cubre un pago armado sin esos campos (en la base son null)
  if (payment.platformFeeAmount == null || payment.carrierAmount == null) return none;
  if (payment.status === "CHARGED_BACK") return none;

  const amount = new Prisma.Decimal(payment.amount);
  if (amount.lte(0)) return none;
  const refunded =
    payment.status === "REFUNDED" && payment.refundedAmount === null
      ? amount
      : new Prisma.Decimal(payment.refundedAmount ?? 0);
  const kept = Prisma.Decimal.max(amount.minus(refunded), 0);
  const fee = new Prisma.Decimal(payment.platformFeeAmount)
    .times(kept)
    .dividedBy(amount)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return {
    netPlatformFeeAmount: fee.toNumber(),
    netCarrierAmount: kept.minus(fee).toNumber(),
  };
}

function toPaymentResponse(payment: Payment) {
  return {
    id: payment.id,
    type: payment.type,
    status: payment.status,
    amount: Number(payment.amount),
    refundedAmount:
      payment.refundedAmount === null ? null : Number(payment.refundedAmount),
    // el reparto de este pago: lo que se queda la plataforma y lo que queda el
    // transportista. El fletero lo necesita para saber cuánto cobra de una
    // carga, y sale de multiplicar el priceShare, que ya es público.
    platformFeeAmount:
      payment.platformFeeAmount === null ? null : Number(payment.platformFeeAmount),
    carrierAmount: payment.carrierAmount === null ? null : Number(payment.carrierAmount),
    // lo mismo después de lo devuelto (D7 c, ver netSplit)
    ...netSplit(payment),
  };
}

/**
 * La carga completa: solo para el fletero del viaje y la empresa dueña. Por
 * whitelist (U7): un campo nuevo del modelo no sale hasta que se agrega acá.
 */
export function toCargoItemResponse(item: CargoItemWithPayments) {
  const { payments, company } = item;
  const deposit = payments?.find((p) => p.type === "DEPOSIT");
  const balance = payments?.find((p) => p.type === "BALANCE");
  return {
    id: item.id,
    tripId: item.tripId,
    companyId: item.companyId,
    description: item.description,
    volume: item.volume,
    status: item.status,
    createdAt: item.createdAt,
    cancelledAt: item.cancelledAt,
    priceShare: Number(item.priceShare),
    depositAmount: Number(item.depositAmount),
    cancellationFeeAmount:
      item.cancellationFeeAmount === null ? null : Number(item.cancellationFeeAmount),
    companyName: company?.name ?? "",
    // la seña y el saldo van por separado porque se pagan en momentos
    // distintos: sin depósito no se confirma, y el saldo se cobra con el viaje
    // ya en camino.
    depositPayment: deposit ? toPaymentResponse(deposit) : null,
    balancePayment: balance ? toPaymentResponse(balance) : null,
    // pickups
    pickupAddress: item.pickupAddress,
    pickupLat: item.pickupLat,
    pickupLng: item.pickupLng,
    trackingCode: item.trackingCode,
    stopOrder: item.stopOrder,
  };
}

/**
 * Quién mira el detalle de un viaje (U7). Sale de la sesión y del propio viaje,
 * nunca del cliente:
 * - CARRIER_OWNER: el fletero del viaje, ve todo;
 * - PARTICIPANT: una empresa con alguna carga viva, ve las suyas completas y las
 *   ajenas solo como volumen;
 * - FORMER_PARTICIPANT: una empresa que retiró todas sus cargas, ve las suyas
 *   (con el reembolso) y nada de las demás;
 * - ANONYMOUS: el resto, también el ADMIN y otros fleteros (el admin necesita
 *   su propia vista, L9): solo los agregados del viaje.
 */
export type TripViewerAccess =
  "ANONYMOUS" | "CARRIER_OWNER" | "PARTICIPANT" | "FORMER_PARTICIPANT";

export function tripViewerAccess(
  trip: {
    carrierId: string;
    cargoItems: { companyId: string; status: CargoItemStatus }[];
  },
  viewer: { id: string } | null
): TripViewerAccess {
  if (!viewer) return "ANONYMOUS";
  if (viewer.id === trip.carrierId) return "CARRIER_OWNER";
  const own = trip.cargoItems.filter((item) => item.companyId === viewer.id);
  if (own.some(isActiveCargo)) return "PARTICIPANT";
  if (own.length > 0) return "FORMER_PARTICIPANT";
  return "ANONYMOUS";
}

/**
 * Reseña tal como sale de la base (con la relación al fletero). `fromUserId`
 * se usa para calcular `viewerReviewed`, pero nunca sale en la respuesta.
 */
export type ReviewRow = {
  id: string;
  tripId: string;
  fromUserId: string;
  toUserId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  toUser?: { name: string } | null;
};

/**
 * Reseña en el detalle del viaje (L2 ítem 10): sin `fromUserId` ni `fromName`,
 * para que nadie pueda ver qué empresas mandaron carga en un viaje leyendo
 * quién lo calificó. El destinatario es siempre el fletero, que ya es público.
 */
export function toReviewResponse(review: ReviewRow) {
  return {
    id: review.id,
    tripId: review.tripId,
    toUserId: review.toUserId,
    toName: review.toUser?.name ?? "",
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
  };
}

/** reseña en el perfil del fletero: el viaje sí, la empresa que calificó no */
export function toCarrierReviewResponse(review: {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  trip: { id: string; origin: string; destination: string };
}) {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
    trip: {
      id: review.trip.id,
      origin: review.trip.origin,
      destination: review.trip.destination,
    },
  };
}

export type TripDetailSource = Trip & {
  cargoItems: CargoItemWithPayments[];
  carrier: { name: string };
  reviews: ReviewRow[];
};

/**
 * Detalle de un viaje según quién lo mira (U7). Todos ven el viaje y sus
 * agregados (m³ ocupados y cantidad de cargas vivas); lo demás depende de
 * `tripViewerAccess`. Las claves `cargoItems` y `otherCargo` van siempre, vacías
 * si no corresponde, para que el cliente no tenga que preguntar si existen.
 */
export function toTripDetailResponse(
  trip: TripDetailSource,
  viewer: { id: string } | null
) {
  const access = tripViewerAccess(trip, viewer);
  const active = trip.cargoItems.filter(isActiveCargo);

  const cargoItems =
    access === "CARRIER_OWNER"
      ? trip.cargoItems
      : access === "PARTICIPANT" || access === "FORMER_PARTICIPANT"
        ? trip.cargoItems.filter((item) => item.companyId === viewer?.id)
        : [];
  // las ajenas, solo para la empresa con carga viva: el volumen y la localidad
  // del retiro que resolvió el geocode (L6), nunca la dirección
  const otherCargo =
    access === "PARTICIPANT"
      ? active
          .filter((item) => item.companyId !== viewer?.id)
          .map((item) => ({ volume: item.volume, pickupCity: item.pickupCity }))
      : [];
  const seesDeparture = access === "CARRIER_OWNER" || access === "PARTICIPANT";

  return {
    id: trip.id,
    origin: trip.origin,
    destination: trip.destination,
    date: trip.date,
    departureTime: trip.departureTime,
    truckType: trip.truckType,
    capacityTotal: trip.capacityTotal,
    capacityUsed: activeVolume(trip.cargoItems),
    cargoCount: active.length,
    price: Number(trip.price),
    status: trip.status,
    // misma bandera que manda en el listado: el cliente la usa para no
    // ofrecer el formulario de carga.
    acceptsCargo: tripAcceptsCargo(trip),
    carrierId: trip.carrierId,
    carrierName: trip.carrier.name,
    depositPercent: trip.depositPercent,
    // la comisión no es secreta (sale del priceShare, ver toTripSummary): el
    // fletero la ve en su neto por carga
    platformFeePercent: trip.platformFeePercent,
    features: trip.features,
    reviews: trip.reviews.map(toReviewResponse),
    viewerAccess: access,
    // si quien mira ya calificó el viaje: reemplaza comparar review.fromUserId
    viewerReviewed: viewer
      ? trip.reviews.some((review) => review.fromUserId === viewer.id)
      : false,
    // el punto exacto de salida, solo para el fletero y sus empresas activas
    ...(seesDeparture ? { departureAddress: trip.departureAddress } : {}),
    cargoItems: cargoItems.map(toCargoItemResponse),
    otherCargo,
  };
}

/**
 * Una parada del recorrido (U19). `FULL` es la parada completa: para el fletero
 * todas, para la empresa las suyas. `OTHER` es la parada de otra empresa: solo
 * el lugar en el orden, el volumen y la localidad del retiro (`pickupCity`, L6).
 */
export type StopItem =
  | {
      kind: "FULL";
      cargoItemId: string;
      pickupAddress: string;
      pickupLat: number | null;
      pickupLng: number | null;
      trackingCode: string;
      description: string;
      volume: number;
      status: CargoItemStatus;
      stopOrder: number;
    }
  | { kind: "OTHER"; stopOrder: number; volume: number; pickupCity: string | null };

export function toStopResponse(
  item: {
    id: string;
    pickupAddress: string;
    pickupCity: string | null;
    pickupLat: number | null;
    pickupLng: number | null;
    trackingCode: string;
    description: string;
    volume: number;
    status: CargoItemStatus;
  },
  stopOrder: number,
  kind: StopItem["kind"]
): StopItem {
  if (kind === "OTHER") {
    return { kind, stopOrder, volume: item.volume, pickupCity: item.pickupCity };
  }
  return {
    kind,
    cargoItemId: item.id,
    pickupAddress: item.pickupAddress,
    pickupLat: item.pickupLat,
    pickupLng: item.pickupLng,
    trackingCode: item.trackingCode,
    description: item.description,
    volume: item.volume,
    status: item.status,
    stopOrder,
  };
}

/** cotización de una carga antes de reservar: los montos de `cargoPrice` en pesos */
export function toCargoQuoteResponse(
  quote: CargoPrice,
  input: { volume: number; depositPercent: number }
) {
  return {
    volume: input.volume,
    depositPercent: input.depositPercent,
    priceShare: Number(quote.priceShare),
    depositAmount: Number(quote.depositAmount),
    balanceAmount: Number(quote.balanceAmount),
  };
}
