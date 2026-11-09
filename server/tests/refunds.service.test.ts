import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { encryptSecret } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { notifyUsers } from "../lib/notifications.js";
import { refundPayment } from "../lib/mercadopago.js";
import { AppError, MpApiError } from "../lib/errors.js";
import {
  MAX_REFUND_ATTEMPTS,
  processPendingRefunds,
  processRefundRequest,
  refundBackoffMs,
} from "../modules/payments/refunds.service.js";

// U12: el worker del outbox de reembolsos. Prisma, MP y los avisos van
// mockeados; el aviso a los admins (PaymentAlert + notifyUsers) corre de verdad
// contra el mock para probar que es idempotente.

vi.mock("../lib/prisma", () => ({
  prisma: {
    refundRequest: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    payment: { findUnique: vi.fn(), update: vi.fn() },
    cargoItem: { findUnique: vi.fn() },
    paymentAlert: { create: vi.fn(), delete: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyUsers: vi.fn().mockResolvedValue(1),
}));

vi.mock("../lib/mercadopago.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mercadopago.js")>();
  return { ...actual, refundPayment: vi.fn() };
});

const AHORA = new Date("2026-11-10T12:00:00.000Z");
const MIN = 60_000;
const TOKEN = "APP_USR-token-del-carrier";
const CONECTADO = { mpUserId: "mp-user-123", mpAccessToken: encryptSecret(TOKEN) };
const DESCONECTADO = { mpUserId: null, mpAccessToken: null };

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: "rr1",
    cargoItemId: "i1",
    targetAmount: new Prisma.Decimal("100.00"),
    status: "PENDING",
    attempts: 0,
    lastError: null,
    carrierDisconnectedAt: null,
    createdAt: new Date(AHORA.getTime() - 60 * MIN),
    updatedAt: new Date(AHORA.getTime() - 60 * MIN),
    ...overrides,
  };
}

function seña(carrier: Record<string, unknown> = CONECTADO) {
  return {
    id: "pay1",
    cargoItemId: "i1",
    type: "DEPOSIT",
    status: "APPROVED",
    amount: new Prisma.Decimal("100.00"),
    mpPaymentId: "mp-77",
    cargoItem: { tripId: "t1", trip: { carrier } },
  };
}

/** las escrituras que cierran un intento (todo lo que no es el reclamo) */
function cierres() {
  return vi
    .mocked(prisma.refundRequest.updateMany)
    .mock.calls.map(
      (c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> }
    )
    .filter((c) => c.data.status !== "PROCESSING");
}

/** las claves de PaymentAlert que se intentaron reservar */
function alertas() {
  return vi
    .mocked(prisma.paymentAlert.create)
    .mock.calls.map((c) => (c[0] as { data: { key: string } }).data.key);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.refundRequest.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.refundRequest.findMany).mockResolvedValue([]);
  vi.mocked(prisma.payment.findUnique).mockResolvedValue(seña() as never);
  vi.mocked(prisma.payment.update).mockResolvedValue({ status: "REFUNDED" } as never);
  vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue({ tripId: "t1" } as never);
  vi.mocked(prisma.paymentAlert.create).mockResolvedValue({} as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "admin1" }] as never);
});

describe("refundBackoffMs", () => {
  it("1, 2, 4… minutos según los intentos, con techo de 60", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => refundBackoffMs(n) / MIN)).toEqual([
      0, 1, 2, 4, 8, 16, 32, 60, 60,
    ]);
  });

  it("el tope es de 8 intentos", () => {
    expect(MAX_REFUND_ATTEMPTS).toBe(8);
  });
});

describe("processRefundRequest: intentos, tope y alertas", () => {
  it("si MP falla, vuelve a PENDING con el intento contado y el código de MP en lastError", async () => {
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(request() as never);
    vi.mocked(refundPayment).mockRejectedValue(
      new MpApiError("no pudimos devolver el dinero con Mercado Pago", "400:2063")
    );

    const outcome = await processRefundRequest("i1", AHORA);

    expect(outcome).toEqual({ kind: "failed" });
    expect(cierres()).toEqual([
      {
        where: { id: "rr1", status: "PROCESSING" },
        data: {
          status: "PENDING",
          attempts: 1,
          lastError: "MP_ERROR:400:2063",
          carrierDisconnectedAt: null,
        },
      },
    ]);
    expect(alertas()).toEqual([]);
  });

  it("un error que no es de MP guarda su código o su nombre, nunca el mensaje crudo", async () => {
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(request() as never);
    vi.mocked(refundPayment).mockRejectedValue(
      new Error("Bearer APP_USR-secreto en el mensaje")
    );

    await processRefundRequest("i1", AHORA);

    expect(cierres()[0]?.data.lastError).toBe("Error");
  });

  it("el 8.º intento fallido pasa a FAILED y avisa a los admins", async () => {
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(
      request({ attempts: 7 }) as never
    );
    vi.mocked(refundPayment).mockRejectedValue(
      new AppError("no pudimos devolver el dinero con Mercado Pago", 502, "MP_ERROR")
    );

    await processRefundRequest("i1", AHORA);

    expect(cierres()[0]).toEqual({
      where: { id: "rr1", status: "PROCESSING" },
      data: {
        status: "FAILED",
        attempts: 8,
        lastError: "MP_ERROR",
        carrierDisconnectedAt: null,
      },
    });
    expect(alertas()).toEqual(["REFUND_FAILED:rr1"]);
    expect(notifyUsers).toHaveBeenCalledWith(
      ["admin1"],
      expect.objectContaining({ type: "PAYMENT_ALERT", tripId: "t1" })
    );
  });

  // No se clasifican los fallos permanentes: el código de MP queda en lastError
  // y la request llega a FAILED por el tope. Los códigos son de ejemplo; no está
  // verificado qué devuelve MP en cada caso.
  it.each([
    ["token inválido", new MpApiError("MP rechazó el token", "401:unauthorized")],
    [
      "falta de saldo",
      new MpApiError("MP rechazó el reembolso", "400:insufficient_amount"),
    ],
  ])(
    "un reembolso que falla por %s termina en FAILED con alerta",
    async (_caso, error) => {
      vi.mocked(refundPayment).mockRejectedValue(error);

      for (let attempts = 0; attempts < MAX_REFUND_ATTEMPTS; attempts++) {
        vi.mocked(prisma.refundRequest.findUnique).mockResolvedValueOnce(
          request({ attempts }) as never
        );
        await processRefundRequest("i1", AHORA);
      }

      const ultimos = cierres().map((c) => c.data.status);
      expect(ultimos).toEqual([...Array(7).fill("PENDING"), "FAILED"]);
      expect(cierres().at(-1)?.data.lastError).toBe(`MP_ERROR:${error.mpCode}`);
      expect(alertas()).toEqual(["REFUND_FAILED:rr1"]);
    }
  );

  it("al completar cierra con CAS sobre PROCESSING y limpia la marca de desconexión", async () => {
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(
      request({ carrierDisconnectedAt: new Date(AHORA.getTime() - 60 * MIN) }) as never
    );
    vi.mocked(refundPayment).mockResolvedValue(100);

    const outcome = await processRefundRequest("i1", AHORA);

    expect(outcome).toEqual({ kind: "completed", paymentStatus: "REFUNDED" });
    expect(cierres()).toEqual([
      {
        where: { id: "rr1", status: "PROCESSING" },
        data: { status: "COMPLETED", carrierDisconnectedAt: null },
      },
    ]);
  });
});

describe("processRefundRequest: fletero desconectado de MP", () => {
  beforeEach(() => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(seña(DESCONECTADO) as never);
  });

  it("no cuenta el intento, queda PENDING y avisa a los admins enseguida", async () => {
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(
      request({ attempts: 2 }) as never
    );

    const outcome = await processRefundRequest("i1", AHORA);

    expect(outcome).toEqual({ kind: "failed" });
    expect(refundPayment).not.toHaveBeenCalled();
    expect(cierres()).toEqual([
      {
        where: { id: "rr1", status: "PROCESSING" },
        data: {
          status: "PENDING",
          lastError: "MP_ACCOUNT_NOT_CONNECTED",
          carrierDisconnectedAt: AHORA,
        },
      },
    ]);
    expect(alertas()).toEqual(["REFUND_CARRIER_DISCONNECTED:rr1"]);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it("si sigue desconectado conserva desde cuándo y el aviso no se repite", async () => {
    const desde = new Date(AHORA.getTime() - 23 * 60 * MIN);
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(
      request({
        carrierDisconnectedAt: desde,
        lastError: "MP_ACCOUNT_NOT_CONNECTED",
      }) as never
    );
    // la clave ya estaba: el aviso salió en la primera corrida
    vi.mocked(prisma.paymentAlert.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicada", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    await processRefundRequest("i1", AHORA);

    expect(cierres()[0]?.data).toEqual({
      status: "PENDING",
      lastError: "MP_ACCOUNT_NOT_CONNECTED",
      carrierDisconnectedAt: desde,
    });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("si no reconecta en 24 h pasa a FAILED con alerta", async () => {
    const desde = new Date(AHORA.getTime() - 24 * 60 * MIN);
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(
      request({ attempts: 1, carrierDisconnectedAt: desde }) as never
    );

    await processRefundRequest("i1", AHORA);

    expect(cierres()[0]?.data).toEqual({
      status: "FAILED",
      lastError: "MP_ACCOUNT_NOT_CONNECTED",
      carrierDisconnectedAt: desde,
    });
    expect(alertas()).toContain("REFUND_FAILED:rr1");
  });
});

describe("processPendingRefunds (worker del outbox)", () => {
  /** findMany según el estado que se pide */
  function enLaBase(rows: { processing?: unknown[]; pending?: unknown[] }) {
    vi.mocked(prisma.refundRequest.findMany).mockImplementation(((args: {
      where: { status: string };
    }) =>
      Promise.resolve(
        args.where.status === "PROCESSING"
          ? (rows.processing ?? [])
          : (rows.pending ?? [])
      )) as never);
  }

  it("retoma un PROCESSING de más de 10 min: cuenta el intento y lo vuelve a PENDING", async () => {
    const colgada = request({
      status: "PROCESSING",
      attempts: 2,
      updatedAt: new Date(AHORA.getTime() - 11 * MIN),
    });
    enLaBase({ processing: [colgada] });

    const res = await processPendingRefunds(AHORA);

    expect(prisma.refundRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "PROCESSING",
          updatedAt: { lt: new Date(AHORA.getTime() - 10 * MIN) },
        },
      })
    );
    // CAS contra lo leído: si el processor original terminó en el medio, no se pisa
    expect(prisma.refundRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "rr1",
        status: "PROCESSING",
        attempts: 2,
        updatedAt: colgada.updatedAt,
      },
      data: { status: "PENDING", attempts: 3, lastError: "PROCESSING_TIMEOUT" },
    });
    expect(res.retomadas).toBe(1);
    // no se reintenta en la misma corrida: le toca el backoff
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("un PROCESSING vencido en el 8.º intento pasa a FAILED con alerta", async () => {
    enLaBase({
      processing: [
        request({
          status: "PROCESSING",
          attempts: 7,
          updatedAt: new Date(AHORA.getTime() - 30 * MIN),
        }),
      ],
    });

    await processPendingRefunds(AHORA);

    expect(prisma.refundRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "FAILED", attempts: 8, lastError: "PROCESSING_TIMEOUT" },
      })
    );
    expect(alertas()).toEqual(["REFUND_FAILED:rr1"]);
  });

  it("si el CAS del PROCESSING vencido pierde, no cuenta ni avisa", async () => {
    enLaBase({
      processing: [
        request({
          status: "PROCESSING",
          attempts: 7,
          updatedAt: new Date(AHORA.getTime() - 30 * MIN),
        }),
      ],
    });
    vi.mocked(prisma.refundRequest.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await processPendingRefunds(AHORA);

    expect(res.retomadas).toBe(0);
    expect(alertas()).toEqual([]);
  });

  it("respeta el backoff: solo procesa las que ya esperaron lo suyo", async () => {
    enLaBase({
      pending: [
        request({ id: "nueva", cargoItemId: "c-nueva", attempts: 0, updatedAt: AHORA }),
        request({
          id: "temprano",
          cargoItemId: "c-temprano",
          attempts: 1,
          updatedAt: new Date(AHORA.getTime() - 59_000),
        }),
        request({
          id: "a-tiempo",
          cargoItemId: "c-a-tiempo",
          attempts: 1,
          updatedAt: new Date(AHORA.getTime() - MIN),
        }),
        request({
          id: "techo-temprano",
          cargoItemId: "c-techo-temprano",
          attempts: 7,
          updatedAt: new Date(AHORA.getTime() - 59 * MIN),
        }),
        request({
          id: "techo",
          cargoItemId: "c-techo",
          attempts: 7,
          updatedAt: new Date(AHORA.getTime() - 60 * MIN),
        }),
      ],
    });
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(null);

    const res = await processPendingRefunds(AHORA);

    const procesadas = vi
      .mocked(prisma.refundRequest.findUnique)
      .mock.calls.map(
        (c) => (c[0] as { where: { cargoItemId: string } }).where.cargoItemId
      );
    expect(procesadas).toEqual(["c-nueva", "c-a-tiempo", "c-techo"]);
    expect(res.procesadas).toBe(3);
  });

  it("retomar no paga dos veces: el reintento pide el mismo objetivo con la clave del intento nuevo", async () => {
    // refundPayment lee lo ya devuelto antes de pedir nada (tests/mercadopago.test.ts):
    // si el intento colgado llegó a MP, el reintento no vuelve a devolver
    enLaBase({
      pending: [request({ attempts: 3, updatedAt: new Date(AHORA.getTime() - 4 * MIN) })],
    });
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(
      request({ attempts: 3 }) as never
    );
    vi.mocked(refundPayment).mockResolvedValue(100);

    await processPendingRefunds(AHORA);

    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(refundPayment).toHaveBeenCalledWith("mp-77", 100, TOKEN, {
      idempotencyKey: "refund-rr1-3",
    });
  });

  it("un error en una request no corta la corrida", async () => {
    enLaBase({
      pending: [
        request({ id: "rota", cargoItemId: "c-rota" }),
        request({ id: "sana", cargoItemId: "c-sana" }),
      ],
    });
    vi.mocked(prisma.refundRequest.findUnique)
      .mockRejectedValueOnce(new Error("la base no responde"))
      .mockResolvedValueOnce(null);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await processPendingRefunds(AHORA);

    expect(prisma.refundRequest.findUnique).toHaveBeenCalledTimes(2);
    expect(res.procesadas).toBe(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("la base no responde");
    error.mockRestore();
  });
});
