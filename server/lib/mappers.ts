import type { CargoItem, CargoItemStatus, Payment, Trip } from "@prisma/client";
import { isTripDateAvailable } from "./dates.js";

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
    // punto exacto de salida (depósito/galpón), distinto del origin general
    departureAddress: trip.departureAddress,
    departureLat: trip.departureLat,
    departureLng: trip.departureLng,
  };
}

export type CargoItemWithPayments = CargoItem & {
  payments?: Payment[];
  company?: { name: string } | null;
};

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
  };
}

export function toCargoItemResponse(item: CargoItemWithPayments) {
  const { payments, company, ...rest } = item;
  const deposit = payments?.find((p) => p.type === "DEPOSIT");
  const balance = payments?.find((p) => p.type === "BALANCE");
  return {
    ...rest,
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
