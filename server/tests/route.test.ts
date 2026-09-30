import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTripRoute,
  getTripRouteGeometry,
  clearRouteGeometryCache,
  routeGeometryCacheSize,
} from "../modules/trips/trips.service.js";
import { fetchRouteGeometry } from "../lib/routing.js";
import { TripNotFoundError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { geocode } from "../lib/geocode.js";

// El service importa geocode (para createTrip) y fetchRouteGeometry (para la
// geometría). Los dos van mockeados: los tests no pegan a Nominatim ni a OSRM.
vi.mock("../lib/geocode.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/geocode.js")>();
  return { ...actual, geocode: vi.fn().mockResolvedValue(null) };
});

vi.mock("../lib/routing.js", () => ({
  fetchRouteGeometry: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    trip: { findUnique: vi.fn(), create: vi.fn() },
    cargoItem: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

type Mock = ReturnType<typeof vi.fn>;

/**
 * Un viaje Córdoba → Rosario: el origen general está en el centro de Córdoba y
 * el destino en Rosario. Las paradas se colocan a lo largo de la línea para que
 * la proyección de calculateStopOrder las ordene de forma predecible.
 */
function routeTrip(overrides: Record<string, unknown> = {}) {
  return {
    origin: "Córdoba",
    destination: "Rosario",
    originLat: -31.4201,
    originLng: -64.1888,
    destLat: -32.9442,
    destLng: -60.6505,
    departureAddress: null,
    departureLat: null,
    departureLng: null,
    cargoItems: [],
    ...overrides,
  };
}

function cargoItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    // San Francisco (Córdoba): está sobre la línea Córdoba→Rosario, cerca del
    // origen. Las coordenadas de los fixtures salen de la geometría real para
    // que la proyección de calculateStopOrder ordene como espera el test.
    pickupAddress: "San Francisco",
    pickupLat: -31.923,
    pickupLng: -63.021,
    trackingCode: "TP-T1-C1",
    description: "cajas",
    stopOrder: null,
    ...overrides,
  };
}

function mockTrip(row: unknown) {
  (prisma.trip.findUnique as unknown as Mock).mockResolvedValue(row);
}

/**
 * El punto en esa posición del recorrido. Con noUncheckedIndexedAccess, y a
 * propósito: si un test espera el punto 2 y el recorrido viene más corto, que
 * reviente acá con un mensaje claro en vez de comparar contra `undefined`.
 */
function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`no hay elemento en la posición ${index} (hay ${items.length})`);
  }
  return item;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearRouteGeometryCache();
});

afterEach(() => {
  clearRouteGeometryCache();
});

describe("getTripRoute", () => {
  it("devuelve partida, paradas y destino en orden", async () => {
    // dos pickups sobre la línea Córdoba→Rosario: el más cercano al origen va
    // primero, y eso lo decide la proyección, no el orden de creación
    mockTrip(
      routeTrip({
        cargoItems: [
          cargoItem({ id: "i1", pickupAddress: "San Francisco" }),
          cargoItem({
            id: "i2",
            pickupAddress: "San Nicolás",
            pickupLat: -32.426,
            pickupLng: -61.853,
          }),
        ],
      })
    );

    const route = await getTripRoute("t1");

    expect(route.tripId).toBe("t1");
    expect(route.points.map((p) => p.kind)).toEqual([
      "DEPARTURE",
      "PICKUP",
      "PICKUP",
      "DESTINATION",
    ]);
    expect(route.points.map((p) => p.order)).toEqual([1, 2, 3, 4]);
    expect(at(route.points, 1).address).toBe("San Francisco");
    expect(at(route.points, 2).address).toBe("San Nicolás");
    expect(at(route.points, 3).address).toBe("Rosario");
  });

  it("usa el punto exacto de partida cuando el fletero lo indicó", async () => {
    mockTrip(
      routeTrip({
        departureAddress: "Av. Colón 1234, Córdoba",
        departureLat: -31.4189,
        departureLng: -64.1811,
      })
    );

    const route = await getTripRoute("t1");

    expect(route.departureIsExact).toBe(true);
    expect(at(route.points, 0).kind).toBe("DEPARTURE");
    expect(at(route.points, 0).address).toBe("Av. Colón 1234, Córdoba");
    expect(at(route.points, 0).lat).toBe(-31.4189);
    expect(at(route.points, 0).lng).toBe(-64.1811);
  });

  it("cae al origin general si el departureAddress vino sin coordenadas", async () => {
    // el fletero escribió la dirección pero el geocode no la resolvió
    mockTrip(routeTrip({ departureAddress: "galpón sin geocodificar" }));

    const route = await getTripRoute("t1");

    expect(route.departureIsExact).toBe(false);
    expect(at(route.points, 0).address).toBe("Córdoba");
    expect(at(route.points, 0).lat).toBe(-31.4201);
  });

  it("respeta el stopOrder manual por sobre la proyección automática", async () => {
    mockTrip(
      routeTrip({
        cargoItems: [
          // i1 está más cerca del origen, pero el fletero lo puso segundo
          cargoItem({ id: "i1", pickupAddress: "San Francisco", stopOrder: 2 }),
          cargoItem({
            id: "i2",
            pickupAddress: "San Nicolás",
            pickupLat: -32.426,
            pickupLng: -61.853,
            stopOrder: 1,
          }),
        ],
      })
    );

    const route = await getTripRoute("t1");

    expect(at(route.points, 1).address).toBe("San Nicolás");
    expect(at(route.points, 2).address).toBe("San Francisco");
  });

  it("deja fuera las paradas sin coordenadas y avisa con incomplete", async () => {
    mockTrip(
      routeTrip({
        cargoItems: [
          cargoItem({ id: "i1", pickupAddress: "San Francisco" }),
          // geocode caído: sin lat/lng no hay nada que dibujar
          cargoItem({ id: "i2", pickupAddress: "lugar inexistente", pickupLat: null }),
        ],
      })
    );

    const route = await getTripRoute("t1");

    expect(route.points.map((p) => p.address)).not.toContain("lugar inexistente");
    expect(route.incomplete).toBe(true);
    // la numeración sigue siendo correlativa de lo que sí se dibujó
    expect(route.points.map((p) => p.order)).toEqual([1, 2, 3]);
  });

  it("sin pickup: solo partida y destino", async () => {
    mockTrip(routeTrip());

    const route = await getTripRoute("t1");

    expect(route.points).toHaveLength(2);
    expect(route.incomplete).toBe(false);
  });

  it("devuelve la carga y el tracking code de cada parada", async () => {
    mockTrip(
      routeTrip({ cargoItems: [cargoItem({ id: "i1", trackingCode: "TP-T1-C7" })] })
    );

    const route = await getTripRoute("t1");

    expect(at(route.points, 1).cargoItemId).toBe("i1");
    expect(at(route.points, 1).trackingCode).toBe("TP-T1-C7");
  });

  it("lanza TripNotFoundError si el viaje no existe", async () => {
    mockTrip(null);

    await expect(getTripRoute("nope")).rejects.toBeInstanceOf(TripNotFoundError);
  });
});

describe("getTripRouteGeometry", () => {
  /** el service lee el status y después los puntos: el mismo id devuelve ambos */
  function mockTripWithStatus(row: unknown) {
    (prisma.trip.findUnique as unknown as Mock).mockResolvedValue(row);
  }

  beforeEach(() => {
    clearRouteGeometryCache();
  });

  it("pasa los puntos en orden a OSRM y devuelve la geometría", async () => {
    mockTripWithStatus(
      routeTrip({
        status: "OPEN",
        cargoItems: [cargoItem({ id: "i1", pickupAddress: "San Francisco" })],
      })
    );
    vi.mocked(fetchRouteGeometry).mockResolvedValue([
      [-64.1888, -31.4201],
      [-64.2, -32.1],
      [-60.6505, -32.9442],
    ]);

    const geometry = await getTripRouteGeometry("t1");

    expect(geometry).toEqual([
      [-64.1888, -31.4201],
      [-64.2, -32.1],
      [-60.6505, -32.9442],
    ]);
    // OSRM recibe los tres puntos del recorrido, en orden: partida, parada, destino
    expect(vi.mocked(fetchRouteGeometry)).toHaveBeenCalledWith([
      { lat: -31.4201, lng: -64.1888 },
      { lat: -31.923, lng: -63.021 },
      { lat: -32.9442, lng: -60.6505 },
    ]);
  });

  it("devuelve null sin llamar a OSRM cuando hay menos de dos puntos", async () => {
    mockTripWithStatus({
      ...routeTrip({ status: "OPEN" }),
      originLat: null,
      originLng: null,
      destLat: null,
      destLng: null,
    });

    const geometry = await getTripRouteGeometry("t1");

    expect(geometry).toBeNull();
    expect(fetchRouteGeometry).not.toHaveBeenCalled();
  });

  it("cachea la geometría mientras el viaje no cambia", async () => {
    mockTripWithStatus(routeTrip({ status: "OPEN" }));
    vi.mocked(fetchRouteGeometry).mockResolvedValue([
      [-64.1, -31.4],
      [-60.6, -32.9],
    ]);

    await getTripRouteGeometry("t1");
    await getTripRouteGeometry("t1");
    await getTripRouteGeometry("t1");

    // tres requests al endpoint, un solo fetch a OSRM
    expect(fetchRouteGeometry).toHaveBeenCalledTimes(1);
  });

  it("vuelve a pedir la geometría si cambia el estado del viaje", async () => {
    mockTripWithStatus(routeTrip({ status: "OPEN" }));
    vi.mocked(fetchRouteGeometry).mockResolvedValue([
      [-64.1, -31.4],
      [-60.6, -32.9],
    ]);
    await getTripRouteGeometry("t1");

    mockTripWithStatus(routeTrip({ status: "IN_TRANSIT" }));
    await getTripRouteGeometry("t1");

    expect(fetchRouteGeometry).toHaveBeenCalledTimes(2);
  });

  it("vuelve a pedir la geometría si entra una carga nueva", async () => {
    mockTripWithStatus(routeTrip({ status: "OPEN" }));
    vi.mocked(fetchRouteGeometry).mockResolvedValue([
      [-64.1, -31.4],
      [-60.6, -32.9],
    ]);
    await getTripRouteGeometry("t1");

    mockTripWithStatus(
      routeTrip({ status: "OPEN", cargoItems: [cargoItem({ id: "i1" })] })
    );
    await getTripRouteGeometry("t1");

    expect(fetchRouteGeometry).toHaveBeenCalledTimes(2);
  });

  it("devuelve null y no rompe si OSRM no respondió", async () => {
    mockTripWithStatus(routeTrip({ status: "OPEN" }));
    vi.mocked(fetchRouteGeometry).mockResolvedValue(null);

    const geometry = await getTripRouteGeometry("t1");

    expect(geometry).toBeNull();
  });

  it("no vuelve a pegarle a OSRM en cada request cuando la ruta falla siempre", async () => {
    mockTripWithStatus(routeTrip({ status: "OPEN" }));
    vi.mocked(fetchRouteGeometry).mockResolvedValue(null);

    await getTripRouteGeometry("t1");
    await getTripRouteGeometry("t1");

    // un null también se cachea: repetir el fetch solo gasta llamadas
    expect(fetchRouteGeometry).toHaveBeenCalledTimes(1);
  });

  it("la caché no crece sin límite", async () => {
    mockTripWithStatus(routeTrip({ status: "OPEN" }));
    vi.mocked(fetchRouteGeometry).mockResolvedValue([
      [-64.1, -31.4],
      [-60.6, -32.9],
    ]);

    for (let i = 0; i < 520; i++) {
      (prisma.trip.findUnique as unknown as Mock).mockResolvedValue(
        routeTrip({ status: "OPEN", id: `t${i}` })
      );
      await getTripRouteGeometry(`t${i}`);
    }

    expect(routeGeometryCacheSize()).toBeLessThanOrEqual(500);
  });

  it("lanza TripNotFoundError si el viaje no existe", async () => {
    mockTripWithStatus(null);

    await expect(getTripRouteGeometry("nope")).rejects.toBeInstanceOf(TripNotFoundError);
  });
});

describe("fetchRouteGeometry (mockeado, sin tocar la red)", () => {
  it("el mock del módulo devuelve la geometría configurada", async () => {
    // este test documenta que la suite NUNCA pega al demo público de OSRM:
    // si alguien desmockea, esta aserción falla y se nota enseguida.
    vi.mocked(fetchRouteGeometry).mockResolvedValue([
      [1, 2],
      [3, 4],
    ]);

    await expect(fetchRouteGeometry([{ lat: 1, lng: 2 }])).resolves.toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
  it("pide la geometría con el parámetro que OSRM entiende", async () => {
    // El service está mockeado arriba, así que acá probamos la URL real que arma
    // lib/routing.ts. Con "geometry" (sin la s) OSRM responde 400 InvalidQuery y
    // el mapa cae al fallback recto en silencio: este test lo hace visible.
    const fetchMock = vi.fn(
      async (_input: URL | string | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            code: "Ok",
            routes: [
              {
                geometry: {
                  coordinates: [
                    [-64.1888, -31.4201],
                    [-60.6505, -32.9442],
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    // import real: el describe de arriba mockea el módulo, hay que desmockearlo
    const actual =
      await vi.importActual<typeof import("../lib/routing.js")>("../lib/routing.js");
    const geometry = await actual.fetchRouteGeometry([
      { lat: -31.4201, lng: -64.1888 },
      { lat: -32.9442, lng: -60.6505 },
    ]);

    expect(geometry).toEqual([
      [-64.1888, -31.4201],
      [-60.6505, -32.9442],
    ]);
    const called = fetchMock.mock.calls[0]?.[0] as URL;
    expect(called.searchParams.get("geometries")).toBe("geojson");
    expect(called.searchParams.has("geometry")).toBe(false);
    expect(called.pathname).toBe("/route/v1/driving/-64.1888,-31.4201;-60.6505,-32.9442");
    vi.unstubAllGlobals();
  });

  it("devuelve null si OSRM responde 400, sin romper la pantalla", async () => {
    // mismo camino real: el service nunca ve el error, solo decide qué dibujar
    const actual =
      await vi.importActual<typeof import("../lib/routing.js")>("../lib/routing.js");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "InvalidQuery" }), { status: 400 })
      )
    );

    await expect(
      actual.fetchRouteGeometry([
        { lat: -31.4201, lng: -64.1888 },
        { lat: -32.9442, lng: -60.6505 },
      ])
    ).resolves.toBeNull();

    vi.unstubAllGlobals();
  });
});

describe("endpoints HTTP del recorrido (públicos)", () => {
  // A diferencia del resto de la suite, acá se levanta el app real: lo que se
  // prueba es que /route y /route-geometry están montados y no piden auth.
  // Prisma, geocode y routing ya están mockeados para toda la suite.
  async function http() {
    const { app } = await import("../src/app.js");
    const request = (await import("supertest")).default;
    return { app, request };
  }

  it("GET /api/trips/:id/route responde el recorrido sin token", async () => {
    mockTrip(routeTrip({ cargoItems: [cargoItem({ id: "i1" })] }));
    const { app, request } = await http();

    const res = await request(app).get("/api/trips/t1/route");

    expect(res.status).toBe(200);
    expect(res.body.tripId).toBe("t1");
    expect(res.body.points).toHaveLength(3);
    expect(res.body.points[0]).toMatchObject({ order: 1, kind: "DEPARTURE" });
  });

  it("GET /api/trips/:id/route-geometry responde { geometry } sin token", async () => {
    mockTrip(routeTrip({ status: "OPEN", cargoItems: [cargoItem({ id: "i1" })] }));
    vi.mocked(fetchRouteGeometry).mockResolvedValue([
      [-64.1888, -31.4201],
      [-60.6505, -32.9442],
    ]);
    const { app, request } = await http();

    const res = await request(app).get("/api/trips/t1/route-geometry");

    expect(res.status).toBe(200);
    expect(res.body.geometry).toEqual([
      [-64.1888, -31.4201],
      [-60.6505, -32.9442],
    ]);
  });

  it("route-geometry responde 200 con geometry null cuando OSRM no está", async () => {
    // el front distingue "sin geometría" de "error": si esto fuera un 500, la
    // pantalla del recorrido se rompería en vez de dibujar rectas.
    mockTrip(routeTrip({ status: "OPEN", cargoItems: [cargoItem({ id: "i1" })] }));
    vi.mocked(fetchRouteGeometry).mockResolvedValue(null);
    const { app, request } = await http();

    const res = await request(app).get("/api/trips/t1/route-geometry");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ geometry: null });
  });

  it("responde 404 si el viaje no existe", async () => {
    mockTrip(null);
    const { app, request } = await http();

    await expect(request(app).get("/api/trips/nope/route")).resolves.toMatchObject({
      status: 404,
    });
  });
});

describe("createTrip y el punto exacto de salida", () => {
  it("no bloquea la creación si el geocode del departureAddress falla", async () => {
    // geocode nunca throw: su forma de fallar es devolver null. El viaje se crea
    // igual, con el punto exacto guardado pero sin coordenadas.
    vi.mocked(geocode).mockResolvedValue(null);
    (prisma.user.findUnique as unknown as Mock).mockResolvedValue({
      verificationStatus: "VERIFIED",
      mpUserId: "mp-1",
    });
    (prisma.trip.create as unknown as Mock).mockResolvedValue({
      ...routeTrip({ status: "OPEN", carrierId: "u1" }),
      departureAddress: "galpón sin geocodificar",
      departureLat: null,
      departureLng: null,
      depositPercent: 20,
      platformFeePercent: 10,
      cargoItems: [],
      carrier: { name: "Flete" },
    });

    const { createTrip } = await import("../modules/trips/trips.service.js");
    const trip = await createTrip("u1", {
      origin: "Córdoba",
      destination: "Rosario",
      departureAddress: "galpón sin geocodificar",
      date: new Date("2026-10-01T10:00:00.000Z"),
      truckType: "Semi",
      capacityTotal: 30,
      price: 1500,
      depositPercent: 20,
      features: [],
    });

    // el geocode se intentó (best-effort) y el viaje se creó igual
    expect(geocode).toHaveBeenCalledWith("galpón sin geocodificar");
    expect(trip.departureAddress).toBe("galpón sin geocodificar");
    expect(trip.departureLat).toBeNull();
  });

  it("guarda las coordenadas del departureAddress cuando el geocode responde", async () => {
    // el geocode distingue direcciones por argumento: el punto exacto resuelve,
    // el origen y el destino también, y cada uno va a su columna.
    vi.mocked(geocode).mockImplementation(async (address: string) => {
      if (address === "Av. Colón 1234, Córdoba") return { lat: -31.4189, lng: -64.1811 };
      if (address === "Córdoba") return { lat: -31.4201, lng: -64.1888 };
      return { lat: -32.9442, lng: -60.6505 };
    });
    (prisma.user.findUnique as unknown as Mock).mockResolvedValue({
      verificationStatus: "VERIFIED",
      mpUserId: "mp-1",
    });
    (prisma.trip.create as unknown as Mock).mockResolvedValue({
      ...routeTrip({ status: "OPEN", carrierId: "u1" }),
      departureAddress: "Av. Colón 1234, Córdoba",
      departureLat: -31.4189,
      departureLng: -64.1811,
      depositPercent: 20,
      platformFeePercent: 10,
      cargoItems: [],
      carrier: { name: "Flete" },
    });

    const { createTrip } = await import("../modules/trips/trips.service.js");
    await createTrip("u1", {
      origin: "Córdoba",
      destination: "Rosario",
      departureAddress: "Av. Colón 1234, Córdoba",
      date: new Date("2026-10-01T10:00:00.000Z"),
      truckType: "Semi",
      capacityTotal: 30,
      // con coordenadas reales entra la validación de rango: 374 km pide
      // ~$186.500 para un Semi.
      price: 186_500,
      depositPercent: 20,
      features: [],
    });

    // el punto exacto se persiste, y no pisa las coordenadas del origen general
    expect(vi.mocked(prisma.trip.create).mock.calls[0]?.[0]).toMatchObject({
      data: {
        departureAddress: "Av. Colón 1234, Córdoba",
        departureLat: -31.4189,
        departureLng: -64.1811,
        originLat: -31.4201,
        originLng: -64.1888,
      },
    });
  });
});
