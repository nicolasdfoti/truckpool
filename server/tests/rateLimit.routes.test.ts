import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { signToken } from "../lib/auth.js";
import { RATE_LIMITS } from "../lib/rateLimit.js";

// L5 (U15): cada ruta sensible tiene su límite montado. Los límites se crean al
// importar la app, así que cada test la recarga con RATE_LIMITS=on. Prisma
// devuelve null en todo: lo que importa es que el pedido N+1 dé 429, no qué
// responde la ruta antes (404, 400…), que también cuenta.

vi.mock("../lib/prisma", () => {
  const model = () => new Proxy({}, { get: () => vi.fn().mockResolvedValue(null) });
  return { prisma: new Proxy({}, { get: () => model() }) };
});

vi.mock("../lib/geocode.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/geocode.js")>();
  return { ...actual, geocode: vi.fn().mockResolvedValue(null) };
});

const empresa = signToken({ id: "c1", role: "COMPANY" });
const otraEmpresa = signToken({ id: "c2", role: "COMPANY" });
const fletero = signToken({ id: "u1", role: "CARRIER" });

async function appConLimites(): Promise<Express> {
  process.env.RATE_LIMITS = "on";
  vi.resetModules();
  const { app } = await import("../src/app.js");
  return app;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.RATE_LIMITS;
  vi.restoreAllMocks();
});

type Caso = {
  nombre: keyof typeof RATE_LIMITS;
  pedir: (app: Express, token: string) => request.Test;
  token: string;
};

const casos: Caso[] = [
  {
    nombre: "cargoItems",
    pedir: (app, token) =>
      request(app)
        .post("/api/trips/t1/cargo-items")
        .set("Authorization", `Bearer ${token}`)
        .send({}),
    token: empresa,
  },
  {
    nombre: "paymentPreference",
    pedir: (app, token) =>
      request(app)
        .post("/api/cargo-items/c1/payment-preference")
        .set("Authorization", `Bearer ${token}`)
        .send({}),
    token: empresa,
  },
  {
    nombre: "messages",
    pedir: (app, token) =>
      request(app)
        .post("/api/trips/t1/messages")
        .set("Authorization", `Bearer ${token}`)
        .send({}),
    token: fletero,
  },
  {
    nombre: "tripRequests",
    pedir: (app, token) =>
      request(app)
        .post("/api/users/trip-requests")
        .set("Authorization", `Bearer ${token}`)
        .send({}),
    token: empresa,
  },
  {
    nombre: "routeGeometry",
    pedir: (app, token) =>
      request(app)
        .get("/api/trips/t1/route-geometry")
        .set("Authorization", `Bearer ${token}`),
    token: fletero,
  },
  {
    nombre: "tracking",
    pedir: (app) => request(app).get("/api/tracking/TP-AAAA-BBBB-CCCC-DDDD"),
    token: "",
  },
  {
    nombre: "geocode",
    pedir: (app) => request(app).get("/api/trips/geocode"),
    token: "",
  },
  {
    nombre: "priceEstimate",
    pedir: (app) => request(app).get("/api/trips/price-estimate"),
    token: "",
  },
  {
    nombre: "cargoQuote",
    pedir: (app) => request(app).get("/api/trips/t1/cargo-quote"),
    token: "",
  },
];

describe("límites por ruta", () => {
  it.each(casos)("$nombre: el pedido N+1 da 429 RATE_LIMITED", async (caso) => {
    const app = await appConLimites();
    const { limit } = RATE_LIMITS[caso.nombre];

    for (let i = 0; i < limit; i++) {
      expect((await caso.pedir(app, caso.token)).status).not.toBe(429);
    }
    const blocked = await caso.pedir(app, caso.token);

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
  });

  it("sin RATE_LIMITS (como corre la suite) no hay 429", async () => {
    vi.resetModules();
    const { app } = await import("../src/app.js");
    for (let i = 0; i < RATE_LIMITS.tripRequests.limit + 2; i++) {
      const res = await request(app)
        .post("/api/users/trip-requests")
        .set("Authorization", `Bearer ${empresa}`)
        .send({});
      expect(res.status).not.toBe(429);
    }
  });

  it("los límites por usuario no se comparten entre usuarios", async () => {
    const app = await appConLimites();
    const pedir = (token: string) =>
      request(app)
        .post("/api/users/trip-requests")
        .set("Authorization", `Bearer ${token}`)
        .send({});

    for (let i = 0; i < RATE_LIMITS.tripRequests.limit; i++) await pedir(empresa);

    expect((await pedir(empresa)).status).toBe(429);
    expect((await pedir(otraEmpresa)).status).not.toBe(429);
  });

  it("las dos rutas de tracking comparten el contador", async () => {
    const app = await appConLimites();
    const { limit } = RATE_LIMITS.tracking;

    for (let i = 0; i < limit; i++) {
      const path =
        i % 2 === 0
          ? "/api/tracking/TP-AAAA-BBBB-CCCC-DDDD"
          : "/api/trips/tracking/TP-AAAA";
      expect((await request(app).get(path)).status).not.toBe(429);
    }

    expect((await request(app).get("/api/trips/tracking/TP-AAAA")).status).toBe(429);
    expect((await request(app).get("/api/tracking/TP-AAAA")).status).toBe(429);
  });
});
