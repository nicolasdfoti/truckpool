// Lógica de `npm run seed:geocode` (el entrypoint es backfill-geocode.ts).
// Recibe la base, el geocoder y el log por parámetro para poder probarla sin
// una base real ni Nominatim.
//
// En seco por defecto: muestra qué cambiaría y no escribe. Escribe solo con
// --escribir.
import type { PrismaClient } from "@prisma/client";
import { isInArgentinaBox, type GeocodedPlace, type LatLng } from "../lib/geocode.js";

export type BackfillMode = "sin-coordenadas" | "fuera-de-ar";
export type BackfillArgs = { mode: BackfillMode; write: boolean };

/** una opción inválida: el script la muestra tal cual y sale con 1 */
export class BackfillArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackfillArgsError";
  }
}

const MODE_FLAGS: Record<string, BackfillMode> = {
  "--fuera-de-ar": "fuera-de-ar",
};
const WRITE_FLAG = "--escribir";

export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const unknown = argv.filter((arg) => arg !== WRITE_FLAG && !(arg in MODE_FLAGS));
  if (unknown.length > 0) {
    throw new BackfillArgsError(
      `opción desconocida: ${unknown.join(", ")}. ` +
        `las que hay: ${Object.keys(MODE_FLAGS).join(", ")} y ${WRITE_FLAG}`
    );
  }
  const modes = argv.filter((arg) => arg in MODE_FLAGS);
  if (modes.length > 1) {
    throw new BackfillArgsError(`elegí un solo modo: ${modes.join(" o ")}`);
  }
  return {
    mode: modes[0] ? MODE_FLAGS[modes[0]]! : "sin-coordenadas",
    write: argv.includes(WRITE_FLAG),
  };
}

export type BackfillDeps = {
  db: PrismaClient;
  geocode: (address: string) => Promise<GeocodedPlace | null>;
  log: (line: string) => void;
};

/** cuántos registros y puntos cambian (o cambiarían, en seco) */
export type BackfillSummary = {
  mode: BackfillMode;
  written: boolean;
  examined: number;
  trips: number;
  points: number;
};

// los tres puntos de un viaje: texto, columnas y cómo se llama en la salida
const TRIP_POINTS = [
  { name: "origen", text: "origin", lat: "originLat", lng: "originLng" },
  { name: "destino", text: "destination", lat: "destLat", lng: "destLng" },
  {
    name: "salida",
    text: "departureAddress",
    lat: "departureLat",
    lng: "departureLng",
  },
] as const;

type TripRow = {
  id: string;
  origin: string;
  destination: string;
  departureAddress: string | null;
  originLat: number | null;
  originLng: number | null;
  destLat: number | null;
  destLng: number | null;
  departureLat: number | null;
  departureLng: number | null;
};

type TripPoint = (typeof TRIP_POINTS)[number];

function pointOf(trip: TripRow, p: TripPoint): LatLng | null {
  const lat = trip[p.lat];
  const lng = trip[p.lng];
  return lat === null || lng === null ? null : { lat, lng };
}

function coords(point: LatLng): string {
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

/**
 * Qué puntos de un viaje revisa cada modo: sin flag, los que no tienen
 * coordenadas; con --fuera-de-ar, los que las tienen fuera de la caja de
 * Argentina. El de salida solo cuenta si el viaje tiene dirección de salida.
 */
function needsWork(mode: BackfillMode, trip: TripRow, p: TripPoint): boolean {
  if (!trip[p.text]) return false;
  const point = pointOf(trip, p);
  if (mode === "sin-coordenadas") {
    // la salida es opcional y nunca se backfilleó: este modo sigue siendo el
    // de siempre (origen y destino)
    return point === null && p.name !== "salida";
  }
  return point !== null && !isInArgentinaBox(point);
}

async function backfillTrips(
  mode: BackfillMode,
  write: boolean,
  { db, geocode, log }: BackfillDeps
): Promise<Omit<BackfillSummary, "mode" | "written">> {
  const rows: TripRow[] = await db.trip.findMany({
    where:
      mode === "sin-coordenadas"
        ? { OR: [{ originLat: null }, { destLat: null }] }
        : {
            OR: [
              { originLat: { not: null } },
              { destLat: { not: null } },
              { departureLat: { not: null } },
            ],
          },
    select: {
      id: true,
      origin: true,
      destination: true,
      departureAddress: true,
      originLat: true,
      originLng: true,
      destLat: true,
      destLng: true,
      departureLat: true,
      departureLng: true,
    },
    orderBy: { date: "desc" },
  });

  let trips = 0;
  let points = 0;
  for (const trip of rows) {
    const data: Record<string, number | null> = {};
    for (const p of TRIP_POINTS) {
      if (!needsWork(mode, trip, p)) continue;
      const text = trip[p.text] as string;
      const before = pointOf(trip, p);
      const found = await geocode(text);
      // con countrycodes=ar no debería pasar, pero un resultado fuera de la
      // caja tampoco se guarda: sería volver a empezar
      const place = found && isInArgentinaBox(found) ? found : null;
      const head = `viaje ${trip.id} · ${p.name} "${text}": ${
        before ? `${coords(before)} (fuera de Argentina)` : "sin coordenadas"
      } →`;

      if (place) {
        data[p.lat] = place.lat;
        data[p.lng] = place.lng;
        log(`  ${head} ${place.label ?? "(sin texto)"} (${coords(place)})`);
      } else if (before) {
        data[p.lat] = null;
        data[p.lng] = null;
        log(`  ${head} queda sin coordenadas (no hay match en Argentina)`);
      } else {
        log(`  ${head} sigue sin coordenadas (no hay match en Argentina)`);
      }
    }

    const changed = Object.keys(data).length / 2;
    if (changed === 0) continue;
    trips += 1;
    points += changed;
    if (write) await db.trip.update({ where: { id: trip.id }, data });
  }
  return { examined: rows.length, trips, points };
}

const MODE_TITLE: Record<BackfillMode, string> = {
  "sin-coordenadas": "viajes sin coordenadas",
  "fuera-de-ar": "viajes con coordenadas fuera de Argentina",
};

export async function runGeocodeBackfill(
  args: BackfillArgs,
  deps: BackfillDeps
): Promise<BackfillSummary> {
  const { log } = deps;
  log(
    `${MODE_TITLE[args.mode]} — ${args.write ? "ESCRIBE en la base" : "en seco, no escribe nada"}`
  );
  log("(geocode contra Nominatim, 1 pedido por segundo)");

  const result = await backfillTrips(args.mode, args.write, deps);
  const summary: BackfillSummary = { mode: args.mode, written: args.write, ...result };

  log("");
  log(`revisados: ${summary.examined} viajes.`);
  if (summary.trips === 0) {
    log("no hay nada para cambiar.");
  } else if (args.write) {
    log(`escrito: ${summary.points} puntos en ${summary.trips} viajes.`);
  } else {
    const flag = Object.entries(MODE_FLAGS).find(([, mode]) => mode === args.mode)?.[0];
    log(
      `en seco: ${summary.points} puntos para cambiar en ${summary.trips} viajes. no se escribió nada.`
    );
    log(`para escribir: npm run seed:geocode -- ${flag ? `${flag} ` : ""}${WRITE_FLAG}`);
  }
  return summary;
}
