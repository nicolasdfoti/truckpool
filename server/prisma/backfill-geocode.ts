/**
 * Backfill de coordenadas para los viajes que se crearon antes de la feature
 * de geocodificación (o cuyo geocode falló en su momento).
 *
 * Uso: npm run seed:geocode
 *
 * Geocodifica contra Nominatim con el rate limit de lib/geocode.ts (1 req/s),
 * así que con muchos viajes huérfanos tarda: es un script de una sola vez.
 * Para los viajes que no se puedan resolver deja las coords en null y los
 * reporta, no inventa una posición.
 */
import { prisma } from "../lib/prisma.js";
import { geocode, clearGeocodeCache, geocodeCacheSize } from "../lib/geocode.js";

const orphans = await prisma.trip.findMany({
  where: { OR: [{ originLat: null }, { destLat: null }] },
  select: { id: true, origin: true, destination: true },
  orderBy: { date: "desc" },
});

if (orphans.length === 0) {
  console.log("no hay viajes sin coordenadas.");
} else {
  console.log(`geocodificando ${orphans.length} viajes (1 req/s contra Nominatim)…`);
  let updated = 0;
  const failed: string[] = [];

  for (const trip of orphans) {
    const origin = await geocode(trip.origin);
    const destination = await geocode(trip.destination);
    if (!origin || !destination) {
      failed.push(
        `${trip.id} (${trip.origin} → ${trip.destination})${
          !origin ? " · origen" : ""
        }${!destination ? " · destino" : ""}`
      );
      continue;
    }
    await prisma.trip.update({
      where: { id: trip.id },
      data: {
        originLat: origin.lat,
        originLng: origin.lng,
        destLat: destination.lat,
        destLng: destination.lng,
      },
    });
    updated += 1;
    console.log(`  ✓ ${trip.id} ${trip.origin} → ${trip.destination}`);
  }

  console.log(`\n${updated} viajes con coordenadas.`);
  if (failed.length > 0) {
    console.log(`${failed.length} sin resolver (sus coords siguen en null):`);
    for (const line of failed) console.log(`  ✗ ${line}`);
  }
}

console.log(`entradas en el cache de geocode: ${geocodeCacheSize()}`);
clearGeocodeCache();
await prisma.$disconnect();
