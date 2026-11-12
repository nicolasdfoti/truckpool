import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { GeocodedPlace } from "../lib/geocode.js";
import {
  BackfillArgsError,
  parseBackfillArgs,
  runGeocodeBackfill,
} from "../prisma/geocode-backfill-lib.js";

// `npm run seed:geocode`: en seco por defecto, escribe solo con --escribir. La
// lógica recibe la base, el geocoder y el log por parámetro: acá van dobles a
// mano y ningún test sale a Nominatim.

const CORDOBA_AR: GeocodedPlace = {
  lat: -31.4135,
  lng: -64.1811,
  label: "Córdoba, Córdoba, Argentina",
  city: "Córdoba",
};
const ROSARIO: GeocodedPlace = {
  lat: -32.9442,
  lng: -60.6505,
  label: "Rosario, Santa Fe, Argentina",
  city: "Rosario",
};
const CORDOBA_ES = { lat: 37.8846, lng: -4.776 };
const MADRID = { lat: 40.4168, lng: -3.7038 };

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

function viaje(overrides: Partial<TripRow> & { id: string }): TripRow {
  return {
    origin: "Córdoba",
    destination: "Rosario",
    departureAddress: null,
    originLat: CORDOBA_AR.lat,
    originLng: CORDOBA_AR.lng,
    destLat: ROSARIO.lat,
    destLng: ROSARIO.lng,
    departureLat: null,
    departureLng: null,
    ...overrides,
  };
}

function fakeDb(trips: TripRow[]) {
  return {
    trip: {
      findMany: vi.fn(async () => trips),
      update: vi.fn(async () => ({})),
    },
    cargoItem: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
  };
}

/** geocoder de mentira: responde por texto exacto, y null si no lo conoce */
function fakeGeocode(places: Record<string, GeocodedPlace | null>) {
  return vi.fn(async (address: string) => places[address] ?? null);
}

async function run(
  argv: string[],
  db: ReturnType<typeof fakeDb>,
  geocode: ReturnType<typeof fakeGeocode>
) {
  const lines: string[] = [];
  const summary = await runGeocodeBackfill(parseBackfillArgs(argv), {
    db: db as unknown as PrismaClient,
    geocode,
    log: (line) => lines.push(line),
  });
  return { summary, output: lines.join("\n") };
}

describe("parseBackfillArgs", () => {
  it("sin flags: viajes sin coordenadas, en seco", () => {
    expect(parseBackfillArgs([])).toEqual({ mode: "sin-coordenadas", write: false });
  });

  it("--fuera-de-ar en seco y con --escribir", () => {
    expect(parseBackfillArgs(["--fuera-de-ar"])).toEqual({
      mode: "fuera-de-ar",
      write: false,
    });
    expect(parseBackfillArgs(["--fuera-de-ar", "--escribir"])).toEqual({
      mode: "fuera-de-ar",
      write: true,
    });
  });

  it("una opción desconocida aborta en vez de correr otro modo", () => {
    expect(() => parseBackfillArgs(["--write"])).toThrow(BackfillArgsError);
    expect(() => parseBackfillArgs(["--fuera-de-ar", "--escribri"])).toThrow(
      /--escribri/
    );
  });
});

describe("seed:geocode --fuera-de-ar", () => {
  it("en seco muestra antes → después y no escribe", async () => {
    const db = fakeDb([
      viaje({ id: "t-es", originLat: CORDOBA_ES.lat, originLng: CORDOBA_ES.lng }),
    ]);
    const geocode = fakeGeocode({ Córdoba: CORDOBA_AR });

    const { summary, output } = await run(["--fuera-de-ar"], db, geocode);

    expect(db.trip.update).not.toHaveBeenCalled();
    expect(output).toContain("t-es");
    expect(output).toContain("37.8846, -4.7760");
    expect(output).toContain("Córdoba, Córdoba, Argentina (-31.4135, -64.1811)");
    expect(output).toMatch(/en seco/);
    expect(output).toContain("--fuera-de-ar --escribir");
    expect(summary).toMatchObject({ trips: 1, points: 1, written: false });
  });

  it("con --escribir actualiza solo el punto que estaba afuera", async () => {
    const db = fakeDb([
      viaje({ id: "t-es", originLat: CORDOBA_ES.lat, originLng: CORDOBA_ES.lng }),
    ]);
    const geocode = fakeGeocode({ Córdoba: CORDOBA_AR });

    await run(["--fuera-de-ar", "--escribir"], db, geocode);

    expect(geocode).toHaveBeenCalledTimes(1);
    expect(db.trip.update).toHaveBeenCalledTimes(1);
    expect(db.trip.update).toHaveBeenCalledWith({
      where: { id: "t-es" },
      data: { originLat: CORDOBA_AR.lat, originLng: CORDOBA_AR.lng },
    });
  });

  it("no toca los viajes con todos sus puntos dentro de Argentina", async () => {
    const db = fakeDb([
      viaje({ id: "t-ok" }),
      viaje({ id: "t-sin", destLat: null, destLng: null }),
    ]);
    const geocode = fakeGeocode({});

    const { summary } = await run(["--fuera-de-ar", "--escribir"], db, geocode);

    expect(geocode).not.toHaveBeenCalled();
    expect(db.trip.update).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ trips: 0, points: 0 });
  });

  it("sin match en Argentina el punto queda en null", async () => {
    const db = fakeDb([
      viaje({
        id: "t-madrid",
        destination: "Madrid",
        destLat: MADRID.lat,
        destLng: MADRID.lng,
      }),
    ]);
    const geocode = fakeGeocode({});

    const { output } = await run(["--fuera-de-ar", "--escribir"], db, geocode);

    expect(db.trip.update).toHaveBeenCalledWith({
      where: { id: "t-madrid" },
      data: { destLat: null, destLng: null },
    });
    expect(output).toMatch(/queda sin coordenadas/);
  });

  it("un resultado que cae fuera de la caja tampoco se usa", async () => {
    const db = fakeDb([
      viaje({ id: "t-es", originLat: CORDOBA_ES.lat, originLng: CORDOBA_ES.lng }),
    ]);
    const geocode = fakeGeocode({ Córdoba: { ...CORDOBA_ES, label: null, city: null } });

    await run(["--fuera-de-ar", "--escribir"], db, geocode);

    expect(db.trip.update).toHaveBeenCalledWith({
      where: { id: "t-es" },
      data: { originLat: null, originLng: null },
    });
  });

  it("el punto de salida se re-geocodifica desde su propia dirección", async () => {
    const db = fakeDb([
      viaje({
        id: "t-salida",
        departureAddress: "Galpón Av. Circunvalación 5000, Córdoba",
        departureLat: CORDOBA_ES.lat,
        departureLng: CORDOBA_ES.lng,
      }),
    ]);
    const geocode = fakeGeocode({
      "Galpón Av. Circunvalación 5000, Córdoba": {
        ...CORDOBA_AR,
        lat: -31.45,
        lng: -64.2,
      },
    });

    await run(["--fuera-de-ar", "--escribir"], db, geocode);

    expect(geocode).toHaveBeenCalledWith("Galpón Av. Circunvalación 5000, Córdoba");
    expect(db.trip.update).toHaveBeenCalledWith({
      where: { id: "t-salida" },
      data: { departureLat: -31.45, departureLng: -64.2 },
    });
  });
});

describe("seed:geocode sin flags (viajes sin coordenadas)", () => {
  it("en seco geocodifica solo los puntos que faltan y no escribe", async () => {
    const db = fakeDb([viaje({ id: "t-sin", destLat: null, destLng: null })]);
    const geocode = fakeGeocode({ Rosario: ROSARIO });

    const { output, summary } = await run([], db, geocode);

    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode).toHaveBeenCalledWith("Rosario");
    expect(db.trip.update).not.toHaveBeenCalled();
    expect(output).toContain("Rosario, Santa Fe, Argentina (-32.9442, -60.6505)");
    expect(summary).toMatchObject({ trips: 1, points: 1, written: false });
  });

  it("con --escribir guarda lo que resolvió y deja en null lo que no", async () => {
    const db = fakeDb([
      viaje({
        id: "t-sin",
        origin: "Pueblo Inventado",
        originLat: null,
        originLng: null,
        destLat: null,
        destLng: null,
      }),
    ]);
    const geocode = fakeGeocode({ Rosario: ROSARIO });

    const { output } = await run(["--escribir"], db, geocode);

    expect(db.trip.update).toHaveBeenCalledWith({
      where: { id: "t-sin" },
      data: { destLat: ROSARIO.lat, destLng: ROSARIO.lng },
    });
    expect(output).toMatch(/Pueblo Inventado.*sigue sin coordenadas/);
  });
});
