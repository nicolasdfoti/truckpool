// Lógica de `npm run seed:geocode` (el entrypoint es backfill-geocode.ts).
// Recibe la base, el geocoder y el log por parámetro para poder probarla sin
// una base real ni Nominatim.
//
// En seco por defecto: muestra qué cambiaría y no escribe. Escribe solo con
// --escribir.
import type { PrismaClient } from "@prisma/client";
import { isInArgentinaBox, type GeocodedPlace, type LatLng } from "../lib/geocode.js";

export type BackfillMode = "sin-coordenadas" | "fuera-de-ar" | "cargas";
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
  "--cargas": "cargas",
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

/** cuántos registros, coordenadas y ciudades cambian (o cambiarían, en seco) */
export type BackfillSummary = {
  mode: BackfillMode;
  written: boolean;
  /** viajes o cargas revisados */
  examined: number;
  /** viajes o cargas con algún cambio */
  changed: number;
  /** puntos (lat/lng) que cambian */
  points: number;
  /** pickupCity que se completan (solo --cargas) */
  cities: number;
};

type BackfillCounts = Omit<BackfillSummary, "mode" | "written">;

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
): Promise<BackfillCounts> {
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

  let changed = 0;
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

    const tripPoints = Object.keys(data).length / 2;
    if (tripPoints === 0) continue;
    changed += 1;
    points += tripPoints;
    if (write) await db.trip.update({ where: { id: trip.id }, data });
  }
  return { examined: rows.length, changed, points, cities: 0 };
}

/**
 * --cargas: las cargas vivas sin `pickupCity` (las reservadas antes de L6). La
 * ciudad sale del geocode de su dirección de retiro; de paso, si sus
 * coordenadas estaban fuera de Argentina se reemplazan (o pasan a null sin
 * match), con el mismo criterio que los viajes. Coordenadas null o adentro
 * no se tocan.
 */
async function backfillCargo(
  write: boolean,
  { db, geocode, log }: BackfillDeps
): Promise<BackfillCounts> {
  const rows = await db.cargoItem.findMany({
    where: { pickupCity: null, status: { not: "CANCELLED" } },
    select: {
      id: true,
      pickupAddress: true,
      pickupCity: true,
      pickupLat: true,
      pickupLng: true,
    },
    orderBy: { createdAt: "desc" },
  });

  let changed = 0;
  let points = 0;
  let cities = 0;
  for (const item of rows) {
    const found = await geocode(item.pickupAddress);
    const place = found && isInArgentinaBox(found) ? found : null;
    const before =
      item.pickupLat === null || item.pickupLng === null
        ? null
        : { lat: item.pickupLat, lng: item.pickupLng };
    const outside = before !== null && !isInArgentinaBox(before);

    const data: {
      pickupCity?: string;
      pickupLat?: number | null;
      pickupLng?: number | null;
    } = {};
    const parts: string[] = [];
    if (place?.city) {
      data.pickupCity = place.city;
      parts.push(`ciudad → ${place.city}`);
    } else {
      parts.push(
        `sigue sin ciudad (${place ? "el geocode no informó localidad" : "no hay match en Argentina"})`
      );
    }
    if (outside) {
      data.pickupLat = place?.lat ?? null;
      data.pickupLng = place?.lng ?? null;
      parts.push(
        `coords ${coords(before)} (fuera de Argentina) → ${
          place
            ? `${place.label ?? "(sin texto)"} (${coords(place)})`
            : "quedan sin coordenadas"
        }`
      );
    }
    log(`  carga ${item.id} "${item.pickupAddress}": ${parts.join(" · ")}`);

    if (Object.keys(data).length === 0) continue;
    changed += 1;
    if (data.pickupCity) cities += 1;
    if (outside) points += 1;
    if (write) await db.cargoItem.update({ where: { id: item.id }, data });
  }
  return { examined: rows.length, changed, points, cities };
}

const VIAJES = ["viaje", "viajes"] as const;

/** "1 viaje", "2 viajes", "0 viajes" */
function count(n: number, [one, many]: readonly [string, string]): string {
  return `${n} ${n === 1 ? one : many}`;
}

const MODE_TITLE: Record<BackfillMode, string> = {
  "sin-coordenadas": "viajes sin coordenadas",
  "fuera-de-ar": "viajes con coordenadas fuera de Argentina",
  cargas: "cargas vivas sin ciudad de retiro (pickupCity)",
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

  const result =
    args.mode === "cargas"
      ? await backfillCargo(args.write, deps)
      : await backfillTrips(args.mode, args.write, deps);
  const summary: BackfillSummary = { mode: args.mode, written: args.write, ...result };

  const unit = args.mode === "cargas" ? (["carga", "cargas"] as const) : VIAJES;
  const what =
    args.mode === "cargas"
      ? `${count(summary.cities, ["ciudad", "ciudades"])} y ` +
        `${count(summary.points, ["coordenada", "coordenadas"])} en ` +
        count(summary.changed, unit)
      : `${count(summary.points, ["punto", "puntos"])} en ${count(summary.changed, unit)}`;
  // el sujeto es lo que cambia: "cambiaría 1 punto", "cambiarían 2 ciudades y 0…"
  const many = (args.mode === "cargas" ? summary.cities : 0) + summary.points > 1;
  log("");
  log(`revisados: ${count(summary.examined, unit)}.`);
  if (summary.changed === 0) {
    log("no hay nada para cambiar.");
  } else if (args.write) {
    log(`escrito: ${what}.`);
  } else {
    const flag = Object.entries(MODE_FLAGS).find(([, mode]) => mode === args.mode)?.[0];
    log(`en seco: ${many ? "cambiarían" : "cambiaría"} ${what}. no se escribió nada.`);
    log(`para escribir: npm run seed:geocode -- ${flag ? `${flag} ` : ""}${WRITE_FLAG}`);
  }
  return summary;
}
