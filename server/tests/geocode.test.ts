import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geocode, clearGeocodeCache } from "../lib/geocode.js";

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

  it("sin resultados devuelve null", async () => {
    fetchMock.mockResolvedValue(nominatimReply([]));
    await expect(run("asdlkjasd")).resolves.toBeNull();
  });
});
