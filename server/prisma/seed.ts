import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

async function main() {
  const password = await bcrypt.hash("truckpool123", 10);

  // el fletero demo queda VERIFIED para no romper el flujo de prueba manual
  // (si no, no podría publicar viajes).
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

  const admin = await prisma.user.upsert({
    where: { email: "admin@truckpool.app" },
    update: {},
    create: {
      email: "admin@truckpool.app",
      name: "Administración TruckPool",
      password,
      role: "ADMIN",
    },
  });

  const company = await prisma.user.upsert({
    where: { email: "empresa@truckpool.app" },
    update: {},
    create: {
      email: "empresa@truckpool.app",
      name: "Comercial Norte",
      password,
      role: "COMPANY",
    },
  });

  // Coordenadas de las ciudades del seed, hardcodeadas a propósito: el seed no
  // debería depender de que haya red ni gastar el rate limit de Nominatim.
  // Los viajes creados desde la app sí se geocodifican contra Nominatim.
  const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
    Córdoba: { lat: -31.4201, lng: -64.1888 },
    Rosario: { lat: -32.9442, lng: -60.6505 },
    "Buenos Aires": { lat: -34.6037, lng: -58.3816 },
    "Santa Fe": { lat: -31.6333, lng: -60.7 },
  };
  const coordsOf = (city: string) => CITY_COORDS[city] ?? null;

  const hasTrips = (await prisma.trip.count()) > 0;
  if (!hasTrips) {
    const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    const trip1 = await prisma.trip.create({
      data: {
        id: "seed-trip-1",
        origin: "Córdoba",
        destination: "Rosario",
        date: inThreeDays,
        truckType: "Semi",
        capacityTotal: 30,
        price: new Prisma.Decimal("1500.00"),
        carrierId: carrier.id,
        originLat: coordsOf("Córdoba")?.lat ?? null,
        originLng: coordsOf("Córdoba")?.lng ?? null,
        destLat: coordsOf("Rosario")?.lat ?? null,
        destLng: coordsOf("Rosario")?.lng ?? null,
      },
    });

    await prisma.trip.create({
      data: {
        id: "seed-trip-2",
        origin: "Buenos Aires",
        destination: "Santa Fe",
        date: inFiveDays,
        truckType: "Chasis",
        capacityTotal: 45,
        price: new Prisma.Decimal("2100.00"),
        carrierId: carrier.id,
        originLat: coordsOf("Buenos Aires")?.lat ?? null,
        originLng: coordsOf("Buenos Aires")?.lng ?? null,
        destLat: coordsOf("Santa Fe")?.lat ?? null,
        destLng: coordsOf("Santa Fe")?.lng ?? null,
      },
    });

    // La carga de ejemplo va CONFIRMED, así que su seña ya está cobrada: se crea
    // el pago DEPOSIT APPROVED. Si faltara, el viaje podría completarse sin que
    // la empresa pagara nada y la carga quedaría con un saldo imposible de
    // auditar contra la base.
    const seedDeposit = new Prisma.Decimal("120.00");
    const seedCargo = await prisma.cargoItem.create({
      data: {
        tripId: trip1.id,
        companyId: company.id,
        description: "Maquinaria industrial",
        volume: 12,
        priceShare: new Prisma.Decimal("600.00"),
        depositAmount: seedDeposit,
        status: "CONFIRMED",
        pickupAddress: "Córdoba, Córdoba",
        pickupLat: coordsOf("Córdoba")?.lat ?? null,
        pickupLng: coordsOf("Córdoba")?.lng ?? null,
        trackingCode: "TP-SEED-C1",
      },
    });
    await prisma.payment.create({
      data: {
        cargoItemId: seedCargo.id,
        amount: seedDeposit,
        type: "DEPOSIT",
        status: "APPROVED",
        mpPaymentId: "seed-payment-deposit",
      },
    });

    console.log(">>> trips y carga de ejemplo creados");
  }

  console.log("seed listo");
  console.log(
    `login: flete@truckpool.app (${carrier.verificationStatus}) / empresa@truckpool.app / ${admin.email}`
  );
  console.log("password: truckpool123");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
