import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { getPublicTracking } from "../modules/trips/trips.service.js";

vi.mock("../lib/prisma", () => ({
  prisma: {
    cargoItem: { findUnique: vi.fn() },
    revokedToken: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

type Fila = {
  trackingCode: string;
  legacyTrackingCode: string | null;
  tripStatus: string;
};

const NUEVO = "TP-7K3M-Q9ZX-A2B4-HN8D";

/**
 * Simula la tabla: findUnique busca por trackingCode o por legacyTrackingCode,
 * según la clave del where, igual que la base con sus dos índices únicos.
 */
function tabla(...filas: Fila[]) {
  vi.mocked(prisma.cargoItem.findUnique).mockImplementation((async (args: {
    where: { trackingCode?: string; legacyTrackingCode?: string };
  }) => {
    const { trackingCode, legacyTrackingCode } = args.where;
    const fila = filas.find((f) =>
      trackingCode !== undefined
        ? f.trackingCode === trackingCode
        : f.legacyTrackingCode === legacyTrackingCode
    );
    if (!fila) return null;
    return {
      trackingCode: fila.trackingCode,
      legacyTrackingCode: fila.legacyTrackingCode,
      description: "cajas",
      status: "CONFIRMED",
      trip: {
        origin: "Córdoba",
        destination: "Rosario",
        date: new Date("2026-12-01T10:00:00.000Z"),
        departureTime: "08:00",
        status: fila.tripStatus,
      },
    };
  }) as never);
}

beforeEach(() => {
  vi.mocked(prisma.cargoItem.findUnique).mockReset();
});

describe("getPublicTracking (U9)", () => {
  it("encuentra la carga por su código nuevo", async () => {
    tabla({ trackingCode: NUEVO, legacyTrackingCode: "TP-AB1O-C1", tripStatus: "OPEN" });

    const tracking = await getPublicTracking(NUEVO);

    expect(tracking).toMatchObject({ trackingCode: NUEVO, cargoStatus: "CONFIRMED" });
  });

  it("acepta el código en minúsculas y con O/I/L confundidas", async () => {
    tabla({ trackingCode: NUEVO, legacyTrackingCode: null, tripStatus: "OPEN" });

    await expect(getPublicTracking("tp-7k3m-q9zx-a2b4-hn8d")).resolves.not.toBeNull();
  });

  it("devuelve null para un código que no existe", async () => {
    tabla({ trackingCode: NUEVO, legacyTrackingCode: "TP-AB1O-C1", tripStatus: "OPEN" });

    await expect(getPublicTracking("TP-0000-0000-0000-0000")).resolves.toBeNull();
    await expect(getPublicTracking("TP-AB1O-C9")).resolves.toBeNull();
  });

  it.each(["OPEN", "FULL", "IN_TRANSIT"])(
    "el código viejo sigue andando con el viaje %s y no revela el nuevo",
    async (tripStatus) => {
      tabla({ trackingCode: NUEVO, legacyTrackingCode: "TP-AB1O-C1", tripStatus });

      const tracking = await getPublicTracking("tp-ab1o-c1");

      expect(tracking?.trackingCode).toBe("TP-AB1O-C1");
      expect(JSON.stringify(tracking)).not.toContain(NUEVO);
    }
  );

  it.each(["COMPLETED", "CANCELLED"])(
    "el código viejo deja de andar cuando el viaje queda %s",
    async (tripStatus) => {
      tabla({ trackingCode: NUEVO, legacyTrackingCode: "TP-AB1O-C1", tripStatus });

      await expect(getPublicTracking("TP-AB1O-C1")).resolves.toBeNull();
      // el código nuevo de la misma carga sí sigue andando
      await expect(getPublicTracking(NUEVO)).resolves.not.toBeNull();
    }
  );

  it("no consulta la base con un código vacío o desmedido", async () => {
    await expect(getPublicTracking("   ")).resolves.toBeNull();
    await expect(getPublicTracking("X".repeat(200))).resolves.toBeNull();
    expect(prisma.cargoItem.findUnique).not.toHaveBeenCalled();
  });
});

describe("GET /api/tracking/:code", () => {
  it("200 con un código válido, sin datos de la empresa ni precios", async () => {
    tabla({ trackingCode: NUEVO, legacyTrackingCode: null, tripStatus: "IN_TRANSIT" });

    const res = await request(app).get(`/api/tracking/${NUEVO}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["cargoStatus", "description", "status", "trackingCode", "trip"].sort()
    );
    expect(Object.keys(res.body.trip).sort()).toEqual(
      ["date", "departureTime", "destination", "origin", "status"].sort()
    );
  });

  it("404 TRACKING_NOT_FOUND con un código inválido", async () => {
    tabla();

    const res = await request(app).get("/api/tracking/TP-0000-0000-0000-0000");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("TRACKING_NOT_FOUND");
  });

  it("404 con un código viejo de un viaje terminado", async () => {
    tabla({
      trackingCode: NUEVO,
      legacyTrackingCode: "TP-0K2M-C1",
      tripStatus: "COMPLETED",
    });

    const res = await request(app).get("/api/tracking/TP-0K2M-C1");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("TRACKING_NOT_FOUND");
  });
});
