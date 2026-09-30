import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import type { Trip, User } from "@prisma/client";
import { createHmac } from "node:crypto";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { signOAuthState, signToken, verifyOAuthState } from "../lib/auth.js";
import * as mp from "../lib/mercadopago.js";
import { encryptSecret } from "../lib/crypto.js";
import { geocode } from "../lib/geocode.js";
import { createTrip } from "../modules/trips/trips.service.js";
import { calculateSuggestedPrice } from "../lib/pricing.js";
import { AppError } from "../lib/errors.js";
import { quoteCancellation, hoursUntilTrip } from "../lib/cancellation.js";

// el token del transportista llega a la base cifrado (ver OAuth), así que los
// mocks usan un sobre real y no un string suelto
const MP_TOKEN_STORED = encryptSecret("APP_USR-mp-token-plano");

// por defecto no hay reservas vencidas ni cargas para notificar: las rutas
// leen CargoItem.findMany por la limpieza perezosa de reservas.
beforeEach(() => {
  vi.mocked(prisma.cargoItem.findMany).mockResolvedValue([]);
});

vi.mock("../lib/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mercadopago.js")>();
  return {
    ...actual,
    createCheckoutPreference: vi.fn(),
    createTestPreference: vi.fn(),
    fetchPaymentState: vi.fn(),
    refundPayment: vi.fn(),
  };
});

// los tests no pegan a Nominatim
// los avisos son best-effort: en los tests de HTTP solo importa que el endpoint
// no se caiga por ellos
vi.mock("../lib/notifications.js", () => ({
  notifyUsers: vi.fn().mockResolvedValue(1),
}));

vi.mock("../lib/geocode.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/geocode.js")>();
  return { ...actual, geocode: vi.fn().mockResolvedValue(null) };
});

vi.mock("../lib/prisma", () => ({
  prisma: {
    trip: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    cargoItem: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      aggregate: vi.fn(),
    },
    review: {
      findUnique: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    notification: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    tripLocation: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    // requireAuth consulta la lista de revocados en cada request autenticado.
    // Por defecto findUnique devuelve undefined (no revocado), así que los
    // tests que no van de logout siguen viendo el token como válido.
    revokedToken: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    refundRequest: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const carrierToken = signToken({ id: "u1", role: "CARRIER" });
const companyToken = signToken({ id: "u2", role: "COMPANY" });
const strangerToken = signToken({ id: "u9", role: "COMPANY" });
const adminToken = signToken({ id: "u0", role: "ADMIN" });

describe("app", () => {
  it("GET /api/trips devuelve 200 con lista de viajes", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValue([]);
    const res = await request(app).get("/api/trips");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("devuelve 404 para rutas inexistentes", async () => {
    const res = await request(app).get("/api/no-existe");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "ruta no encontrada", code: "NOT_FOUND" });
  });

  it("rechaza registro con body inválido (400)", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "no" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /:id/cargo-items requiere token (401)", async () => {
    const res = await request(app).post("/api/trips/t1/cargo-items").send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });
});

describe("auth /me", () => {
  it("requiere token (401)", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("devuelve el usuario autenticado (200)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "flete@truckpool.app",
      name: "Transportes Flete",
      role: "CARRIER",
      password: "hash",
      bio: null,
      phone: null,
      taxId: "20345678901",
      verificationStatus: "VERIFIED",
      verificationNote: null,
      emailNotifications: true,
      isAvailableNow: true,
      mpUserId: "mp-user-123",
      mpAccessToken: MP_TOKEN_STORED,
      createdAt: new Date(),
    });
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${carrierToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: "u1",
      email: "flete@truckpool.app",
      name: "Transportes Flete",
      role: "CARRIER",
    });
  });
});

describe("POST /api/trips", () => {
  const validBody = {
    origin: "Córdoba",
    destination: "Rosario",
    date: "2026-10-01T10:00:00.000Z",
    truckType: "Semi",
    capacityTotal: 30,
    price: 1500,
  };

  it("requiere token (401)", async () => {
    const res = await request(app).post("/api/trips").send(validBody);
    expect(res.status).toBe(401);
  });

  it("rechaza a un rol sin permiso (403)", async () => {
    const res = await request(app)
      .post("/api/trips")
      .set("Authorization", `Bearer ${companyToken}`)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("rechaza body inválido (400)", async () => {
    const res = await request(app)
      .post("/api/trips")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ origin: "", capacityTotal: 0 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rechaza una hora de salida inválida (400)", async () => {
    // "25:00" tiene que ser un 400: si lo normalizamos con Date, el cliente
    // creería que publicó un viaje a la 1am del día siguiente.
    for (const departureTime of ["25:00", "8:30", "08:60", "mañana", "08:30:00"]) {
      const res = await request(app)
        .post("/api/trips")
        .set("Authorization", `Bearer ${carrierToken}`)
        .send({ ...validBody, departureTime });
      expect(res.status, departureTime).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    }
    expect(prisma.trip.create).not.toHaveBeenCalled();
  });

  it("acepta la hora de salida en HH:mm y la guarda (201)", async () => {
    const createdTrip = {
      id: "t-hora",
      origin: "Córdoba",
      destination: "Rosario",
      date: new Date("2026-10-01T10:00:00.000Z"),
      departureTime: "06:30",
      truckType: "Semi",
      capacityTotal: 30,
      price: new Prisma.Decimal("1500"),
      status: "OPEN",
      createdAt: new Date(),
      carrierId: "u1",
      features: [],
      cargoItems: [],
    } as unknown as Trip;
    vi.mocked(prisma.trip.create).mockResolvedValue(createdTrip);

    const res = await request(app)
      .post("/api/trips")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ ...validBody, departureTime: "06:30" });

    expect(res.status).toBe(201);
    expect(prisma.trip.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ departureTime: "06:30" }),
      })
    );
    expect(res.body.departureTime).toBe("06:30");
  });

  it("publica sin hora de salida cuando el fletero no la carga (201)", async () => {
    const createdTrip = {
      id: "t-sin-hora",
      origin: "Córdoba",
      destination: "Rosario",
      date: new Date("2026-10-01T10:00:00.000Z"),
      departureTime: null,
      truckType: "Semi",
      capacityTotal: 30,
      price: new Prisma.Decimal("1500"),
      status: "OPEN",
      createdAt: new Date(),
      carrierId: "u1",
      features: [],
      cargoItems: [],
    } as unknown as Trip;
    vi.mocked(prisma.trip.create).mockResolvedValue(createdTrip);

    const res = await request(app)
      .post("/api/trips")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send(validBody);

    expect(res.status).toBe(201);
    // null y no "" ni undefined: la columna es nullable y el cliente decide
    // si mostrar la hora o no
    expect(prisma.trip.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ departureTime: null }),
      })
    );
    expect(res.body.departureTime).toBeNull();
  });

  it("rechaza features fuera del set permitido (400)", async () => {
    const res = await request(app)
      .post("/api/trips")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ ...validBody, features: ["hack"] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("crea un viaje con features válidos (201)", async () => {
    const createdTrip = {
      id: "t-feat",
      origin: "Córdoba",
      destination: "Rosario",
      date: new Date("2026-10-01T10:00:00.000Z"),
      truckType: "Semi",
      capacityTotal: 30,
      price: new Prisma.Decimal("1500"),
      status: "OPEN",
      createdAt: new Date(),
      carrierId: "u1",
      features: ["seguro", "expreso"],
      cargoItems: [],
    } as unknown as Trip;
    vi.mocked(prisma.trip.create).mockResolvedValue(createdTrip);

    const res = await request(app)
      .post("/api/trips")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ ...validBody, features: ["seguro", "expreso"] });
    expect(res.status).toBe(201);
    expect(prisma.trip.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ features: ["seguro", "expreso"] }),
      })
    );
    expect(res.body.features).toEqual(["seguro", "expreso"]);
  });

  it("crea un viaje cuando es un CARRIER (201)", async () => {
    const createdTrip = {
      id: "t-new",
      origin: "Córdoba",
      destination: "Rosario",
      date: new Date("2026-10-01T10:00:00.000Z"),
      truckType: "Semi",
      capacityTotal: 30,
      price: new Prisma.Decimal("1500"),
      status: "OPEN",
      createdAt: new Date(),
      carrierId: "u1",
      features: [],
      cargoItems: [],
    } as unknown as Trip;
    vi.mocked(prisma.trip.create).mockResolvedValue(createdTrip);

    const res = await request(app)
      .post("/api/trips")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "t-new", origin: "Córdoba", price: 1500 });
    expect(prisma.trip.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          carrierId: "u1",
          price: expect.any(Prisma.Decimal),
        }),
      })
    );
  });
});

describe("GET /api/trips con filtros", () => {
  it("combina origin y features en el where (200)", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValue([]);

    const res = await request(app).get(
      "/api/trips?origin=rosario&features=seguro&features=expreso"
    );

    expect(res.status).toBe(200);
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "OPEN",
          origin: { contains: "rosario", mode: "insensitive" },
          features: { hasEvery: ["seguro", "expreso"] },
        },
      })
    );
  });

  it("sin query params mantiene el where por defecto", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValue([]);

    const res = await request(app).get("/api/trips");

    expect(res.status).toBe(200);
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "OPEN" } })
    );
  });

  it("ignora origin vacío", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValue([]);

    const res = await request(app).get("/api/trips?origin=");

    expect(res.status).toBe(200);
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "OPEN" } })
    );
  });

  it("traduce el rango de fechas", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValue([]);

    const res = await request(app).get(
      "/api/trips?dateFrom=2026-10-01&dateTo=2026-10-31"
    );

    expect(res.status).toBe(200);
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "OPEN",
          date: {
            gte: new Date("2026-10-01T00:00:00.000Z"),
            lte: new Date("2026-10-31T23:59:59.999Z"),
          },
        },
      })
    );
  });

  it("rechaza features inválidas (400)", async () => {
    const res = await request(app).get("/api/trips?features=hack");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rechaza fechas inválidas (400)", async () => {
    const res = await request(app).get("/api/trips?dateFrom=lalala");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

function signedWebhook(dataId: string, secret: string, requestId = "req-1") {
  const ts = "1756200000";
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
}

describe("DELETE /api/trips/:tripId/cargo-items/:id", () => {
  const cargoItem = {
    id: "i1",
    tripId: "t1",
    companyId: "u2",
    description: "Cajas",
    volume: 10,
    priceShare: new Prisma.Decimal("500.00"),
    depositAmount: new Prisma.Decimal("100.00"),
    status: "PENDING",
    createdAt: new Date(),
    cancelledAt: null,
    cancellationFeeAmount: null,
    payments: [],
    company: { name: "Acero SA" },
  };

  const openTrip = {
    id: "t1",
    status: "OPEN",
    capacityTotal: 30,
    cargoItems: [cargoItem],
    platformFeePercent: 10,
    carrier: { id: "u1", mpUserId: "mp-user-123", mpAccessToken: MP_TOKEN_STORED },
  };

  // la cancelación corre en una transacción serializable: el mock de prisma
  // necesita un cliente transaccional propio, con la carga y el viaje que
  // cada test quiere.
  function mockTx(item: unknown = cargoItem, trip: unknown = openTrip) {
    const tx = {
      cargoItem: {
        findUnique: vi.fn().mockResolvedValue(item),
        update: vi.fn().mockImplementation(({ data }: { data: unknown }) => ({
          ...(item as Record<string, unknown>),
          ...(data as Record<string, unknown>),
        })),
      },
      payment: { update: vi.fn().mockResolvedValue(undefined) },
      refundRequest: { create: vi.fn().mockResolvedValue({}) },
      trip: {
        findUnique: vi.fn().mockResolvedValue(trip),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (c: unknown) => unknown)(tx)
    );
    return tx;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
  });

  it("requiere token (401)", async () => {
    const res = await request(app).delete("/api/trips/t1/cargo-items/i1");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("rechaza a un CARRIER (403)", async () => {
    const res = await request(app)
      .delete("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${carrierToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("rechaza a una empresa que no es la dueña (403)", async () => {
    const res = await request(app)
      .delete("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
  });

  it("retira la carga de la empresa dueña y devuelve el item CANCELLED (200)", async () => {
    const res = await request(app)
      .delete("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "i1", status: "CANCELLED" });
  });

  it("rechaza una carga ya confirmada (409)", async () => {
    mockTx({ ...cargoItem, status: "CONFIRMED" });

    const res = await request(app)
      .delete("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CARGO_ITEM_CONFIRMED");
  });

  it("rechaza retirar carga con el viaje en tránsito (409)", async () => {
    mockTx(cargoItem, { ...openTrip, status: "IN_TRANSIT" });

    const res = await request(app)
      .delete("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRIP_ALREADY_STARTED");
  });

  it("devuelve la seña de una carga pagada (más de 48hs antes del viaje): crea RefundRequest PENDING", async () => {
    const paid = {
      ...cargoItem,
      payments: [
        {
          id: "pay1",
          cargoItemId: "i1",
          amount: new Prisma.Decimal("100.00"),
          status: "APPROVED",
          type: "DEPOSIT",
          refundedAmount: null,
          mpPreferenceId: "pref-1",
          mpPaymentId: "mp-77",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };
    const tx = mockTx(paid, {
      ...openTrip,
      date: new Date(Date.now() + 72 * 3_600_000),
    });
    // refundPayment NO se llama en la TX; el processor lo hace después
    vi.mocked(mp.refundPayment).mockResolvedValue(100);

    const res = await request(app)
      .delete("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(mp.refundPayment).not.toHaveBeenCalled();
    // OUTBOX: se crea RefundRequest PENDING con el monto objetivo
    expect(tx.refundRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cargoItemId: "i1",
        targetAmount: new Prisma.Decimal("100.00"),
        status: "PENDING",
      }),
    });
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(res.body.cancellationFeeAmount).toBe(0);
  });

  it("menos de 24hs no devuelve nada: la seña queda como costo", async () => {
    const paid = {
      ...cargoItem,
      payments: [
        {
          id: "pay1",
          cargoItemId: "i1",
          amount: new Prisma.Decimal("100.00"),
          status: "APPROVED",
          type: "DEPOSIT",
          refundedAmount: null,
          mpPreferenceId: "pref-1",
          mpPaymentId: "mp-77",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };
    const tx = mockTx(paid, {
      ...openTrip,
      date: new Date(Date.now() + 10 * 3_600_000),
    });

    const res = await request(app)
      .delete("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(mp.refundPayment).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(res.body.cancellationFeeAmount).toBe(100);
  });

  it("si el reembolso falla, la cancelación AÚN se hace y crea RefundRequest PENDING (outbox)", async () => {
    const paid = {
      ...cargoItem,
      payments: [
        {
          id: "pay1",
          cargoItemId: "i1",
          amount: new Prisma.Decimal("100.00"),
          status: "APPROVED",
          type: "DEPOSIT",
          refundedAmount: null,
          mpPreferenceId: "pref-1",
          mpPaymentId: "mp-77",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };
    const tx = mockTx(paid, {
      ...openTrip,
      date: new Date(Date.now() + 72 * 3_600_000),
    });
    // refundPayment falla, pero FUERA de la TX (el processor lo intentará después)
    vi.mocked(mp.refundPayment).mockRejectedValue(
      new AppError("no pudimos devolver el dinero con Mercado Pago", 502, "MP_ERROR")
    );

    const res = await request(app)
      .delete("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${companyToken}`);

    // OUTBOX: la cancelación NO falla; el reembolso se reintentará luego
    expect(res.status).toBe(200);
    expect(tx.refundRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cargoItemId: "i1",
        targetAmount: new Prisma.Decimal("100.00"),
        status: "PENDING",
      }),
    });
    expect(tx.cargoItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    );
  });

  it("da 404 si la carga no existe", async () => {
    mockTx(null);

    const res = await request(app)
      .delete("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CARGO_ITEM_NOT_FOUND");
  });
});

describe("POST /api/payments/mp/test-preference", () => {
  const body = { title: "Transporte TruckPool - Prueba", quantity: 1, unitPrice: 100 };

  beforeEach(() => {
    vi.mocked(mp.createTestPreference).mockReset();
    vi.mocked(mp.createTestPreference).mockResolvedValue({
      preferenceId: "pref-1",
      sandboxInitPoint: "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1",
      initPoint: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1",
    });
  });

  it("requiere token (401)", async () => {
    const res = await request(app).post("/api/payments/mp/test-preference").send(body);
    expect(res.status).toBe(401);
    expect(mp.createTestPreference).not.toHaveBeenCalled();
  });

  it("rechaza a un CARRIER (403)", async () => {
    const res = await request(app)
      .post("/api/payments/mp/test-preference")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send(body);
    expect(res.status).toBe(403);
    expect(mp.createTestPreference).not.toHaveBeenCalled();
  });

  it("devuelve la preference sin filtrar el token (ADMIN)", async () => {
    const res = await request(app)
      .post("/api/payments/mp/test-preference")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(body);

    expect(res.status).toBe(200);
    expect(mp.createTestPreference).toHaveBeenCalledWith(body);
    expect(res.body).toEqual({
      ok: true,
      preferenceId: "pref-1",
      sandboxInitPoint:
        "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1",
      initPoint: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1",
    });
    expect(JSON.stringify(res.body)).not.toContain("APP_USR");
  });

  it("rechaza un body incompleto (400)", async () => {
    const res = await request(app)
      .post("/api/payments/mp/test-preference")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "sin precio" });
    expect(res.status).toBe(400);
    expect(mp.createTestPreference).not.toHaveBeenCalled();
  });
});

describe("POST /api/cargo-items/:id/payment-preference", () => {
  const cargoItem = {
    id: "i1",
    tripId: "t1",
    companyId: "u2",
    description: "Cajas",
    volume: 10,
    priceShare: new Prisma.Decimal("500.00"),
    depositAmount: new Prisma.Decimal("100.00"),
    status: "PENDING",
    createdAt: new Date(),
    company: { email: "empresa@truckpool.app" },
    trip: {
      status: "OPEN",
      platformFeePercent: 10,
      carrier: { mpUserId: "mp-user-1", mpAccessToken: MP_TOKEN_STORED },
    },
  };

  beforeEach(() => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(null as never);
  });

  it("requiere token (401)", async () => {
    const res = await request(app).post("/api/cargo-items/i1/payment-preference");
    expect(res.status).toBe(401);
  });

  it("rechaza a un CARRIER (403)", async () => {
    const res = await request(app)
      .post("/api/cargo-items/i1/payment-preference")
      .set("Authorization", `Bearer ${carrierToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("rechaza a una COMPANY que no es dueña (403)", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue({
      ...cargoItem,
      companyId: "otra",
    } as never);

    const res = await request(app)
      .post("/api/cargo-items/i1/payment-preference")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(403);
    expect(mp.createCheckoutPreference).not.toHaveBeenCalled();
  });

  it("crea la preference para la empresa dueña (201) y devuelve init_point", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(cargoItem as never);
    vi.mocked(prisma.payment.create).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      amount: new Prisma.Decimal("100.00"),
      status: "PENDING",
      type: "DEPOSIT",
      refundedAmount: null,
      mpPreferenceId: null,
      mpPaymentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(prisma.payment.update).mockResolvedValue({} as never);
    vi.mocked(mp.createCheckoutPreference).mockResolvedValue({
      preferenceId: "pref-123",
      initPoint:
        "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
      platformFeeAmount: 150,
      carrierAmount: 1350,
    });

    const res = await request(app)
      .post("/api/cargo-items/i1/payment-preference")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      paymentId: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      // la carga vale 500 pero la seña es el 20%: se cobran 100
      amount: 100,
      status: "PENDING",
      platformFeeAmount: 150,
      carrierAmount: 1350,
      initPoint:
        "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
    });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        mpPreferenceId: "pref-123",
        platformFeeAmount: 150,
        carrierAmount: 1350,
      },
    });
  });
});

describe("POST /api/payments/webhook", () => {
  const secret = "whsec-de-prueba";
  const payload = {
    type: "payment",
    action: "updated",
    live_mode: "false",
    data: { id: "mp-77", status: "approved" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MP_WEBHOOK_SECRET = secret;
  });

  it("rechaza una firma inválida (401)", async () => {
    const res = await request(app)
      .post("/api/payments/webhook?payment_id=pay1")
      .set("x-signature", "ts=1756200000,v1=deadbeef")
      .set("x-request-id", "req-1")
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_SIGNATURE");
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it("rechaza si falta la firma (401)", async () => {
    const res = await request(app)
      .post("/api/payments/webhook?payment_id=pay1")
      .send(payload);
    expect(res.status).toBe(401);
  });

  it("actualiza el status a APPROVED con la firma válida (200)", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      amount: new Prisma.Decimal("500.00"),
      status: "PENDING",
      cargoItem: { status: "PENDING", companyId: "c1", tripId: "t1" },
      mpPreferenceId: "pref-123",
      mpPaymentId: null,
      // el reparto ya está asentado desde la preference: el webhook lo conserva
      platformFeeAmount: 50,
      carrierAmount: 450,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(prisma.payment.update).mockResolvedValue({
      id: "pay1",
      status: "APPROVED",
    } as never);
    // el webhook relee la carga para repartir la comisión
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue({
      id: "i1",
      trip: { platformFeePercent: 10, carrier: { mpUserId: "mp-user-123" } },
    } as never);

    const res = await request(app)
      .post("/api/payments/webhook?payment_id=pay1")
      .set(signedWebhook("mp-77", secret))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, updated: true, status: "APPROVED" });
    // 10% de los 500 del pago
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        status: "APPROVED",
        mpPaymentId: "mp-77",
        platformFeeAmount: 50,
        carrierAmount: 450,
      },
    });
  });

  it("busca por mpPreferenceId cuando viene en la query", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      id: "pay1",
      status: "PENDING",
    } as never);
    vi.mocked(prisma.payment.update).mockResolvedValue({
      id: "pay1",
      status: "REJECTED",
    } as never);

    const res = await request(app)
      .post("/api/payments/webhook?preference_id=pref-123")
      .set(signedWebhook("mp-78", secret))
      .send({ ...payload, data: { id: "mp-78", status: "rejected" } });

    expect(res.status).toBe(200);
    expect(prisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mpPreferenceId: "pref-123" } })
    );
    expect(res.body.status).toBe("REJECTED");
  });
});

describe("transiciones y confirmación de carga", () => {
  it("PATCH /:id/status requiere token (401)", async () => {
    const res = await request(app)
      .patch("/api/trips/t1/status")
      .send({ status: "IN_TRANSIT" });
    expect(res.status).toBe(401);
  });

  it("PATCH cargo-items/:id requiere token (401)", async () => {
    const res = await request(app).patch("/api/trips/t1/cargo-items/i1").send({});
    expect(res.status).toBe(401);
  });

  it("PATCH cargo-items/:id sin pago aprobado devuelve 409 PAYMENT_REQUIRED", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue({
      id: "i1",
      tripId: "t1",
      companyId: "u2",
      description: "Cajas",
      volume: 10,
      priceShare: new Prisma.Decimal("500.00"),
      depositAmount: new Prisma.Decimal("100.00"),
      status: "PENDING",
      createdAt: new Date(),
      payments: [
        {
          id: "pay1",
          cargoItemId: "i1",
          amount: new Prisma.Decimal("100.00"),
          status: "PENDING",
          type: "DEPOSIT",
          refundedAmount: null,
          mpPreferenceId: "pref-1",
          mpPaymentId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    } as never);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({ carrierId: "u1" } as never);

    const res = await request(app)
      .patch("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${carrierToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PAYMENT_REQUIRED");
    expect(prisma.cargoItem.update).not.toHaveBeenCalled();
  });

  it("PATCH cargo-items/:id con la seña aprobada confirma la carga (200)", async () => {
    const approved = {
      id: "pay1",
      cargoItemId: "i1",
      amount: new Prisma.Decimal("100.00"),
      status: "APPROVED",
      type: "DEPOSIT",
      refundedAmount: null,
      mpPreferenceId: "pref-1",
      mpPaymentId: "mp-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue({
      id: "i1",
      tripId: "t1",
      companyId: "u2",
      description: "Cajas",
      volume: 10,
      priceShare: new Prisma.Decimal("500.00"),
      depositAmount: new Prisma.Decimal("100.00"),
      status: "PENDING",
      createdAt: new Date(),
      payments: [approved],
    } as never);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({ carrierId: "u1" } as never);
    vi.mocked(prisma.cargoItem.update).mockResolvedValue({
      id: "i1",
      tripId: "t1",
      companyId: "u2",
      description: "Cajas",
      volume: 10,
      priceShare: new Prisma.Decimal("500.00"),
      depositAmount: new Prisma.Decimal("100.00"),
      status: "CONFIRMED",
      createdAt: new Date(),
      payments: [approved],
    } as never);

    const res = await request(app)
      .patch("/api/trips/t1/cargo-items/i1")
      .set("Authorization", `Bearer ${carrierToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CONFIRMED");
    expect(res.body.depositPayment).toMatchObject({
      status: "APPROVED",
      amount: 100,
      type: "DEPOSIT",
    });
    expect(res.body.balancePayment).toBeNull();
  });
});

describe("users /me", () => {
  const user: User = {
    id: "u1",
    email: "flete@truckpool.app",
    password: "hash",
    name: "Transportes Flete",
    role: "CARRIER",
    bio: null,
    phone: null,
    taxId: "20345678901",
    verificationStatus: "VERIFIED",
    verificationNote: null,
    emailNotifications: true,
    isAvailableNow: true,
    mpUserId: "mp-user-123",
    mpAccessToken: MP_TOKEN_STORED,
    createdAt: new Date(),
  };

  it("GET /api/users/me requiere token (401)", async () => {
    const res = await request(app).get("/api/users/me");
    expect(res.status).toBe(401);
  });

  it("GET /api/users/me devuelve el perfil con bio y phone", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...user,
      bio: "fletero sí sn",
      phone: "351-555",
    });
    const res = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${carrierToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: "u1",
      email: "flete@truckpool.app",
      name: "Transportes Flete",
      role: "CARRIER",
      bio: "fletero sí sn",
      phone: "351-555",
      taxId: "20345678901",
      verificationStatus: "VERIFIED",
      verificationNote: null,
      emailNotifications: true,
      isAvailableNow: true,
      // solo el booleano: ni el id de la cuenta ni el token salen por la API
      mpConnected: true,
    });
    expect(res.body.user).not.toHaveProperty("mpUserId");
    expect(res.body.user).not.toHaveProperty("mpAccessToken");
  });

  it("PATCH /api/users/me actualiza solo lo enviado", async () => {
    vi.mocked(prisma.user.update).mockResolvedValue({ ...user, phone: "351-999" });
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ phone: "351-999" });
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { phone: "351-999" },
    });
    expect(res.body.user.phone).toBe("351-999");
  });

  it("PATCH /api/users/me rechaza name vacío (400)", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ name: "   " });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/users/me/trips requiere rol CARRIER (403)", async () => {
    const res = await request(app)
      .get("/api/users/me/trips")
      .set("Authorization", `Bearer ${companyToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /api/users/me/trips filtra por el carrier autenticado", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValue([]);
    const res = await request(app)
      .get("/api/users/me/trips")
      .set("Authorization", `Bearer ${carrierToken}`);
    expect(res.status).toBe(200);
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ carrierId: "u1" }) })
    );
  });

  it("GET /api/users/me/cargo-items requiere rol COMPANY (403)", async () => {
    const res = await request(app)
      .get("/api/users/me/cargo-items")
      .set("Authorization", `Bearer ${carrierToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /api/users/me/cargo-items filtra por la empresa autenticada (200)", async () => {
    vi.mocked(prisma.cargoItem.findMany).mockResolvedValue([]);
    const res = await request(app)
      .get("/api/users/me/cargo-items")
      .set("Authorization", `Bearer ${companyToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(prisma.cargoItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "u2" }) })
    );
  });
});

describe("carriers públicos", () => {
  type PrismaUser = Awaited<ReturnType<typeof prisma.user.findUnique>>;
  type PrismaUserWithTrips = PrismaUser & { tripsAsCarrier: unknown[] };
  // los fixtures de test no completan los campos de verificación: se
  // completan acá para no repetirlos en cada mock.
  function withVerification<T extends object>(user: T) {
    return {
      taxId: null,
      verificationStatus: "UNVERIFIED",
      verificationNote: null,
      ...user,
    };
  }

  it("GET /api/carriers es público (200)", async () => {
    vi.mocked(prisma.review.groupBy).mockResolvedValue([]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    const res = await request(app).get("/api/carriers");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("GET /api/carriers/:id devuelve 404 si no existe", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    } as never);
    const res = await request(app).get("/api/carriers/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CARRIER_NOT_FOUND");
  });

  it("GET /api/carriers/:id devuelve 404 si el usuario es COMPANY", async () => {
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      withVerification({
        id: "u2",
        email: "e@e.com",
        password: "hash",
        name: "Comercial",
        role: "COMPANY",
        bio: null,
        phone: null,
        createdAt: new Date(),
        tripsAsCarrier: [],
        reviewsReceived: [],
      }) as unknown as PrismaUserWithTrips & { reviewsReceived: unknown[] }
    );
    const res = await request(app).get("/api/carriers/u2");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CARRIER_NOT_FOUND");
  });

  it("GET /api/carriers/:id devuelve el perfil con viajes OPEN (200)", async () => {
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: 4.5 },
      _count: { _all: 2 },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      withVerification({
        id: "u1",
        email: "flete@truckpool.app",
        password: "hash",
        name: "Transportes Flete",
        role: "CARRIER",
        bio: "fletero",
        phone: "351-555",
        createdAt: new Date(),
        tripsAsCarrier: [],
        reviewsReceived: [
          {
            id: "r1",
            rating: 5,
            comment: "muy puntual",
            createdAt: new Date("2026-09-20T10:00:00.000Z"),
            fromUser: { name: "Comercial Norte" },
            trip: { id: "t9", origin: "Rosario", destination: "Cordoba" },
          },
        ],
      }) as unknown as PrismaUserWithTrips & { reviewsReceived: unknown[] }
    );
    const res = await request(app).get("/api/carriers/u1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "u1",
      name: "Transportes Flete",
      bio: "fletero",
      phone: "351-555",
      trips: [],
      ratingAvg: 4.5,
      ratingCount: 2,
    });
    expect(res.body.reviews[0]).toMatchObject({
      rating: 5,
      comment: "muy puntual",
      fromName: "Comercial Norte",
    });
  });
});

describe("POST /api/trips/:id/reviews", () => {
  const completedTrip = {
    status: "COMPLETED",
    carrierId: "u1",
    cargoItems: [{ companyId: "u2" }],
  };

  it("requiere token (401)", async () => {
    const res = await request(app).post("/api/trips/t1/reviews").send({ rating: 5 });
    expect(res.status).toBe(401);
  });

  it("rechaza rating fuera de 1..5 (400)", async () => {
    for (const rating of [0, 6, 2.5, "cinco"]) {
      const res = await request(app)
        .post("/api/trips/t1/reviews")
        .set("Authorization", `Bearer ${carrierToken}`)
        .send({ rating });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    }
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it("rechaza un comentario de más de 500 caracteres (400)", async () => {
    const res = await request(app)
      .post("/api/trips/t1/reviews")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ rating: 4, comment: "a".repeat(501) });
    expect(res.status).toBe(400);
  });

  it("no deja calificar antes de COMPLETED (409)", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({
      ...completedTrip,
      status: "IN_TRANSIT",
    } as never);

    const res = await request(app)
      .post("/api/trips/t1/reviews")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ rating: 5 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRIP_NOT_COMPLETED");
  });

  it("crea la calificación del fletero a la empresa (201)", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(completedTrip as never);
    vi.mocked(prisma.review.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.review.create).mockResolvedValue({
      id: "r1",
      tripId: "t1",
      fromUserId: "u1",
      toUserId: "u2",
      rating: 5,
      comment: "carga y descarga sin dramas",
      createdAt: new Date("2026-09-26T10:00:00.000Z"),
      fromUser: { name: "Transportes Flete" },
      toUser: { name: "Comercial Norte" },
    } as never);

    const res = await request(app)
      .post("/api/trips/t1/reviews")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ rating: 5, comment: "carga y descarga sin dramas" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      fromUserId: "u1",
      toUserId: "u2",
      rating: 5,
      fromName: "Transportes Flete",
      toName: "Comercial Norte",
    });
  });

  it("no deja calificar dos veces (409)", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(completedTrip as never);
    vi.mocked(prisma.review.findUnique).mockResolvedValue({ id: "r1" } as never);

    const res = await request(app)
      .post("/api/trips/t1/reviews")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ rating: 5 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_REVIEWED");
  });

  it("no deja calificar a un usuario ajeno al viaje (403)", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(completedTrip as never);

    const res = await request(app)
      .post("/api/trips/t1/reviews")
      .set("Authorization", `Bearer ${strangerToken}`)
      .send({ rating: 5, toUserId: "u1" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });
});

describe("PATCH /api/users/me/verification", () => {
  it("requiere token (401)", async () => {
    const res = await request(app)
      .patch("/api/users/me/verification")
      .send({ taxId: "20345678901" });
    expect(res.status).toBe(401);
  });

  it("una COMPANY no puede solicitar verificación (403)", async () => {
    const res = await request(app)
      .patch("/api/users/me/verification")
      .set("Authorization", `Bearer ${companyToken}`)
      .send({ taxId: "20345678901" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("rechaza taxId vacío (400)", async () => {
    const res = await request(app)
      .patch("/api/users/me/verification")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ taxId: "  " });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("el transportista solicita y queda PENDING (200)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "flete@truckpool.app",
      name: "Transportes Flete",
      role: "CARRIER",
      bio: null,
      phone: null,
      password: "hash",
      taxId: null,
      verificationStatus: "UNVERIFIED",
      verificationNote: null,
      createdAt: new Date(),
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: "u1",
      email: "flete@truckpool.app",
      name: "Transportes Flete",
      role: "CARRIER",
      bio: null,
      phone: null,
      password: "hash",
      taxId: "20345678901",
      verificationStatus: "PENDING",
      verificationNote: null,
      createdAt: new Date(),
    } as never);

    const res = await request(app)
      .patch("/api/users/me/verification")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ taxId: "20345678901" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      verificationStatus: "PENDING",
      taxId: "20345678901",
    });
  });
});

describe("/api/admin/verifications", () => {
  it("no deja entrar a un CARRIER (403)", async () => {
    const res = await request(app)
      .get("/api/admin/verifications")
      .set("Authorization", `Bearer ${carrierToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("no deja entrar a una COMPANY (403)", async () => {
    const res = await request(app)
      .patch("/api/admin/verifications/u1")
      .set("Authorization", `Bearer ${companyToken}`)
      .send({ approve: true });
    expect(res.status).toBe(403);
  });

  it("sin token no lista (401)", async () => {
    const res = await request(app).get("/api/admin/verifications");
    expect(res.status).toBe(401);
  });

  it("el ADMIN lista las solicitudes PENDING (200)", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "u5",
        name: "Transporte Sur",
        email: "sur@truckpool.app",
        taxId: "20345678902",
        createdAt: new Date("2026-09-26T10:00:00.000Z"),
      },
    ] as never);

    const res = await request(app)
      .get("/api/admin/verifications")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: "u5",
      name: "Transporte Sur",
      taxId: "20345678902",
    });
  });

  it("el ADMIN aprueba y el transportista queda VERIFIED (200)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u5",
      name: "Transporte Sur",
      email: "sur@truckpool.app",
      role: "CARRIER",
      taxId: "20345678902",
      verificationStatus: "PENDING",
      verificationNote: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: "u5",
      name: "Transporte Sur",
      email: "sur@truckpool.app",
      taxId: "20345678902",
      verificationStatus: "VERIFIED",
      verificationNote: null,
    } as never);

    const res = await request(app)
      .patch("/api/admin/verifications/u5")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ approve: true });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ verificationStatus: "VERIFIED" });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u5" },
      data: { verificationStatus: "VERIFIED", verificationNote: null },
    });
  });

  it("el ADMIN rechaza con nota y el transportista queda REJECTED (200)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u5",
      name: "Transporte Sur",
      email: "sur@truckpool.app",
      role: "CARRIER",
      taxId: "20345678902",
      verificationStatus: "PENDING",
      verificationNote: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: "u5",
      name: "Transporte Sur",
      email: "sur@truckpool.app",
      taxId: "20345678902",
      verificationStatus: "REJECTED",
      verificationNote: "el DNI no coincide con el titular",
    } as never);

    const res = await request(app)
      .patch("/api/admin/verifications/u5")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ approve: false, note: "el DNI no coincide con el titular" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      verificationStatus: "REJECTED",
      verificationNote: "el DNI no coincide con el titular",
    });
  });

  it("rechazar sin nota se rechaza en el body (400)", async () => {
    const res = await request(app)
      .patch("/api/admin/verifications/u5")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ approve: false });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/trips/:id", () => {
  const tripDetail = {
    id: "clx1234abcd",
    origin: "Córdoba",
    destination: "Rosario",
    date: new Date("2026-10-01T10:00:00.000Z"),
    departureTime: "08:30",
    truckType: "Semi",
    capacityTotal: 20,
    price: new Prisma.Decimal(450000),
    depositPercent: 20,
    status: "OPEN" as const,
    carrierId: "u1",
    carrier: { name: "Transportes Flete" },
    originLat: -31.4201,
    originLng: -64.1888,
    destLat: -32.9442,
    destLng: -60.6505,
    features: ["seguro"],
    cargoItems: [],
    reviews: [],
  };

  it("devuelve la hora de salida prometida (200)", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripDetail as never);

    const res = await request(app)
      .get("/api/trips/clx1234abcd")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(res.body.departureTime).toBe("08:30");
  });

  // el detalle se arma a mano en el service: si se olvida el campo, la página
  // del viaje deja de mostrar la hora sin que nada falle.
  it("devuelve null cuando el viaje se publicó sin hora", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({
      ...tripDetail,
      departureTime: null,
    } as never);

    const res = await request(app)
      .get("/api/trips/clx1234abcd")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(res.body.departureTime).toBeNull();
  });
});

describe("GET /api/trips/:id/manifest.pdf", () => {
  const manifestTrip = {
    id: "clx1234abcd",
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    features: ["seguro"],
    origin: "Córdoba",
    destination: "Rosario",
    date: new Date("2026-10-01T10:00:00.000Z"),
    departureTime: "08:30",
    truckType: "Semi",
    capacityTotal: 20,
    price: new Prisma.Decimal(450000),
    depositPercent: 20,
    status: "IN_TRANSIT" as const,
    carrierId: "u1",
    carrier: {
      name: "Transportes Flete",
      mpUserId: "mp-user-123",
      mpAccessToken: MP_TOKEN_STORED,
    },
    originLat: -31.4201,
    originLng: -64.1888,
    destLat: -32.9442,
    destLng: -60.6505,
    departureAddress: null,
    departureLat: null,
    departureLng: null,
    cargoItems: [
      {
        description: "Cajas deurado",
        volume: 8,
        priceShare: new Prisma.Decimal(180000),
        company: { id: "u2", name: "Comercial Norte" },
      },
    ],
    platformFeePercent: 10,
  };

  // supertest no parsea application/pdf: le pasamos un parser binario
  const asPdf = (req: request.Test) =>
    req.buffer().parse((raw, callback) => {
      const chunks: Buffer[] = [];
      raw.on("data", (chunk: Buffer) => chunks.push(chunk));
      raw.on("end", () => callback(null, Buffer.concat(chunks)));
    });

  it("requiere token (401)", async () => {
    const res = await request(app).get("/api/trips/clx1234abcd/manifest.pdf");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("devuelve 404 si el viaje no existe", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);
    const res = await request(app)
      .get("/api/trips/no-existe/manifest.pdf")
      .set("Authorization", `Bearer ${carrierToken}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("TRIP_NOT_FOUND");
  });

  it("devuelve 403 para quien no es carrier ni tiene carga", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(manifestTrip);
    const res = await request(app)
      .get("/api/trips/clx1234abcd/manifest.pdf")
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("el carrier recibe el PDF con content-type correcto", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(manifestTrip);
    const res = await asPdf(
      request(app)
        .get("/api/trips/clx1234abcd/manifest.pdf")
        .set("Authorization", `Bearer ${carrierToken}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(".pdf");
    expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("una empresa con carga en el viaje también puede pedirlo", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(manifestTrip);
    const res = await asPdf(
      request(app)
        .get("/api/trips/clx1234abcd/manifest.pdf")
        .set("Authorization", `Bearer ${companyToken}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  });
});

describe("GET /api/admin/stats", () => {
  beforeEach(() => {
    // 3 viajes: 2 OPEN, 1 COMPLETED
    vi.mocked(prisma.trip.groupBy).mockResolvedValue([
      { status: "OPEN", _count: { _all: 2 } },
      { status: "COMPLETED", _count: { _all: 1 } },
    ] as never);
    // 10.5 m³ confirmados
    vi.mocked(prisma.cargoItem.aggregate).mockResolvedValue({
      _sum: { volume: 10.5 },
    } as never);
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({
      _sum: { amount: new Prisma.Decimal("1200.50") },
    } as never);
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: 4.5 },
    } as never);
    vi.mocked(prisma.user.count)
      .mockResolvedValueOnce(2) // transportistas con al menos un viaje
      .mockResolvedValueOnce(3); // empresas con al menos una carga
  });

  it("exige token (401)", async () => {
    const res = await request(app).get("/api/admin/stats");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("rechaza a quien no es admin (403)", async () => {
    const res = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${carrierToken}`);
    expect(res.status).toBe(403);
  });

  it("devuelve las métricas reales para el admin", async () => {
    const res = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({
      tripsByStatus: { OPEN: 2, FULL: 0, IN_TRANSIT: 0, COMPLETED: 1 },
      totalTrips: 3,
      volumeTransported: 10.5,
      billedAmount: 1200.5,
      activeCarriers: 2,
      activeCompanies: 3,
      averageRating: 4.5,
    });
  });

  it("filtra los pagos por APPROVED y el volumen por CONFIRMED", async () => {
    await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(prisma.cargoItem.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "CONFIRMED" } })
    );
    expect(prisma.payment.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "APPROVED" } })
    );
  });

  it("cuenta transportistas y empresas solo si tienen actividad", async () => {
    await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { role: "CARRIER", tripsAsCarrier: { some: {} } },
    });
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { role: "COMPANY", cargoItems: { some: {} } },
    });
  });

  it("devuelve averageRating en null si todavía no hay reviews", async () => {
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: null },
    } as never);
    const res = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats.averageRating).toBeNull();
    expect(res.body.stats.pendingReasons.averageRating).toContain("calificaciones");
  });

  it("anota que los km evitados no se calculan", async () => {
    const res = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body.stats).not.toHaveProperty("kmEvitados");
    expect(res.body.stats.notes.join(" ")).toContain("geodata");
    expect(res.body.stats.notes.join(" ")).toContain("km evitados");
  });
});

describe("búsqueda por proximidad en GET /api/trips", () => {
  beforeEach(() => {
    vi.mocked(prisma.trip.findMany).mockReset();
  });

  it("rechaza un nearOrigin mal formado con 400", async () => {
    const res = await request(app).get("/api/trips?nearOrigin=abc");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rechaza un radio fuera de rango", async () => {
    const res = await request(app).get("/api/trips?nearOrigin=-32.94,-60.65,9999");
    expect(res.status).toBe(400);
  });

  it("rechaza coordenadas fuera de rango", async () => {
    const res = await request(app).get("/api/trips?nearOrigin=-99,-60.65,50");
    expect(res.status).toBe(400);
  });

  it("acepta el formato lat,lng,radioKm y filtra por haversine", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValue([
      {
        id: "cerca",
        origin: "Córdoba",
        destination: "Mendoza",
        date: new Date(),
        truckType: "Semi",
        capacityTotal: 20,
        price: new Prisma.Decimal("1000"),
        status: "OPEN",
        createdAt: new Date(),
        carrierId: "u1",
        features: [],
        originLat: -31.4201,
        originLng: -64.1888,
        destLat: -32.8895,
        destLng: -68.8458,
        cargoItems: [],
        carrier: { name: "Transportes Flete" },
      },
      {
        id: "lejos",
        origin: "Rosario",
        destination: "Buenos Aires",
        date: new Date(),
        truckType: "Semi",
        capacityTotal: 20,
        price: new Prisma.Decimal("1000"),
        status: "OPEN",
        createdAt: new Date(),
        carrierId: "u1",
        features: [],
        originLat: -32.9442,
        originLng: -60.6505,
        destLat: -34.6037,
        destLng: -58.3816,
        cargoItems: [],
        carrier: { name: "Transportes Flete" },
      },
      // sin geocodificar: no entra
      {
        id: "sin-coords",
        origin: "Bahía Blanca",
        destination: "Neuquén",
        date: new Date(),
        truckType: "Semi",
        capacityTotal: 20,
        price: new Prisma.Decimal("1000"),
        status: "OPEN",
        createdAt: new Date(),
        carrierId: "u1",
        features: [],
        originLat: null,
        originLng: null,
        destLat: null,
        destLng: null,
        cargoItems: [],
        carrier: { name: "Transportes Flete" },
      },
    ] as never);

    const res = await request(app).get(
      "/api/trips?nearOrigin=-31.42,-64.18,30&nearDestination=-32.89,-68.84,30"
    );

    expect(res.status).toBe(200);
    expect(res.body.map((t: { id: string }) => t.id)).toEqual(["cerca"]);
  });
});

describe("GET /api/trips/geocode", () => {
  beforeEach(() => {
    vi.mocked(geocode).mockReset();
  });

  it("devuelve lat/lng cuando Nominatim resuelve la dirección", async () => {
    vi.mocked(geocode).mockResolvedValue({ lat: -32.9442, lng: -60.6505 });
    const res = await request(app).get("/api/trips/geocode?address=Rosario, Santa Fe");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      address: "Rosario, Santa Fe",
      lat: -32.9442,
      lng: -60.6505,
    });
  });

  it("devuelve 400 con mensaje claro si no encuentra la dirección", async () => {
    vi.mocked(geocode).mockResolvedValue(null);
    const res = await request(app).get("/api/trips/geocode?address=asdlkjasd 123");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("GEOCODE_NOT_FOUND");
    expect(res.body.error).toContain("asdlkjasd 123");
  });

  it("exige una dirección no vacía", async () => {
    const res = await request(app).get("/api/trips/geocode?address=");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/trips/price-estimate", () => {
  const rosario = { lat: -32.9442, lng: -60.6505 };
  const cordoba = { lat: -31.4201, lng: -64.1888 };

  beforeEach(() => {
    vi.mocked(geocode).mockReset();
  });

  function byAddress() {
    vi.mocked(geocode).mockImplementation(async (address: string) =>
      address === "Rosario" ? rosario : cordoba
    );
  }

  it("es pública: no hace falta token", async () => {
    byAddress();
    const res = await request(app).get(
      "/api/trips/price-estimate?origin=Rosario&destination=Córdoba&truckType=Camión"
    );
    expect(res.status).toBe(200);
  });

  it("devuelve distancia, sugerido y el rango válido", async () => {
    byAddress();
    const res = await request(app).get(
      "/api/trips/price-estimate?origin=Rosario&destination=Córdoba&truckType=Camión"
    );

    // 373,6 km en línea recta; el precio corre sobre km de ruta (×1.25)
    expect(res.body.geocoded).toBe(true);
    expect(res.body.distanceKm).toBeCloseTo(373.6, 1);
    // 5.000 + 260 × 373,6 × 1,25 = 126.420 → 126.400
    expect(res.body.suggestedPrice).toBe(126_400);
    // el rango que devuelve es exactamente el que valida createTrip
    expect(res.body.suggestedPrice).toBe(
      calculateSuggestedPrice("Camión", res.body.distanceKm)
    );
    expect(res.body.minPrice).toBeLessThanOrEqual(126_400 * 0.85);
    expect(res.body.maxPrice).toBeGreaterThanOrEqual(126_400 * 1.15);
    expect(res.body.rate).toEqual({ baseFee: 5000, perKm: 260 });
  });

  it("el rango de la API es el que valida createTrip", async () => {
    byAddress();
    const res = await request(app).get(
      "/api/trips/price-estimate?origin=Rosario&destination=Córdoba&truckType=Semi"
    );
    const { minPrice, maxPrice, suggestedPrice } = res.body;

    // lo que el front ofrece como extremos tiene que ser lo que el server
    // acepta: si no, el fletero choca contra un 400 con el slider arriba
    for (const price of [minPrice, suggestedPrice, maxPrice]) {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        verificationStatus: "VERIFIED",
        mpUserId: "mp-user-123",
      } as never);
      vi.mocked(prisma.trip.create).mockResolvedValue({
        id: "t1",
        origin: "Rosario",
        destination: "Córdoba",
        date: new Date("2026-11-01T10:00:00.000Z"),
        departureTime: null,
        truckType: "Semi",
        capacityTotal: 20,
        price: new Prisma.Decimal(price),
        status: "OPEN",
        createdAt: new Date(),
        carrierId: "u1",
        features: [],
        cargoItems: [],
      } as unknown as Trip);
      await expect(
        createTrip("u1", {
          origin: "Rosario",
          destination: "Córdoba",
          date: new Date("2026-11-01T10:00:00.000Z"),
          truckType: "Semi",
          capacityTotal: 20,
          price,
          depositPercent: 20,
          features: [],
        })
      ).resolves.toBeDefined();
    }
  });

  it("responde 200 con geocoded false si no puede calcular la distancia", async () => {
    vi.mocked(geocode).mockResolvedValue(null);
    const res = await request(app).get(
      "/api/trips/price-estimate?origin=asdlkjasd&destination=Córdoba&truckType=Camión"
    );

    // no 400: el front tiene que poder caer al input libre, no romperse
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      geocoded: false,
      distanceKm: null,
      suggestedPrice: null,
      minPrice: null,
      maxPrice: null,
    });
  });

  it("un tipo de vehículo desconocido igual devuelve una tarifa", async () => {
    byAddress();
    const res = await request(app).get(
      "/api/trips/price-estimate?origin=Rosario&destination=Córdoba&truckType=Furión"
    );
    // cae en la tarifa del camión en vez de romperse
    expect(res.body.rate).toEqual({ baseFee: 5000, perKm: 260 });
    expect(res.body.suggestedPrice).toBe(126_400);
    expect(res.body.truckType).toBe("Furión");
  });

  it("exige origen, destino y tipo de vehículo", async () => {
    for (const query of [
      "origin=Rosario&truckType=Camión",
      "destination=Córdoba&truckType=Camión",
      "origin=Rosario&destination=Córdoba",
      "origin=&destination=Córdoba&truckType=Camión",
    ]) {
      const res = await request(app).get(`/api/trips/price-estimate?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("tracking GPS en la API", () => {
  // viaje "t1" del transportista u1 (CARRIER), en tránsito, con la empresa u2
  // (COMPANY) cargando en él.
  function tripInTransit() {
    return {
      id: "t1",
      status: "IN_TRANSIT",
      carrierId: "u1",
      carrier: {
        id: "u1",
        name: "Transportes Flete",
        mpUserId: "mp-user-123",
        mpAccessToken: MP_TOKEN_STORED,
      },
      cargoItems: [{ company: { id: "u2", name: "Granos del Litoral" } }],
      platformFeePercent: 10,
    };
  }

  function location(overrides: Record<string, unknown> = {}) {
    return {
      id: "loc1",
      tripId: "t1",
      lat: -32.9468,
      lng: -60.6393,
      recordedAt: new Date("2026-09-26T12:00:00.000Z"),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.mocked(prisma.trip.findUnique).mockReset();
    vi.mocked(prisma.tripLocation.create).mockReset();
    vi.mocked(prisma.tripLocation.findFirst).mockReset();
    vi.mocked(prisma.tripLocation.findMany).mockReset();
  });

  it("el transportista dueño publica su posición con 201", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
    vi.mocked(prisma.tripLocation.create).mockResolvedValue(location() as never);

    const res = await request(app)
      .post("/api/trips/t1/location")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ lat: -32.9468, lng: -60.6393 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ lat: -32.9468, lng: -60.6393 });
  });

  it("otro carrier no puede publicar la posición de ese viaje", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
    const otroCarrier = signToken({ id: "u5", role: "CARRIER" });

    const res = await request(app)
      .post("/api/trips/t1/location")
      .set("Authorization", `Bearer ${otroCarrier}`)
      .send({ lat: -32.9468, lng: -60.6393 });

    expect(res.status).toBe(403);
    expect(prisma.tripLocation.create).not.toHaveBeenCalled();
  });

  it("una empresa no puede publicar posición (el rol es del transportista)", async () => {
    const res = await request(app)
      .post("/api/trips/t1/location")
      .set("Authorization", `Bearer ${companyToken}`)
      .send({ lat: -32.9468, lng: -60.6393 });

    expect(res.status).toBe(403);
    expect(prisma.tripLocation.create).not.toHaveBeenCalled();
  });

  it("no deja publicar si el viaje no está en tránsito", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({
      ...tripInTransit(),
      status: "OPEN",
    } as never);

    const res = await request(app)
      .post("/api/trips/t1/location")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send({ lat: -32.9468, lng: -60.6393 });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRIP_NOT_IN_TRANSIT");
    expect(prisma.tripLocation.create).not.toHaveBeenCalled();
  });

  it("no deja publicar sin token", async () => {
    const res = await request(app)
      .post("/api/trips/t1/location")
      .send({ lat: -32.9468, lng: -60.6393 });
    expect(res.status).toBe(401);
  });

  it.each([
    ["lat fuera de rango", { lat: 120, lng: -60.6393 }],
    ["lng fuera de rango", { lat: -32.9468, lng: 400 }],
    ["NaN", { lat: "no-numero", lng: -60.6393 }],
    ["falta lng", { lat: -32.9468 }],
  ])("rechaza la posición inválida: %s", async (_nombre, body) => {
    const res = await request(app)
      .post("/api/trips/t1/location")
      .set("Authorization", `Bearer ${carrierToken}`)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("la empresa con carga lee la última posición", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
    vi.mocked(prisma.tripLocation.findFirst).mockResolvedValue(location() as never);

    const res = await request(app)
      .get("/api/trips/t1/location")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      location: {
        id: "loc1",
        lat: -32.9468,
        lng: -60.6393,
        recordedAt: "2026-09-26T12:00:00.000Z",
      },
    });
  });

  it("un usuario ajeno al viaje no puede leer la ubicación", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);

    const res = await request(app)
      .get("/api/trips/t1/location")
      .set("Authorization", `Bearer ${strangerToken}`);

    expect(res.status).toBe(403);
    expect(prisma.tripLocation.findFirst).not.toHaveBeenCalled();
  });

  it("no deja leer la ubicación sin token", async () => {
    const res = await request(app).get("/api/trips/t1/location");
    expect(res.status).toBe(401);
  });

  it("devuelve location null si todavía no se compartió ubicación", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
    vi.mocked(prisma.tripLocation.findFirst).mockResolvedValue(null);

    const res = await request(app)
      .get("/api/trips/t1/location")
      .set("Authorization", `Bearer ${carrierToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ location: null });
  });

  it("con ?history=true devuelve además el recorrido completo", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
    vi.mocked(prisma.tripLocation.findMany).mockResolvedValue([
      location({ id: "loc1", recordedAt: new Date(1) }),
      location({ id: "loc2", recordedAt: new Date(2) }),
    ] as never);

    const res = await request(app)
      .get("/api/trips/t1/location?history=true")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(res.body.track).toHaveLength(2);
    expect(res.body.location.id).toBe("loc2");
  });
});

describe("/api/notifications", () => {
  const aviso = {
    id: "n1",
    type: "BALANCE_DUE",
    title: "falta pagar el saldo de tu carga",
    body: "quedan $400 de saldo de $500",
    tripId: "t1",
    read: false,
    createdAt: new Date("2026-09-27T10:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.notification.findMany).mockResolvedValue([aviso] as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it("requiere token (401)", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("devuelve las notificaciones del usuario, más recientes primero (200)", async () => {
    const res = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: "u2" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    expect(res.body).toEqual([
      {
        id: "n1",
        type: "BALANCE_DUE",
        title: "falta pagar el saldo de tu carga",
        body: "quedan $400 de saldo de $500",
        tripId: "t1",
        read: false,
        createdAt: "2026-09-27T10:00:00.000Z",
      },
    ]);
  });

  it("filtra por no leídas con unreadOnly", async () => {
    const res = await request(app)
      .get("/api/notifications?unreadOnly=true")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u2", read: false } })
    );
  });

  it("ignora un unreadOnly que no es booleano", async () => {
    const res = await request(app)
      .get("/api/notifications?unreadOnly=quiz%C3%A1")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u2" } })
    );
  });

  it("PATCH /:id/read marca una notificación propia (200)", async () => {
    const res = await request(app)
      .patch("/api/notifications/n1/read")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: true });
    // el userId va en el where: no alcanza con conocer el id
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: "u2" },
      data: { read: true },
    });
  });

  it("PATCH /:id/read no marca la notificación de otro (200 con updated:false)", async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await request(app)
      .patch("/api/notifications/n1/read")
      .set("Authorization", `Bearer ${strangerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: false });
  });

  it("PATCH /:id/read requiere token (401)", async () => {
    const res = await request(app).patch("/api/notifications/n1/read");
    expect(res.status).toBe(401);
  });

  it("PATCH /read-all marca solo las no leídas del usuario (200)", async () => {
    const res = await request(app)
      .patch("/api/notifications/read-all")
      .set("Authorization", `Bearer ${carrierToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", read: false },
      data: { read: true },
    });
  });

  it("PATCH /read-all requiere token (401)", async () => {
    const res = await request(app).patch("/api/notifications/read-all");
    expect(res.status).toBe(401);
  });
});

describe("conexión con Mercado Pago desde el navegador", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MP_CLIENT_ID = "client-id";
    process.env.MP_CLIENT_SECRET = "client-secret";
    process.env.API_PUBLIC_URL = "https://api.truckpool.app";
    process.env.APP_URL = "https://truckpool.app";
  });

  it("GET /api/users/me/mp-connect exige token", async () => {
    const res = await request(app).get("/api/users/me/mp-connect");
    expect(res.status).toBe(401);
  });

  it("GET /api/users/me/mp-connect devuelve JSON con la URL y su state", async () => {
    const res = await request(app)
      .get("/api/users/me/mp-connect")
      .set("Authorization", `Bearer ${carrierToken}`);

    expect(res.status).toBe(200);
    // JSON, no redirect: el botón del perfil hace el fetch y recién ahí navega
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toEqual({
      authUrl: expect.stringContaining("auth.mercadopago.com"),
    });
    expect(verifyOAuthState(new URL(res.body.authUrl).searchParams.get("state")!)).toBe(
      "u1"
    );
  });

  it("el callback es público: guarda el token y redirige al perfil", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "APP_USR-nuevo", user_id: 555 }),
      })
    );
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u1" } as never);

    // sin Authorization: la request la hace el navegador al volver de MP
    const res = await request(app)
      .get("/api/users/me/mp-callback")
      .query({ code: "code-de-autorizacion", state: signOAuthState("u1") });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://truckpool.app/perfil?mp=connected");
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } })
    );
    vi.unstubAllGlobals();
  });

  it("el callback con state inválido no toca la base y redirige con el motivo", async () => {
    const res = await request(app)
      .get("/api/users/me/mp-callback")
      .query({ code: "code", state: "state-falsificado" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "https://truckpool.app/perfil?mp=error&reason=MP_OAUTH_INVALID_STATE"
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("el callback sin state no cambia nada", async () => {
    const res = await request(app)
      .get("/api/users/me/mp-callback")
      .query({ code: "code" });

    expect(res.headers.location).toBe(
      "https://truckpool.app/perfil?mp=error&reason=MP_OAUTH_MISSING_STATE"
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("el callback con error de MP redirige sin intentar canjear el code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "x" }) })
    );

    const res = await request(app)
      .get("/api/users/me/mp-callback")
      .query({ error: "access_denied", state: signOAuthState("u1") });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "https://truckpool.app/perfil?mp=error&reason=MP_OAUTH_DENIED"
    );
    // ni una llamada a la API de MP: el usuario denies, no hay code que canjear
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("logout con revocación real", () => {
  /** el `jti` es una claim del payload, no viene en la firma */
  const jtiDe = (token: string): string =>
    JSON.parse(Buffer.from(token.split(".")[1]!, "base64").toString()).jti;

  beforeEach(() => {
    vi.clearAllMocks();
    // por defecto ningún token está revocado
    vi.mocked(prisma.revokedToken.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.revokedToken.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.revokedToken.deleteMany).mockResolvedValue({ count: 0 } as never);
  });

  it("devuelve 204 y anota el jti del token como revocado", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(204);
    expect(prisma.revokedToken.upsert).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.revokedToken.upsert).mock.calls[0]?.[0] as {
      where: { jti: string };
      create: { jti: string; expiresAt: Date };
    };
    // el jti guardado es el del token que se usó, no uno inventado
    expect(arg.where.jti).toBe(jtiDe(companyToken));
    expect(arg.create.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("el token deja de servir apenas se cerró la sesión", async () => {
    await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${companyToken}`);

    // el mismo token, ya revocado
    vi.mocked(prisma.revokedToken.findUnique).mockResolvedValue({
      jti: "el-que-sea",
    } as never);

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${companyToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/cerrado/i);
  });

  it("un token sin revocar sigue entrando", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u2",
      email: "empresa@test.com",
      name: "Empresa",
      role: "COMPANY",
    } as never);

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${companyToken}`);

    // 200 y no 401: el token pasó la firma y no estaba en la lista de revocados
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe("u2");
  });

  it("logout sin token no revoca nada", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(401);
    expect(prisma.revokedToken.upsert).not.toHaveBeenCalled();
  });

  it("cerrar sesión dos veces con el mismo token no falla", async () => {
    const a = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${companyToken}`);
    const b = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${companyToken}`);
    expect(a.status).toBe(204);
    expect(b.status).toBe(204);
    // upsert, no create: la segunda pasada actualiza en vez de romper por duplicado
    expect(vi.mocked(prisma.revokedToken.upsert).mock.calls[1]?.[0]).toMatchObject({
      update: {},
    });
  });

  it("cada token tiene su propio jti", async () => {
    const a = signToken({ id: "u2", role: "COMPANY" });
    const b = signToken({ id: "u2", role: "COMPANY" });
    expect(jtiDe(a)).toBeTruthy();
    expect(jtiDe(a)).not.toBe(jtiDe(b));
  });

  it("el logout también limpia los tokens vencidos", async () => {
    await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${companyToken}`);
    expect(prisma.revokedToken.deleteMany).toHaveBeenCalled();
  });
});

describe("GET /api/trips/cancellation-quote", () => {
  /** fecha del viaje a X horas desde ahora, para cruzar cada ventana */
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const ask = (depositAmount: number, tripDate: string) =>
    request(app).get(
      `/api/trips/cancellation-quote?depositAmount=${depositAmount}&tripDate=${encodeURIComponent(tripDate)}`
    );

  it("es pública: el confirm de retiro se muestra sin sesión", async () => {
    const res = await ask(100_000, inHours(72));
    expect(res.status).toBe(200);
  });

  it("no matchea contra /:id: cancellation-quote no se toma como id de viaje", async () => {
    const res = await ask(100_000, inHours(72));
    expect(res.status).not.toBe(400);
    expect(res.body).toHaveProperty("window");
  });

  it("más de 48h: devuelve toda la seña", async () => {
    const res = await ask(100_000, inHours(72));
    expect(res.body).toEqual({
      window: "FULL_REFUND",
      refundAmount: 100_000,
      feeAmount: 0,
    });
  });

  it("entre 24 y 48h: devuelve la mitad, no un /2 del front", async () => {
    const res = await ask(100_000, inHours(36));
    expect(res.body).toEqual({
      window: "PARTIAL_REFUND",
      refundAmount: 50_000,
      feeAmount: 50_000,
    });
  });

  it("menos de 24h: no devuelve nada y la seña queda de penalización", async () => {
    const res = await ask(100_000, inHours(2));
    expect(res.body).toEqual({
      window: "NO_REFUND",
      refundAmount: 0,
      feeAmount: 100_000,
    });
  });

  /**
   * Este es el test que evita el drift que motivó la unificación: el endpoint tiene
   * que devolver EXACTAMENTE lo mismo que devuelve el retiro real, porque ahora
   * el front arma el texto de confirmación con esto y no con una copia propia.
   */
  it("devuelve lo mismo que la función que usa el retiro real", async () => {
    for (const hours of [72, 36, 2, 48, 24]) {
      const tripDate = inHours(hours);
      const res = await ask(87_000, tripDate);
      const real = quoteCancellation(87_000, hoursUntilTrip(tripDate));
      expect(res.body).toEqual(real);
    }
  });

  it("si PARTIAL_REFUND_RATIO cambia, el endpoint cambia con él (sin tocar el front)", async () => {
    // lo que el front muestra sale de acá, no de una constante suya
    const res = await ask(200_000, inHours(36));
    expect(res.body.refundAmount).toBe(100_000);
    expect(res.body.refundAmount).toBe(200_000 * 0.5);
  });

  it("rechaza una seña negativa", async () => {
    const res = await ask(-1, inHours(72));
    expect(res.status).toBe(400);
  });

  it("rechaza una seña que no es número", async () => {
    const res = await request(app).get(
      `/api/trips/cancellation-quote?depositAmount=abc&tripDate=${encodeURIComponent(inHours(72))}`
    );
    expect(res.status).toBe(400);
  });

  it("rechaza una fecha de viaje que no existe", async () => {
    const res = await ask(100_000, "no-es-fecha");
    expect(res.status).toBe(400);
  });

  ;
});
