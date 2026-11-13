// Datos fijos para el e2e de Playwright (R1): usuarios extra y dos viajes de
// flete@ con ids conocidos. Se puede correr las veces que haga falta: los
// viajes se borran y se vuelven a crear en cada corrida, así cada test arranca
// del mismo estado. Solo para dev: nunca contra la base de producción.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { generateTrackingCode } from "../lib/trackingCode.js";
import { assertNotProduction } from "./seed-guard.js";

// los mismos ids y textos los usa client/tests-e2e/fixtures.ts
const E2E_ROLES_TRIP_ID = "e2e-trip-roles";
const E2E_REVIEWS_TRIP_ID = "e2e-trip-reviews";
const E2E_TRANSIT_TRIP_ID = "e2e-trip-transit";
// L7: el ciclo de la carga (retiro, confirmar, salir) y cancelar un viaje
const E2E_LIFECYCLE_TRIP_ID = "e2e-trip-lifecycle";
const E2E_CANCEL_TRIP_ID = "e2e-trip-cancel";

const DAY_MS = 24 * 60 * 60 * 1000;

const COORDS = {
  cordoba: { lat: -31.4201, lng: -64.1888 },
  rosario: { lat: -32.9442, lng: -60.6505 },
  villaMaria: { lat: -32.4075, lng: -63.2405 },
  marcosJuarez: { lat: -32.6976, lng: -62.1059 },
  bellVille: { lat: -32.6259, lng: -62.6886 },
};

async function companyUser(email: string, name: string, password: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, password, role: "COMPANY" },
  });
}

/** borra un viaje del e2e con todo lo que cuelga de él */
async function deleteTrip(id: string) {
  const items = await prisma.cargoItem.findMany({
    where: { tripId: id },
    select: { id: true },
  });
  const cargoItemIds = items.map((item) => item.id);
  await prisma.refundRequest.deleteMany({ where: { cargoItemId: { in: cargoItemIds } } });
  await prisma.payment.deleteMany({ where: { cargoItemId: { in: cargoItemIds } } });
  await prisma.cargoItem.deleteMany({ where: { tripId: id } });
  await prisma.notification.deleteMany({ where: { tripId: id } });
  // reseñas, mensajes y ubicaciones caen en cascada con el viaje
  await prisma.trip.deleteMany({ where: { id } });
}

async function main() {
  assertNotProduction("seed-e2e");

  const password = await bcrypt.hash("truckpool123", 10);

  // flete@ y empresa@ son los del seed demo: se crean acá también por si la
  // base no lo tiene. Sin datos de Mercado Pago: el e2e solo mira pantallas.
  const carrier = await prisma.user.upsert({
    where: { email: "flete@truckpool.app" },
    update: { verificationStatus: "VERIFIED", verificationNote: null },
    create: {
      email: "flete@truckpool.app",
      name: "Transportes Flete",
      password,
      role: "CARRIER",
      taxId: "20345678901",
      verificationStatus: "VERIFIED",
    },
  });
  const owner = await companyUser("empresa@truckpool.app", "Comercial Norte", password);
  const second = await companyUser("e2e-segunda@truckpool.app", "E2E Segunda", password);
  const former = await companyUser("e2e-ex@truckpool.app", "E2E Ex", password);
  const other = await companyUser("e2e-otra@truckpool.app", "E2E Otra", password);

  await deleteTrip(E2E_ROLES_TRIP_ID);
  await deleteTrip(E2E_REVIEWS_TRIP_ID);
  await deleteTrip(E2E_TRANSIT_TRIP_ID);
  await deleteTrip(E2E_LIFECYCLE_TRIP_ID);
  await deleteTrip(E2E_CANCEL_TRIP_ID);

  // viaje abierto con dos cargas vivas (empresa@ y e2e-segunda@) y una
  // retirada (e2e-ex@, ex participante, D9)
  await prisma.trip.create({
    data: {
      id: E2E_ROLES_TRIP_ID,
      origin: "Córdoba",
      destination: "Rosario",
      date: new Date(Date.now() + 10 * DAY_MS),
      departureTime: "08:00",
      departureAddress: "E2E Galpón Flete 100, Córdoba",
      departureLat: COORDS.cordoba.lat,
      departureLng: COORDS.cordoba.lng,
      truckType: "Semi",
      capacityTotal: 30,
      price: new Prisma.Decimal("3000.00"),
      depositPercent: 20,
      carrierId: carrier.id,
      originLat: COORDS.cordoba.lat,
      originLng: COORDS.cordoba.lng,
      destLat: COORDS.rosario.lat,
      destLng: COORDS.rosario.lng,
    },
  });

  // PENDING sin seña: alcanza para ver el detalle y no inventa pagos de MP. El
  // seed corre antes de cada e2e, así que la reserva nunca llega a vencer.
  await prisma.cargoItem.create({
    data: {
      tripId: E2E_ROLES_TRIP_ID,
      companyId: owner.id,
      description: "E2E carga de la dueña",
      volume: 4,
      priceShare: new Prisma.Decimal("400.00"),
      depositAmount: new Prisma.Decimal("80.00"),
      status: "PENDING",
      pickupAddress: "E2E Calle Dueña 111, Villa María",
      // la localidad que daría el geocode: lo que ven las otras empresas (L6)
      pickupCity: "Villa María",
      pickupLat: COORDS.villaMaria.lat,
      pickupLng: COORDS.villaMaria.lng,
      trackingCode: generateTrackingCode(),
    },
  });
  await prisma.cargoItem.create({
    data: {
      tripId: E2E_ROLES_TRIP_ID,
      companyId: second.id,
      description: "E2E carga de la segunda",
      volume: 3,
      priceShare: new Prisma.Decimal("300.00"),
      depositAmount: new Prisma.Decimal("60.00"),
      status: "PENDING",
      pickupAddress: "E2E Calle Segunda 222, Marcos Juárez",
      pickupCity: "Marcos Juárez",
      pickupLat: COORDS.marcosJuarez.lat,
      pickupLng: COORDS.marcosJuarez.lng,
      trackingCode: generateTrackingCode(),
    },
  });
  await prisma.cargoItem.create({
    data: {
      tripId: E2E_ROLES_TRIP_ID,
      companyId: former.id,
      description: "E2E carga del ex participante",
      volume: 2,
      priceShare: new Prisma.Decimal("200.00"),
      depositAmount: new Prisma.Decimal("40.00"),
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancellationFeeAmount: new Prisma.Decimal("0.00"),
      pickupAddress: "E2E Calle Ex 333, Bell Ville",
      pickupCity: "Bell Ville",
      pickupLat: COORDS.bellVille.lat,
      pickupLng: COORDS.bellVille.lng,
      trackingCode: generateTrackingCode(),
    },
  });

  // viaje completado con la reseña de empresa@ (etiqueta fija y viewerReviewed)
  await prisma.trip.create({
    data: {
      id: E2E_REVIEWS_TRIP_ID,
      origin: "Rosario",
      destination: "Córdoba",
      date: new Date(Date.now() - 10 * DAY_MS),
      departureTime: "09:00",
      truckType: "Chasis",
      capacityTotal: 20,
      price: new Prisma.Decimal("2000.00"),
      status: "COMPLETED",
      carrierId: carrier.id,
      originLat: COORDS.rosario.lat,
      originLng: COORDS.rosario.lng,
      destLat: COORDS.cordoba.lat,
      destLng: COORDS.cordoba.lng,
    },
  });
  await prisma.cargoItem.create({
    data: {
      tripId: E2E_REVIEWS_TRIP_ID,
      companyId: owner.id,
      description: "E2E carga con reseña",
      volume: 5,
      priceShare: new Prisma.Decimal("500.00"),
      depositAmount: new Prisma.Decimal("100.00"),
      status: "CONFIRMED",
      pickupAddress: "E2E Calle Reseña 444, Rosario",
      pickupCity: "Rosario",
      pickupLat: COORDS.rosario.lat,
      pickupLng: COORDS.rosario.lng,
      trackingCode: generateTrackingCode(),
    },
  });
  await prisma.review.create({
    data: {
      tripId: E2E_REVIEWS_TRIP_ID,
      fromUserId: owner.id,
      toUserId: carrier.id,
      rating: 5,
      comment: "E2E reseña: puntual y prolijo",
    },
  });

  // viaje en tránsito: ubicación y remito. empresa@ con carga viva (sin pagos:
  // el e2e no toca el saldo) y e2e-ex@ con la suya retirada antes de salir (D9)
  await prisma.trip.create({
    data: {
      id: E2E_TRANSIT_TRIP_ID,
      origin: "Córdoba",
      destination: "Rosario",
      date: new Date(Date.now() - DAY_MS),
      departureTime: "07:00",
      truckType: "Semi",
      capacityTotal: 25,
      price: new Prisma.Decimal("2500.00"),
      status: "IN_TRANSIT",
      carrierId: carrier.id,
      originLat: COORDS.cordoba.lat,
      originLng: COORDS.cordoba.lng,
      destLat: COORDS.rosario.lat,
      destLng: COORDS.rosario.lng,
    },
  });
  await prisma.cargoItem.create({
    data: {
      tripId: E2E_TRANSIT_TRIP_ID,
      companyId: owner.id,
      description: "E2E carga en tránsito de la dueña",
      volume: 6,
      priceShare: new Prisma.Decimal("600.00"),
      depositAmount: new Prisma.Decimal("120.00"),
      status: "CONFIRMED",
      pickupAddress: "E2E Calle Tránsito 555, Villa María",
      pickupCity: "Villa María",
      pickupLat: COORDS.villaMaria.lat,
      pickupLng: COORDS.villaMaria.lng,
      trackingCode: generateTrackingCode(),
    },
  });
  await prisma.cargoItem.create({
    data: {
      tripId: E2E_TRANSIT_TRIP_ID,
      companyId: former.id,
      description: "E2E carga en tránsito del ex participante",
      volume: 2,
      priceShare: new Prisma.Decimal("200.00"),
      depositAmount: new Prisma.Decimal("40.00"),
      status: "CANCELLED",
      cancelledAt: new Date(Date.now() - 2 * DAY_MS),
      cancellationFeeAmount: new Prisma.Decimal("0.00"),
      pickupAddress: "E2E Calle Tránsito Ex 666, Bell Ville",
      pickupCity: "Bell Ville",
      pickupLat: COORDS.bellVille.lat,
      pickupLng: COORDS.bellVille.lng,
      trackingCode: generateTrackingCode(),
    },
  });
  await prisma.tripLocation.create({
    data: {
      tripId: E2E_TRANSIT_TRIP_ID,
      lat: COORDS.villaMaria.lat,
      lng: COORDS.villaMaria.lng,
    },
  });

  // L7: ciclo de vida de la carga. Viaje abierto a 10 días (más de 48 h: el
  // retiro devuelve toda la seña) con tres cargas:
  // - empresa@ PENDING sin seña (se retira de verdad: no hay nada que devolver);
  // - e2e-segunda@ PENDING con la seña aprobada (el fletero la confirma);
  // - empresa@ CONFIRMED con la seña aprobada (el diálogo muestra el desglose,
  //   pero el e2e no la retira: el server le pediría el reembolso a MP).
  // Las señas aprobadas llevan un mpPaymentId falso: el e2e nunca hace que el
  // server llame a Mercado Pago.
  await prisma.trip.create({
    data: {
      id: E2E_LIFECYCLE_TRIP_ID,
      origin: "Córdoba",
      destination: "Mendoza",
      date: new Date(Date.now() + 10 * DAY_MS),
      departureTime: "08:00",
      truckType: "Semi",
      capacityTotal: 30,
      price: new Prisma.Decimal("3000.00"),
      depositPercent: 20,
      carrierId: carrier.id,
      originLat: COORDS.cordoba.lat,
      originLng: COORDS.cordoba.lng,
    },
  });
  await prisma.cargoItem.create({
    data: {
      tripId: E2E_LIFECYCLE_TRIP_ID,
      companyId: owner.id,
      description: "E2E ciclo sin seña",
      volume: 4,
      priceShare: new Prisma.Decimal("400.00"),
      depositAmount: new Prisma.Decimal("80.00"),
      status: "PENDING",
      pickupAddress: "E2E Calle Ciclo 700, Córdoba",
      pickupCity: "Córdoba",
      trackingCode: generateTrackingCode(),
    },
  });
  const paidPending = await prisma.cargoItem.create({
    data: {
      tripId: E2E_LIFECYCLE_TRIP_ID,
      companyId: second.id,
      description: "E2E ciclo con seña",
      volume: 3,
      priceShare: new Prisma.Decimal("300.00"),
      depositAmount: new Prisma.Decimal("60.00"),
      status: "PENDING",
      pickupAddress: "E2E Calle Ciclo 701, Córdoba",
      pickupCity: "Córdoba",
      trackingCode: generateTrackingCode(),
    },
  });
  const confirmed = await prisma.cargoItem.create({
    data: {
      tripId: E2E_LIFECYCLE_TRIP_ID,
      companyId: owner.id,
      description: "E2E ciclo confirmada",
      volume: 5,
      priceShare: new Prisma.Decimal("500.00"),
      depositAmount: new Prisma.Decimal("100.00"),
      status: "CONFIRMED",
      pickupAddress: "E2E Calle Ciclo 702, Córdoba",
      pickupCity: "Córdoba",
      trackingCode: generateTrackingCode(),
    },
  });
  for (const [item, amount, mpPaymentId] of [
    [paidPending, "60.00", "e2e-mp-ciclo-1"],
    [confirmed, "100.00", "e2e-mp-ciclo-2"],
  ] as const) {
    await prisma.payment.create({
      data: {
        cargoItemId: item.id,
        type: "DEPOSIT",
        status: "APPROVED",
        amount: new Prisma.Decimal(amount),
        mpPaymentId,
      },
    });
  }

  // L7: viaje para «cancelar viaje», con una sola carga PENDING sin seña: la
  // cancelación de verdad no tiene nada que devolver (sin llamadas a MP)
  await prisma.trip.create({
    data: {
      id: E2E_CANCEL_TRIP_ID,
      origin: "Rosario",
      destination: "Mendoza",
      date: new Date(Date.now() + 10 * DAY_MS),
      departureTime: "09:00",
      truckType: "Chasis",
      capacityTotal: 20,
      price: new Prisma.Decimal("2000.00"),
      depositPercent: 20,
      carrierId: carrier.id,
      originLat: COORDS.rosario.lat,
      originLng: COORDS.rosario.lng,
    },
  });
  await prisma.cargoItem.create({
    data: {
      tripId: E2E_CANCEL_TRIP_ID,
      companyId: other.id,
      description: "E2E carga del viaje a cancelar",
      volume: 2,
      priceShare: new Prisma.Decimal("200.00"),
      depositAmount: new Prisma.Decimal("40.00"),
      status: "PENDING",
      pickupAddress: "E2E Calle Cancelar 800, Rosario",
      pickupCity: "Rosario",
      trackingCode: generateTrackingCode(),
    },
  });

  console.log(
    `seed e2e listo: ${E2E_ROLES_TRIP_ID}, ${E2E_REVIEWS_TRIP_ID}, ${E2E_TRANSIT_TRIP_ID}, ${E2E_LIFECYCLE_TRIP_ID}, ${E2E_CANCEL_TRIP_ID}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
