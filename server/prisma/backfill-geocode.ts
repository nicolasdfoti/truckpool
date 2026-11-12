// `npm run seed:geocode`: corrige coordenadas de viajes y la ciudad de retiro
// de las cargas con el geocode de lib/geocode.ts (solo Argentina, 1 pedido por
// segundo). La lógica está en geocode-backfill-lib.ts. Ver HELP para el uso.
//
// dotenv va primero: DATABASE_URL viene de server/.env.
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { geocode, clearGeocodeCache } from "../lib/geocode.js";
import {
  BackfillArgsError,
  parseBackfillArgs,
  runGeocodeBackfill,
} from "./geocode-backfill-lib.js";

const HELP = `uso: npm run seed:geocode -- [modo] [--escribir]

en seco por defecto: muestra cada cambio (antes → después) y no escribe nada.
con --escribir guarda los cambios.

modos:
  (sin flag)     viajes sin coordenadas de origen o destino: los geocodifica
  --fuera-de-ar  viajes con origen, destino o salida fuera de Argentina: vuelve
                 a geocodificar ese punto; sin match en Argentina queda en null
  --cargas       cargas vivas sin ciudad de retiro (pickupCity): la completa con
                 la localidad del geocode; si sus coordenadas estaban fuera de
                 Argentina, las reemplaza (o quedan en null sin match)

consulta Nominatim con las direcciones de la base, 1 pedido por segundo: con
muchos registros tarda.
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  const args = parseBackfillArgs(argv);
  await runGeocodeBackfill(args, { db: prisma, geocode, log: console.log });
}

try {
  await main();
} catch (err) {
  if (err instanceof BackfillArgsError) {
    console.error(`${err.message}\n`);
    console.error(HELP);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  clearGeocodeCache();
  await prisma.$disconnect();
}
