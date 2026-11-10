import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encryptSecret } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { notifyUsers } from "../lib/notifications.js";
import { searchPaymentsByExternalReference } from "../lib/mercadopago.js";
import { AppError } from "../lib/errors.js";
import { handlePaymentNotification } from "../modules/payments/payments.service.js";
import {
  RECONCILE_BATCH,
  reconcilePendingPayments,
  resetReconcileCursor,
} from "../modules/payments/reconcile.service.js";

// Conciliación de pagos con MP. La máquina de estados (handlePaymentNotification)
// va mockeada: tiene sus tests en payments.service.test.ts, incluido el primer
// aviso de un pago que llega solo con la pista (`hintPaymentId`). Acá se prueba
// qué pagos se miran, qué se le pasa y que nada corte la corrida. El aviso a los
// admins (PaymentAlert + notifyUsers) corre de verdad contra el mock.

vi.mock("../lib/prisma", () => ({
  prisma: {
    payment: { findMany: vi.fn() },
    paymentAlert: { create: vi.fn(), delete: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyUsers: vi.fn().mockResolvedValue(1),
}));

vi.mock("../lib/mercadopago.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mercadopago.js")>();
  return { ...actual, searchPaymentsByExternalReference: vi.fn() };
});

vi.mock("../modules/payments/payments.service.js", () => ({
  handlePaymentNotification: vi
    .fn()
    .mockResolvedValue({ updated: true, status: "APPROVED" }),
}));

const AHORA = new Date("2026-11-10T12:00:00.000Z");
const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const TOKEN = "APP_USR-token-del-carrier";

const conectado = { mpUserId: "mp-user-1", mpAccessToken: encryptSecret(TOKEN) };

function pago(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay1",
    status: "PENDING",
    cargoItem: { tripId: "t1", trip: { carrier: conectado } },
    ...overrides,
  };
}

function candidatos(...pagos: ReturnType<typeof pago>[]) {
  vi.mocked(prisma.payment.findMany).mockResolvedValueOnce(pagos as never);
}

function enMp(...pagos: { id: string; state: string | null }[]) {
  vi.mocked(searchPaymentsByExternalReference).mockResolvedValueOnce(
    pagos.map((p) => ({ externalReference: "pay1", ...p })) as never
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetReconcileCursor();
  vi.mocked(prisma.payment.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(searchPaymentsByExternalReference).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.paymentAlert.create).mockResolvedValue({} as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "admin1" }] as never);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("reconcilePendingPayments: qué pagos mira", () => {
  it("PENDING y REJECTED con preference, quietos hace 10 min; sin límite si sostienen algo vivo, si no hasta 7 días", async () => {
    await reconcilePendingPayments(AHORA);

    expect(prisma.payment.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["PENDING", "REJECTED"] },
        mpPreferenceId: { not: null },
        updatedAt: { lt: new Date(AHORA.getTime() - 10 * MIN) },
        OR: [
          // la seña de una carga activa en un viaje que no salió
          {
            type: "DEPOSIT",
            cargoItem: {
              status: { in: ["PENDING", "CONFIRMED"] },
              trip: { status: { in: ["OPEN", "FULL"] } },
            },
          },
          // el saldo de un viaje en camino
          { type: "BALANCE", cargoItem: { trip: { status: "IN_TRANSIT" } } },
          // el resto, hasta 7 días desde su último cambio
          { updatedAt: { gte: new Date(AHORA.getTime() - 7 * DIA) } },
        ],
      },
      select: expect.any(Object),
      orderBy: { id: "asc" },
      take: RECONCILE_BATCH,
    });
  });

  it("recorre todos los pagos aunque haya más de una tanda, y después vuelve a empezar", async () => {
    const tanda = Array.from({ length: RECONCILE_BATCH }, (_, i) =>
      pago({ id: `pay${String(i).padStart(3, "0")}` })
    );
    candidatos(...tanda);
    candidatos(pago({ id: "pay999" }));

    await reconcilePendingPayments(AHORA);
    await reconcilePendingPayments(AHORA);
    await reconcilePendingPayments(AHORA);

    const wheres = vi
      .mocked(prisma.payment.findMany)
      .mock.calls.map(([arg]) => (arg as { where: { id?: unknown } }).where.id);
    // la segunda sigue después del último de la primera; la tercera, desde el principio
    expect(wheres).toEqual([undefined, { gt: "pay099" }, undefined]);
  });
});

describe("reconcilePendingPayments: pagos PENDING", () => {
  it("busca en MP con el token del fletero y pasa cada pago por la máquina de estados, con la pista del pago local", async () => {
    candidatos(pago());
    enMp({ id: "mp-1", state: "REJECTED" }, { id: "mp-2", state: "APPROVED" });

    expect(await reconcilePendingPayments(AHORA)).toEqual({ revisados: 1 });

    expect(searchPaymentsByExternalReference).toHaveBeenCalledWith("pay1", TOKEN);
    // del más viejo al más nuevo, como habrían llegado los webhooks
    expect(vi.mocked(handlePaymentNotification).mock.calls).toEqual([
      [{ mpPaymentId: "mp-1", hintPaymentId: "pay1" }],
      [{ mpPaymentId: "mp-2", hintPaymentId: "pay1" }],
    ]);
  });

  it("un pago que MP todavía no tiene no hace nada", async () => {
    candidatos(pago());
    enMp();

    await reconcilePendingPayments(AHORA);

    expect(handlePaymentNotification).not.toHaveBeenCalled();
  });

  it("un fletero desconectado no corta la corrida", async () => {
    candidatos(
      pago({
        id: "pay-desconectado",
        cargoItem: {
          tripId: "t1",
          trip: { carrier: { mpUserId: null, mpAccessToken: null } },
        },
      }),
      pago({ id: "pay2" })
    );
    vi.mocked(searchPaymentsByExternalReference).mockResolvedValueOnce([
      { id: "mp-2", state: "APPROVED", externalReference: "pay2" },
    ] as never);

    expect(await reconcilePendingPayments(AHORA)).toEqual({ revisados: 2 });

    expect(searchPaymentsByExternalReference).toHaveBeenCalledTimes(1);
    expect(handlePaymentNotification).toHaveBeenCalledWith({
      mpPaymentId: "mp-2",
      hintPaymentId: "pay2",
    });
    expect(JSON.stringify(errorSpy.mock.calls[0])).toContain("MP_ACCOUNT_NOT_CONNECTED");
  });

  it("un error de MP en un pago no frena los otros y el log no lleva el mensaje", async () => {
    candidatos(pago({ id: "pay-roto" }), pago({ id: "pay2" }));
    vi.mocked(searchPaymentsByExternalReference)
      .mockRejectedValueOnce(new AppError("token APP_USR-secreto", 502, "MP_ERROR"))
      .mockResolvedValueOnce([
        { id: "mp-2", state: "APPROVED", externalReference: "pay2" },
      ] as never);

    await reconcilePendingPayments(AHORA);

    expect(handlePaymentNotification).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorSpy.mock.calls[0]);
    expect(logged).toContain("MP_ERROR");
    expect(logged).not.toContain("APP_USR-secreto");
  });

  it("si la máquina de estados falla con un pago, sigue con el siguiente", async () => {
    candidatos(pago({ id: "pay1" }), pago({ id: "pay2" }));
    enMp({ id: "mp-1", state: "APPROVED" });
    vi.mocked(searchPaymentsByExternalReference).mockResolvedValueOnce([
      { id: "mp-2", state: "APPROVED", externalReference: "pay2" },
    ] as never);
    vi.mocked(handlePaymentNotification).mockRejectedValueOnce(new Error("x"));

    await reconcilePendingPayments(AHORA);

    expect(handlePaymentNotification).toHaveBeenCalledTimes(2);
  });
});

describe("reconcilePendingPayments: pagos REJECTED", () => {
  it("si MP tiene un pago aprobado, avisa a los admins una vez y no cambia el estado", async () => {
    candidatos(pago({ status: "REJECTED" }));
    enMp({ id: "mp-1", state: "REJECTED" }, { id: "mp-2", state: "APPROVED" });

    await reconcilePendingPayments(AHORA);

    expect(handlePaymentNotification).not.toHaveBeenCalled();
    expect(prisma.paymentAlert.create).toHaveBeenCalledWith({
      data: { key: "REJECTED_BUT_APPROVED:pay1:mp-2" },
    });
    expect(notifyUsers).toHaveBeenCalledWith(
      ["admin1"],
      expect.objectContaining({ type: "PAYMENT_ALERT", tripId: "t1" })
    );
  });

  it("en la corrida siguiente no vuelve a avisar (la clave ya existe)", async () => {
    candidatos(pago({ status: "REJECTED" }));
    enMp({ id: "mp-2", state: "APPROVED" });
    // la clave del aviso ya estaba reservada por la corrida anterior
    const { Prisma } = await import("@prisma/client");
    vi.mocked(prisma.paymentAlert.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicada", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    await reconcilePendingPayments(AHORA);

    expect(notifyUsers).not.toHaveBeenCalled();
    expect(handlePaymentNotification).not.toHaveBeenCalled();
  });

  it("sin un pago aprobado en MP no avisa nada", async () => {
    candidatos(pago({ status: "REJECTED" }));
    enMp({ id: "mp-1", state: "REJECTED" });

    await reconcilePendingPayments(AHORA);

    expect(prisma.paymentAlert.create).not.toHaveBeenCalled();
    expect(handlePaymentNotification).not.toHaveBeenCalled();
  });
});
