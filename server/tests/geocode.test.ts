import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geocode, clearGeocodeCache, isInArgentinaBox } from "../lib/geocode.js";

// Acá se prueba el geocoder de verdad (sin vi.mock): lo que se stubea es fetch,
// así ningún test sale a Nominatim. La cola de 1 pedido por segundo usa
// setTimeout, por eso los timers son falsos y se adelantan en cada llamada.

type FetchMock = ReturnType<typeof vi.fn>;

function nominatimReply(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

let fetchMock: FetchMock;

beforeEach(() => {
  clearGeocodeCache();
  vi.useFakeTimers();
  fetchMock = vi
    .fn()
    .mockResolvedValue(nominatimReply([{ lat: "-31.4135", lon: "-64.1811" }]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function run(address: string) {
  const pending = geocode(address);
  await vi.runAllTimersAsync();
  return pending;
}

function requestedUrl(): URL {
  const [url] = fetchMock.mock.calls[0] as [URL | string];
  return new URL(String(url));
}

describe("geocode contra Nominatim", () => {
  it("limita la búsqueda a Argentina (countrycodes=ar)", async () => {
    await run("Córdoba");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestedUrl();
    expect(url.searchParams.get("countrycodes")).toBe("ar");
    // lo de siempre sigue igual
    expect(url.searchParams.get("q")).toBe("Córdoba");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("devuelve las coordenadas del primer resultado", async () => {
    await expect(run("Córdoba")).resolves.toMatchObject({ lat: -31.4135, lng: -64.1811 });
  });

  it("pide el desglose de la dirección (addressdetails=1)", async () => {
    await run("Córdoba");
    expect(requestedUrl().searchParams.get("addressdetails")).toBe("1");
  });

  it("arma el lugar en texto con ciudad, provincia y país", async () => {
    fetchMock.mockResolvedValue(
      nominatimReply([
        {
          lat: "-31.4135",
          lon: "-64.1811",
          address: {
            city: "Córdoba",
            county: "Departamento Capital",
            state: "Córdoba",
            postcode: "X5000",
            country: "Argentina",
            country_code: "ar",
          },
        },
      ])
    );

    await expect(run("Córdoba")).resolves.toEqual({
      lat: -31.4135,
      lng: -64.1811,
      label: "Córdoba, Córdoba, Argentina",
      city: "Córdoba",
    });
  });

  it("con una dirección con calle, ni la ciudad ni el texto llevan la calle", async () => {
    fetchMock.mockResolvedValue(
      nominatimReply([
        {
          lat: "-32.6986",
          lon: "-62.1036",
          address: {
            house_number: "222",
            road: "Calle Segunda",
            suburb: "Centro",
            town: "Marcos Juárez",
            state: "Córdoba",
            country: "Argentina",
          },
        },
      ])
    );

    const place = await run("Calle Segunda 222, Marcos Juárez");

    expect(place).toMatchObject({
      city: "Marcos Juárez",
      label: "Marcos Juárez, Córdoba, Argentina",
    });
    expect(JSON.stringify(place)).not.toMatch(/Segunda|222|Centro/);
  });

  it.each([
    [
      "village",
      { village: "Las Rosas", state: "Santa Fe", country: "Argentina" },
      "Las Rosas",
    ],
    [
      "municipality",
      { municipality: "Tigre", state: "Buenos Aires", country: "Argentina" },
      "Tigre",
    ],
  ])("toma la localidad de %s si no hay city ni town", async (_key, address, city) => {
    fetchMock.mockResolvedValue(nominatimReply([{ lat: "-32", lon: "-61", address }]));
    await expect(run("x")).resolves.toMatchObject({ city });
  });

  it("sin localidad: city null y el texto con lo que haya", async () => {
    fetchMock.mockResolvedValue(
      nominatimReply([
        { lat: "-38", lon: "-65", address: { state: "La Pampa", country: "Argentina" } },
      ])
    );
    await expect(run("La Pampa")).resolves.toMatchObject({
      city: null,
      label: "La Pampa, Argentina",
    });
  });

  it("sin desglose de la dirección: city y label en null", async () => {
    await expect(run("Córdoba")).resolves.toEqual({
      lat: -31.4135,
      lng: -64.1811,
      label: null,
      city: null,
    });
  });

  it("sin resultados devuelve null", async () => {
    fetchMock.mockResolvedValue(nominatimReply([]));
    await expect(run("asdlkjasd")).resolves.toBeNull();
  });
});

describe("isInArgentinaBox", () => {
  // la caja de Argentina continental (lat -55,2 a -21,7, lng -73,7 a -53,5):
  // alcanza para separar "Córdoba, Argentina" de "Córdoba, España"
  it.each([
    ["Córdoba, Argentina", { lat: -31.4135, lng: -64.1811 }, true],
    ["Ushuaia", { lat: -54.8019, lng: -68.303 }, true],
    ["La Quiaca", { lat: -22.1056, lng: -65.5969 }, true],
    ["Posadas", { lat: -27.3671, lng: -55.8961 }, true],
    ["Córdoba, España", { lat: 37.8846, lng: -4.776 }, false],
    ["Madrid", { lat: 40.4168, lng: -3.7038 }, false],
    ["Lima", { lat: -12.0464, lng: -77.0428 }, false],
  ])("%s", (_lugar, point, adentro) => {
    expect(isInArgentinaBox(point)).toBe(adentro);
  });
});
