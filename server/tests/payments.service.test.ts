import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import {
  createPaymentPreference,
  handlePaymentNotification,
  splitPlatformFee,
} from "../modules/payments/payments.service.js";
import { AppError, CargoItemNotFoundError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { encryptSecret } from "../lib/crypto.js";
import * as mp from "../lib/mercadopago.js";
import { notifyUsers } from "../lib/notifications.js";

vi.mock("../lib/prisma", () => ({
  prisma: {
    cargoItem: { findUnique: vi.fn(), updateMany: vi.fn() },
    trip: { update: vi.fn() },
    user: { findMany: vi.fn() },
    paymentAlert: { create: vi.fn(), delete: vi.fn() },
    refundRequest: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// los avisos van best-effort: lo que se prueba acá es a quién se avisa, nunca
// que el email salga
vi.mock("../lib/notifications.js", () => ({
  notifyUsers: vi.fn().mockResolvedValue(1),
}));

vi.mock("../lib/mercadopago", async (importOriginal) => ({
  // el resolver del token es lógica pura (descifrar): va el real
  resolveCarrierMpToken: (await importOriginal<typeof import("../lib/mercadopago.js")>())
    .resolveCarrierMpToken,
  createCheckoutPreference: vi.fn(),
  fetchPaymentState: vi.fn(),
  refundPayment: vi.fn(),
}));

const companyUserId = "c1";
const otherCompanyId = "c9";

// en la base el token nunca está en claro: el mock usa el mismo sobre que
// guarda el OAuth, así el descifrado se ejercita de verdad.
const MP_TOKEN_PLAIN = "APP_USR-mp-token-plano";
const MP_TOKEN_STORED = encryptSecret(MP_TOKEN_PLAIN);

function baseCargoItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    tripId: "t1",
    companyId: companyUserId,
    description: "Cajas de maquinaria",
    volume: 10,
    priceShare: new Prisma.Decimal("500.00"),
    depositAmount: new Prisma.Decimal("100.00"),
    status: "PENDING",
    createdAt: new Date(),
    company: { email: "empresa@truckpool.app" },
    trip: {
      status: "OPEN",
      platformFeePercent: 10,
      carrier: { mpUserId: "mp-user-123", mpAccessToken: MP_TOKEN_STORED },
    },
    ...overrides,
  };
}

function basePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay1",
    cargoItemId: "i1",
    amount: new Prisma.Decimal("100.00"),
    status: "PENDING",
    type: "DEPOSIT",
    refundedAmount: null,
    mpPreferenceId: "pref-123",
    mpPaymentId: null,
    // lo que dejó asentado la creation de la preference: la comisión
    // repartida de este pago
    platformFeeAmount: 10,
    carrierAmount: 90,
    createdAt: new Date(),
    updatedAt: new Date(),
    cargoItem: {
      status: "PENDING",
      companyId: companyUserId,
      tripId: "t1",
      trip: {
        platformFeePercent: 10,
        carrier: { mpUserId: "mp-user-123", mpAccessToken: MP_TOKEN_STORED },
      },
    },
    ...overrides,
  };
}

describe("createPaymentPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(baseCargoItem() as never);
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.payment.create).mockResolvedValue(basePayment() as never);
    // por defecto no hay pago previo: la ruta nueva es create
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payment.update).mockResolvedValue(basePayment() as never);
    vi.mocked(mp.createCheckoutPreference).mockResolvedValue({
      preferenceId: "pref-123",
      initPoint:
        "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
      platformFeeAmount: 10,
      carrierAmount: 90,
    });
  });

  it("crea la preference de la seña y devuelve el init_point", async () => {
    const result = await createPaymentPreference("i1", companyUserId);

    expect(result).toEqual({
      paymentId: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      // la carga vale 500 pero la seña es el 20%: se cobran 100
      amount: 100,
      status: "PENDING",
      // 10% de los 100 de la seña: el resto del 10% va con el saldo
      platformFeeAmount: 10,
      carrierAmount: 90,
      initPoint:
        "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
    });
    expect(mp.createCheckoutPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "pay1",
        cargoItemId: "i1",
        amount: 100,
        tripId: "t1",
        paymentType: "DEPOSIT",
        carrierMpUserId: "mp-user-123",
        platformFeeAmount: 10,
      })
    );
    // lo que sale de la base es el sobre cifrado, no el token: el descifrado
    // pasa a último momento y solo vive en la llamada a Mercado Pago
    expect(mp.createCheckoutPreference).toHaveBeenCalledWith(
      expect.objectContaining({ carrierMpAccessToken: MP_TOKEN_PLAIN })
    );
    // la comisión que se le pasa a Mercado Pago es la proporcional a ESTE pago,
    // calculada con el priceShare y la seña de la carga
    expect(mp.createCheckoutPreference).toHaveBeenCalledWith(
      expect.objectContaining({ platformFeeAmount: 10 })
    );
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: {
        cargoItemId: "i1",
        type: "DEPOSIT",
        amount: new Prisma.Decimal("100.00"),
      },
    });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        mpPreferenceId: "pref-123",
        platformFeeAmount: 10,
        carrierAmount: 90,
      },
    });
  });

  it("no cobra si el transportista no tiene cuenta de MP conectada", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(
      baseCargoItem({
        trip: {
          status: "OPEN",
          platformFeePercent: 10,
          carrier: { mpUserId: null, mpAccessToken: null },
        },
      }) as never
    );

    await expect(createPaymentPreference("i1", companyUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: "MP_ACCOUNT_NOT_CONNECTED",
    });
    expect(mp.createCheckoutPreference).not.toHaveBeenCalled();
  });

  it("falla explícito si el token guardado quedó en claro", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(
      baseCargoItem({
        trip: {
          status: "OPEN",
          platformFeePercent: 10,
          carrier: { mpUserId: "mp-user-123", mpAccessToken: "APP_USR-token-en-claro" },
        },
      }) as never
    );

    await expect(createPaymentPreference("i1", companyUserId)).rejects.toMatchObject({
      code: "MP_TOKEN_NOT_ENCRYPTED",
    });
    expect(mp.createCheckoutPreference).not.toHaveBeenCalled();
  });

  it("rechaza a una empresa que no es dueña de la carga (403)", async () => {
    await expect(createPaymentPreference("i1", otherCompanyId)).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });
    expect(mp.createCheckoutPreference).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it("lanza CargoItemNotFoundError si la carga no existe", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(null);
    await expect(createPaymentPreference("nope", companyUserId)).rejects.toBeInstanceOf(
      CargoItemNotFoundError
    );
  });

  it("reutiliza el Payment del mismo tipo si ya había uno", async () => {
    const rejected = basePayment({ status: "REJECTED", mpPaymentId: "mp-9" });
    vi.mocked(prisma.payment.findUnique)
      .mockResolvedValueOnce(rejected as never) // el pago existente
      .mockResolvedValueOnce(basePayment() as never); // la lectura post-reset
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 1 } as never);

    await createPaymentPreference("i1", companyUserId);

    // compare-and-swap: solo resetea si el status sigue siendo el que leímos
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay1", status: "REJECTED" },
      data: {
        amount: new Prisma.Decimal("100.00"),
        status: "PENDING",
        mpPaymentId: null,
        refundedAmount: null,
      },
    });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it("no pisa un pago que se acreditó entre la lectura y el reset", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      basePayment({ status: "PENDING" }) as never
    );
    // el webhook corrió y acreditó entre el findUnique y el updateMany
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(createPaymentPreference("i1", companyUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: "PAYMENT_ALREADY_SETTLED",
    });
    expect(mp.createCheckoutPreference).not.toHaveBeenCalled();
  });

  it("no deja cobrar una seña nueva en una carga ya confirmada", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(
      baseCargoItem({ status: "CONFIRMED" }) as never
    );

    await expect(createPaymentPreference("i1", companyUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: "PAYMENT_ALREADY_SETTLED",
    });
    expect(mp.createCheckoutPreference).not.toHaveBeenCalled();
  });

  it("no deja volver a pagar una seña ya aprobada", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      basePayment({ status: "APPROVED" }) as never
    );

    await expect(createPaymentPreference("i1", companyUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: "PAYMENT_ALREADY_SETTLED",
    });
    expect(mp.createCheckoutPreference).not.toHaveBeenCalled();
  });

  it("no cobra la seña de una carga retirada", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(
      baseCargoItem({ status: "CANCELLED" }) as never
    );

    await expect(createPaymentPreference("i1", companyUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: "CARGO_CANCELLED",
    });
  });

  it("el saldo cobra lo que falta del total", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(
      baseCargoItem({
        status: "CONFIRMED",
        // el override pisa el trip entero: hay que volver a poner el carrier
        // conectado, si no el pago falla por falta de cuenta de MP
        trip: {
          status: "IN_TRANSIT",
          platformFeePercent: 10,
          carrier: { mpUserId: "mp-user-123", mpAccessToken: MP_TOKEN_STORED },
        },
      }) as never
    );
    vi.mocked(prisma.payment.create).mockResolvedValue(
      basePayment({ type: "BALANCE", amount: new Prisma.Decimal("400.00") }) as never
    );
    vi.mocked(prisma.payment.findUnique).mockResolvedValueOnce(null as never);

    const result = await createPaymentPreference("i1", companyUserId, "BALANCE");

    expect(result.amount).toBe(400);
    // la comisión total es 10% de 500 = 50; la seña ya se llevó 10, así que el
    // saldo se lleva los 40 que faltan
    expect(mp.createCheckoutPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 400,
        paymentType: "BALANCE",
        platformFeeAmount: 40,
      })
    );
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: {
        cargoItemId: "i1",
        type: "BALANCE",
        amount: new Prisma.Decimal("400.00"),
      },
    });
  });

  it("no deja pagar el saldo antes de que salga el viaje", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(
      baseCargoItem({ status: "PENDING", trip: { status: "OPEN" } }) as never
    );

    await expect(
      createPaymentPreference("i1", companyUserId, "BALANCE")
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "BALANCE_NOT_DUE",
    });
    expect(mp.createCheckoutPreference).not.toHaveBeenCalled();
  });

  it("no deja pagar un saldo de una carga sin confirmar", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(
      baseCargoItem({ status: "PENDING", trip: { status: "IN_TRANSIT" } }) as never
    );

    await expect(
      createPaymentPreference("i1", companyUserId, "BALANCE")
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "BALANCE_NOT_DUE",
    });
  });
});

describe("handlePaymentNotification", () => {
  /** lo que responde MP al consultar el pago con el token del transportista */
  const mpDice = (
    state: mp.MpPaymentState | null,
    externalReference = "pay1",
    cobro: { amount: number | null; currencyId: string | null } = {
      amount: 100,
      currencyId: "ARS",
    }
  ) =>
    vi.mocked(mp.fetchPaymentState).mockResolvedValue({
      state,
      externalReference,
      ...cobro,
    });

  /** la notificación tal como la arma el controller: data.id firmado + la pista */
  const notificacion = { mpPaymentId: "mp-77", hintPaymentId: "pay1" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(basePayment() as never);
    // la relectura después del CAS: por defecto la carga sigue PENDING. Sin este
    // default cada test heredaba lo que dejó el anterior (clearAllMocks no borra
    // los valores) y un guard roto en la relectura pasaba inadvertido.
    vi.mocked(prisma.payment.findUnique)
      .mockReset()
      .mockResolvedValue(
        basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
      );
    vi.mocked(prisma.payment.update).mockResolvedValue(
      basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
    );
    vi.mocked(mp.refundPayment).mockResolvedValue(100);
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.refundRequest.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.refundRequest.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "admin1" }] as never);
    vi.mocked(prisma.paymentAlert.create).mockResolvedValue({} as never);
    vi.mocked(prisma.paymentAlert.delete).mockResolvedValue({} as never);
    // la transacción corre contra el mismo mock: tx === prisma
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: unknown) =>
      (fn as (tx: typeof prisma) => unknown)(prisma)) as never);
    mpDice("APPROVED");
  });

  /** lo que tira Prisma cuando la clave del aviso ya existe */
  const claveRepetida = () =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });

  /** el aviso a los admins: plata cobrada que nadie más va a mirar */
  const alertaAdmins = () =>
    expect(notifyUsers).toHaveBeenCalledWith(
      ["admin1"],
      expect.objectContaining({ type: "PAYMENT_ALERT", tripId: "t1" })
    );

  /** la RefundRequest que el processor encuentra (la que encoló el webhook o el retiro) */
  const outboxPendiente = (target = "100.00", attempts = 0) =>
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal(target),
      status: "PENDING",
      attempts,
    } as never);

  /** el webhook encola la devolución en el outbox; nunca pisa una que ya estaba */
  const encolo = (target: string) =>
    expect(prisma.refundRequest.upsert).toHaveBeenCalledWith({
      where: { cargoItemId: "i1" },
      create: {
        cargoItemId: "i1",
        targetAmount: new Prisma.Decimal(target),
        status: "PENDING",
      },
      update: {},
    });

  /** ninguna escritura sobre el pago, ni por CAS ni directa */
  const sinEscrituras = () => {
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  };

  it("marca APPROVED con el estado que informa MP y guarda el mpPaymentId", async () => {
    const result = await handlePaymentNotification(notificacion);

    // CAS contra el estado leído. El reparto ya asentado no se escribe: el
    // webhook no recalcula la comisión (se creó con el priceShare y la seña)
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay1", status: "PENDING" },
      data: { status: "APPROVED", mpPaymentId: "mp-77" },
    });
    expect(result).toEqual({ updated: true, status: "APPROVED" });
    expect(notifyUsers).toHaveBeenCalledWith(
      [companyUserId],
      expect.objectContaining({
        type: "PAYMENT_APPROVED",
        title: "acreditamos tu seña",
        tripId: "t1",
      })
    );
  });

  it("avisa del saldo con su propio texto cuando se acredita el saldo", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(
      basePayment({ type: "BALANCE", amount: new Prisma.Decimal("400.00") }) as never
    );
    mpDice("APPROVED", "pay1", { amount: 400, currencyId: "ARS" });

    await handlePaymentNotification(notificacion);

    expect(notifyUsers).toHaveBeenCalledWith(
      [companyUserId],
      expect.objectContaining({
        type: "PAYMENT_APPROVED",
        title: "acreditamos tu saldo",
        body: expect.stringContaining("tu saldo de $400 entró"),
      })
    );
  });

  it("no vuelve a avisar si el pago ya estaba aprobado", async () => {
    // el webhook de Mercado Pago se repite: tres campanas por un pago son ruido
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(
      basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
    );

    await handlePaymentNotification(notificacion);

    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("no avisa si el pago no se aprobó", async () => {
    mpDice("REJECTED");

    await handlePaymentNotification(notificacion);

    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("marca REJECTED cuando MP informa el pago rechazado", async () => {
    mpDice("REJECTED");
    vi.mocked(prisma.payment.update).mockResolvedValue(
      basePayment({ status: "REJECTED", mpPaymentId: "mp-78" }) as never
    );

    const result = await handlePaymentNotification({
      mpPaymentId: "mp-78",
      hintPaymentId: "pay1",
    });

    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay1", status: "PENDING" },
      data: { status: "REJECTED", mpPaymentId: "mp-78" },
    });
    expect(result.status).toBe("REJECTED");
  });

  it("consulta el estado en Mercado Pago con el token del transportista", async () => {
    await handlePaymentNotification({ mpPaymentId: "mp-79", hintPaymentId: "pay1" });

    // el pago vive en la cuenta del transportista: se consulta con su token
    expect(mp.fetchPaymentState).toHaveBeenCalledWith("mp-79", MP_TOKEN_PLAIN);
  });

  it("sin cuenta MP del transportista no consulta ni toca el pago (MP reintenta)", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(
      basePayment({
        cargoItem: {
          ...basePayment().cargoItem,
          trip: {
            platformFeePercent: 10,
            carrier: { mpUserId: null, mpAccessToken: null },
          },
        },
      }) as never
    );

    await expect(handlePaymentNotification(notificacion)).rejects.toMatchObject({
      code: "MP_ACCOUNT_NOT_CONNECTED",
    });
    expect(mp.fetchPaymentState).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("no actualiza nada si MP no informa un estado conocido", async () => {
    mpDice(null);

    const result = await handlePaymentNotification(notificacion);

    sinEscrituras();
    expect(result).toEqual({ updated: false, status: "PENDING" });
  });

  it("busca primero por el data.id firmado y no usa la pista si lo encuentra", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValueOnce(
      basePayment({ mpPaymentId: "mp-77" }) as never
    );

    await handlePaymentNotification(notificacion);

    expect(prisma.payment.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mpPaymentId: "mp-77" } })
    );
  });

  it("una pista manipulada se ignora: MP dice que el pago es de otro", async () => {
    // la query apunta a pay-ajeno, pero el external_reference que devuelve MP
    // (consultado con el data.id firmado) es pay1
    vi.mocked(prisma.payment.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(basePayment({ id: "pay-ajeno" }) as never);

    const result = await handlePaymentNotification({
      mpPaymentId: "mp-77",
      hintPaymentId: "pay-ajeno",
    });

    expect(prisma.payment.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: "pay-ajeno" } })
    );
    sinEscrituras();
    expect(mp.refundPayment).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: false, status: "PENDING" });
  });

  it("un pago desconocido se ignora con 200 (que MP no reintente para siempre)", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null);

    const result = await handlePaymentNotification({
      mpPaymentId: "mp-de-una-preference-de-prueba",
      hintPaymentId: undefined,
    });

    expect(result).toEqual({ updated: false, status: null });
    expect(mp.fetchPaymentState).not.toHaveBeenCalled();
  });

  it("sin data.id no hay nada firmado que consultar", async () => {
    const result = await handlePaymentNotification({
      mpPaymentId: undefined,
      hintPaymentId: "pay1",
    });

    expect(result).toEqual({ updated: false, status: null });
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
    expect(mp.fetchPaymentState).not.toHaveBeenCalled();
  });

  it("devuelve el pago si la empresa retiró la carga mientras estaba en vuelo", async () => {
    const retirada = basePayment({
      cargoItem: {
        ...basePayment().cargoItem,
        status: "CANCELLED",
        cancellationFeeAmount: new Prisma.Decimal("0.00"),
      },
    });
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(retirada as never);
    // la relectura es posterior al CAS: el pago ya está APPROVED con mp-77
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      ...retirada,
      status: "APPROVED",
      mpPaymentId: "mp-77",
    } as never);
    outboxPendiente();
    vi.mocked(prisma.payment.update).mockResolvedValue(
      basePayment({ status: "REFUNDED", mpPaymentId: "mp-77" }) as never
    );

    const result = await handlePaymentNotification(notificacion);

    // primero se reclama el pago con el CAS a APPROVED, después se devuelve
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay1", status: "PENDING" },
      data: { status: "APPROVED", mpPaymentId: "mp-77" },
    });
    // el reembolso queda registrado en el outbox antes de pedírselo a MP
    encolo("100");
    expect(mp.refundPayment).toHaveBeenCalledWith("mp-77", 100, MP_TOKEN_PLAIN, {
      idempotencyKey: "refund-rr1-0",
    });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { status: "REFUNDED", refundedAmount: 100 },
    });
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: true, status: "REFUNDED" });
  });

  /** carga retirada con la seña ya cobrada: la política quedó congelada al retirar */
  const retiradaConSeñaPaga = (fee: string, refundedAmount: string | null) =>
    basePayment({
      status: "APPROVED",
      mpPaymentId: "mp-77",
      refundedAmount: refundedAmount === null ? null : new Prisma.Decimal(refundedAmount),
      cargoItem: {
        ...basePayment().cargoItem,
        status: "CANCELLED",
        cancellationFeeAmount: new Prisma.Decimal(fee),
      },
    });

  it("retiro a 30 h + payment.updated ×3: no reembolsa más que el 50 % de la política", async () => {
    // el retiro dejó una RefundRequest por 50 y el outbox ya devolvió 50; MP
    // sigue informando el pago como approved (parcialmente reembolsado)
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(
      retiradaConSeñaPaga("50.00", "50.00") as never
    );
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      retiradaConSeñaPaga("50.00", "50.00") as never
    );
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("50.00"),
      status: "COMPLETED",
    } as never);

    for (let i = 0; i < 3; i++) await handlePaymentNotification(notificacion);

    expect(mp.refundPayment).not.toHaveBeenCalled();
  });

  it("retiro a menos de 24 h: la seña se retiene entera aunque MP repita el webhook", async () => {
    // reembolso 0 → no hubo RefundRequest ni refundedAmount
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(
      retiradaConSeñaPaga("100.00", null) as never
    );
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      retiradaConSeñaPaga("100.00", null) as never
    );

    await handlePaymentNotification(notificacion);

    expect(mp.refundPayment).not.toHaveBeenCalled();
  });

  describe("monto y moneda", () => {
    it("no aprueba si MP cobró menos que el pago local", async () => {
      mpDice("APPROVED", "pay1", { amount: 50, currencyId: "ARS" });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await handlePaymentNotification(notificacion);

      sinEscrituras();
      // la empresa no recibe "acreditamos": el único aviso es a los admins,
      // porque MP cobró y el pago local quedó PENDING
      expect(notifyUsers).toHaveBeenCalledTimes(1);
      alertaAdmins();
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { role: "ADMIN" },
        select: { id: true },
      });
      expect(result).toEqual({ updated: false, status: "PENDING" });
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it("si el aviso a los admins falla, el webhook responde igual", async () => {
      mpDice("APPROVED", "pay1", { amount: 50, currencyId: "ARS" });
      vi.mocked(prisma.user.findMany).mockRejectedValue(new Error("db caída"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await handlePaymentNotification(notificacion);

      expect(result).toEqual({ updated: false, status: "PENDING" });
      warn.mockRestore();
      error.mockRestore();
    });

    it("no aprueba si MP cobró en otra moneda", async () => {
      mpDice("APPROVED", "pay1", { amount: 100, currencyId: "USD" });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await handlePaymentNotification(notificacion);

      sinEscrituras();
      expect(result).toEqual({ updated: false, status: "PENDING" });
      warn.mockRestore();
    });

    it("un rechazo no depende del monto", async () => {
      mpDice("REJECTED", "pay1", { amount: null, currencyId: null });

      await handlePaymentNotification(notificacion);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "pay1", status: "PENDING" },
        data: { status: "REJECTED", mpPaymentId: "mp-77" },
      });
    });
  });

  describe("carrera entre el retiro y el webhook", () => {
    /** la relectura después del CAS: la empresa retiró con la seña todavía PENDING */
    const retiradaSinSeñaPaga = (overrides: Record<string, unknown> = {}) =>
      basePayment({
        status: "APPROVED",
        mpPaymentId: "mp-77",
        ...overrides,
        cargoItem: {
          ...basePayment().cargoItem,
          status: "CANCELLED",
          cancellationFeeAmount: new Prisma.Decimal("0.00"),
        },
      });

    it("retiro con seña PENDING mientras el webhook aprueba: la seña se reembolsa", async () => {
      // el webhook leyó la carga PENDING; el retiro commiteó antes de que el CAS
      // a APPROVED ganara, así que la relectura ya la ve CANCELLED
      vi.mocked(prisma.payment.findUnique).mockResolvedValue(
        retiradaSinSeñaPaga() as never
      );
      vi.mocked(prisma.payment.update).mockResolvedValue(
        basePayment({ status: "REFUNDED", mpPaymentId: "mp-77" }) as never
      );
      outboxPendiente();

      const result = await handlePaymentNotification(notificacion);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "pay1", status: "PENDING" },
        data: { status: "APPROVED", mpPaymentId: "mp-77" },
      });
      encolo("100");
      expect(mp.refundPayment).toHaveBeenCalledWith("mp-77", 100, MP_TOKEN_PLAIN, {
        idempotencyKey: "refund-rr1-0",
      });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: "pay1" },
        data: { status: "REFUNDED", refundedAmount: 100 },
      });
      // no se avisa "acreditamos tu seña" de una plata que se está devolviendo
      expect(notifyUsers).not.toHaveBeenCalled();
      expect(result).toEqual({ updated: true, status: "REFUNDED" });
    });

    it("dos webhooks simultáneos sobre una carga ya retirada: refundPayment una sola vez", async () => {
      // los dos leen el pago PENDING con la carga CANCELLED; el CAS a APPROVED es
      // el reclamo: solo el que lo gana le pide el reembolso a MP
      const enVuelo = basePayment({
        cargoItem: {
          ...basePayment().cargoItem,
          status: "CANCELLED",
          cancellationFeeAmount: new Prisma.Decimal("0.00"),
        },
      });
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(enVuelo as never);
      vi.mocked(prisma.payment.updateMany)
        .mockResolvedValueOnce({ count: 1 } as never)
        .mockResolvedValueOnce({ count: 0 } as never);
      vi.mocked(prisma.payment.findUnique).mockResolvedValue(
        retiradaSinSeñaPaga() as never
      );
      outboxPendiente();

      await Promise.all([
        handlePaymentNotification(notificacion),
        handlePaymentNotification(notificacion),
      ]);

      expect(mp.refundPayment).toHaveBeenCalledTimes(1);
      expect(mp.refundPayment).toHaveBeenCalledWith("mp-77", 100, MP_TOKEN_PLAIN, {
        idempotencyKey: "refund-rr1-0",
      });
    });

    it("el webhook repetido sobre un APPROVED con la carga retirada sin reembolso, reembolsa", async () => {
      // el primer webhook ganó el CAS y se cayó antes de releer la carga
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(
        basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
      );
      vi.mocked(prisma.payment.findUnique).mockResolvedValue(
        retiradaSinSeñaPaga() as never
      );
      outboxPendiente();

      await handlePaymentNotification(notificacion);

      encolo("100");
      expect(mp.refundPayment).toHaveBeenCalledWith("mp-77", 100, MP_TOKEN_PLAIN, {
        idempotencyKey: "refund-rr1-0",
      });
    });

    it("el ganador del CAS y un webhook repetido a la vez: el reclamo del outbox deja un solo reembolso", async () => {
      // los dos llegan a la devolución (uno por el CAS, el otro por el camino
      // del repetido); el CAS PENDING→PROCESSING de la RefundRequest elige uno
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(
        basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
      );
      vi.mocked(prisma.payment.findUnique).mockResolvedValue(
        retiradaSinSeñaPaga() as never
      );
      outboxPendiente();
      vi.mocked(prisma.refundRequest.updateMany)
        .mockResolvedValueOnce({ count: 1 } as never)
        .mockResolvedValueOnce({ count: 0 } as never);

      await Promise.all([
        handlePaymentNotification(notificacion),
        handlePaymentNotification(notificacion),
      ]);

      expect(mp.refundPayment).toHaveBeenCalledTimes(1);
    });

    it("si MP falla, la devolución queda en el outbox y el webhook pide reintento (502)", async () => {
      vi.mocked(prisma.payment.findUnique).mockResolvedValue(
        retiradaSinSeñaPaga() as never
      );
      outboxPendiente();
      vi.mocked(mp.refundPayment).mockRejectedValue(
        new AppError("no pudimos devolver el dinero con Mercado Pago", 502, "MP_ERROR")
      );

      const err = await handlePaymentNotification(notificacion).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ statusCode: 502, code: "MP_ERROR" });
      // registro durable: aunque MP deje de reintentar, la request sigue ahí
      encolo("100");
      expect(prisma.refundRequest.updateMany).toHaveBeenCalledWith({
        where: { id: "rr1", status: "PROCESSING" },
        data: expect.objectContaining({ status: "PENDING", attempts: 1 }),
      });
      expect(notifyUsers).not.toHaveBeenCalled();
    });

    it("retoma la RefundRequest del retiro sin pisar su monto", async () => {
      // la seña estaba cobrada al retirar a 30 h: el retiro encoló 50 y MP falló.
      // El webhook repetido la reintenta por lo que dijo la política, no por 100.
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(
        basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
      );
      vi.mocked(prisma.payment.findUnique).mockResolvedValue(
        retiradaConSeñaPaga("50.00", null) as never
      );
      outboxPendiente("50.00", 1);
      vi.mocked(mp.refundPayment).mockResolvedValue(50);

      await handlePaymentNotification(notificacion);

      encolo("50");
      expect(mp.refundPayment).toHaveBeenCalledWith("mp-77", 50, MP_TOKEN_PLAIN, {
        idempotencyKey: "refund-rr1-1",
      });
    });

    it("si el reembolso ya quedó asentado, el webhook repetido no reembolsa de nuevo", async () => {
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(
        basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
      );
      vi.mocked(prisma.payment.findUnique).mockResolvedValue(
        retiradaSinSeñaPaga({ refundedAmount: new Prisma.Decimal("50.00") }) as never
      );

      await handlePaymentNotification(notificacion);

      expect(mp.refundPayment).not.toHaveBeenCalled();
    });
  });

  it("no devuelve nada si la carga sigue pendiente de confirmar", async () => {
    await handlePaymentNotification(notificacion);

    expect(mp.refundPayment).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay1", status: "PENDING" },
      data: { status: "APPROVED", mpPaymentId: "mp-77" },
    });
  });

  it("la relectura ve la carga PENDING: no reembolsa ni encola y avisa la seña", async () => {
    // lo que importa es la relectura, no la lectura previa al CAS
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      basePayment({
        status: "APPROVED",
        mpPaymentId: "mp-77",
        refundedAmount: null,
      }) as never
    );

    const result = await handlePaymentNotification(notificacion);

    expect(prisma.payment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pay1" } })
    );
    expect(mp.refundPayment).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(notifyUsers).toHaveBeenCalledWith(
      [companyUserId],
      expect.objectContaining({ title: "acreditamos tu seña" })
    );
    expect(result).toEqual({ updated: true, status: "APPROVED" });
  });

  describe("máquina de estados", () => {
    it("APPROVED → REJECTED no cambia nada (notificación tardía de otro intento)", async () => {
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(
        basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
      );
      mpDice("REJECTED");

      const result = await handlePaymentNotification(notificacion);

      sinEscrituras();
      expect(result).toEqual({ updated: false, status: "APPROVED" });
    });

    it("REFUNDED → APPROVED no cambia nada ni reembolsa", async () => {
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(
        basePayment({
          status: "REFUNDED",
          mpPaymentId: "mp-77",
          refundedAmount: new Prisma.Decimal("100.00"),
          cargoItem: { ...basePayment().cargoItem, status: "CANCELLED" },
        }) as never
      );

      const result = await handlePaymentNotification(notificacion);

      sinEscrituras();
      expect(mp.refundPayment).not.toHaveBeenCalled();
      expect(notifyUsers).not.toHaveBeenCalled();
      expect(result).toEqual({ updated: false, status: "REFUNDED" });
    });

    it("APPROVED → REFUNDED se acepta", async () => {
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(
        basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
      );
      mpDice("REFUNDED");

      const result = await handlePaymentNotification(notificacion);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "pay1", status: "APPROVED", mpPaymentId: "mp-77" },
        data: { status: "REFUNDED", mpPaymentId: "mp-77" },
      });
      expect(result).toEqual({ updated: true, status: "REFUNDED" });
    });

    it("si otro webhook ganó el CAS, no avisa ni informa cambio", async () => {
      vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 0 } as never);

      const result = await handlePaymentNotification(notificacion);

      expect(notifyUsers).not.toHaveBeenCalled();
      expect(result.updated).toBe(false);
    });

    it("mismo estado: solo completa el mpPaymentId que faltaba, sin avisar", async () => {
      mpDice("PENDING");

      const result = await handlePaymentNotification(notificacion);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "pay1", status: "PENDING" },
        data: { mpPaymentId: "mp-77" },
      });
      expect(notifyUsers).not.toHaveBeenCalled();
      expect(result).toEqual({ updated: false, status: "PENDING" });
    });

    it("mismo estado y mismo mpPaymentId: no escribe nada", async () => {
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(
        basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
      );

      await handlePaymentNotification(notificacion);

      sinEscrituras();
    });

    it("pago duplicado: el reembolso de mp-B no pasa a REFUNDED el pago aprobado con mp-A", async () => {
      // la empresa pagó dos veces la misma preference; mp-B no está guardado y
      // se llega por la pista, con el mismo external_reference
      vi.mocked(prisma.payment.findFirst)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          basePayment({ status: "APPROVED", mpPaymentId: "mp-A" }) as never
        );
      mpDice("REFUNDED");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await handlePaymentNotification({
        mpPaymentId: "mp-B",
        hintPaymentId: "pay1",
      });

      sinEscrituras();
      expect(mp.refundPayment).not.toHaveBeenCalled();
      expect(result).toEqual({ updated: false, status: "APPROVED" });
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain("empresa@");
      expect(logged).not.toContain("100");
      // mp-B ya está reembolsado en MP: no quedó plata de más, no hay alerta
      expect(notifyUsers).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("cobro duplicado aprobado (mp-B): no toca el pago y avisa a los admins", async () => {
      vi.mocked(prisma.payment.findFirst)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          basePayment({ status: "APPROVED", mpPaymentId: "mp-A" }) as never
        );
      mpDice("APPROVED");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await handlePaymentNotification({
        mpPaymentId: "mp-B",
        hintPaymentId: "pay1",
      });

      sinEscrituras();
      expect(result).toEqual({ updated: false, status: "APPROVED" });
      // la empresa pagó dos veces: la segunda vive en la cuenta del transportista
      expect(notifyUsers).toHaveBeenCalledTimes(1);
      alertaAdmins();
      const [, aviso] = vi.mocked(notifyUsers).mock.calls[0]!;
      expect(aviso.body).toContain("mp-B");
      expect(aviso.body).not.toContain("empresa@");
      warn.mockRestore();
    });

    describe("avisos a los admins idempotentes", () => {
      /** el pago ya aprobado con mp-A; MP notifica mp-B (aprobado) */
      const duplicado = () => {
        vi.mocked(prisma.payment.findFirst).mockImplementation((async (args: {
          where: { mpPaymentId?: string };
        }) =>
          args.where.mpPaymentId
            ? null
            : basePayment({ status: "APPROVED", mpPaymentId: "mp-A" })) as never);
        mpDice("APPROVED");
      };
      const notificacionB = { mpPaymentId: "mp-B", hintPaymentId: "pay1" };

      it("MP reintenta el mismo webhook del duplicado: un solo aviso", async () => {
        duplicado();
        vi.mocked(prisma.paymentAlert.create)
          .mockResolvedValueOnce({} as never)
          .mockRejectedValue(claveRepetida());
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        for (let i = 0; i < 3; i++) await handlePaymentNotification(notificacionB);

        // la clave es el evento: este pago y este cobro de MP
        expect(prisma.paymentAlert.create).toHaveBeenCalledWith({
          data: { key: "DUPLICATE_CHARGE:pay1:mp-B" },
        });
        expect(notifyUsers).toHaveBeenCalledTimes(1);
        warn.mockRestore();
      });

      it("otro cobro duplicado (mp-C) es otro evento y avisa de nuevo", async () => {
        duplicado();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await handlePaymentNotification(notificacionB);
        await handlePaymentNotification({ mpPaymentId: "mp-C", hintPaymentId: "pay1" });

        expect(prisma.paymentAlert.create).toHaveBeenCalledWith({
          data: { key: "DUPLICATE_CHARGE:pay1:mp-C" },
        });
        expect(notifyUsers).toHaveBeenCalledTimes(2);
        warn.mockRestore();
      });

      it("el monto distinto repetido por MP: un solo aviso", async () => {
        mpDice("APPROVED", "pay1", { amount: 50, currencyId: "ARS" });
        vi.mocked(prisma.paymentAlert.create)
          .mockResolvedValueOnce({} as never)
          .mockRejectedValue(claveRepetida());
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await handlePaymentNotification(notificacion);
        await handlePaymentNotification(notificacion);

        expect(prisma.paymentAlert.create).toHaveBeenCalledWith({
          data: { key: "AMOUNT_MISMATCH:pay1:mp-77" },
        });
        expect(notifyUsers).toHaveBeenCalledTimes(1);
        warn.mockRestore();
      });

      it("si el aviso no sale, libera la clave para que el reintento de MP avise", async () => {
        duplicado();
        vi.mocked(notifyUsers).mockRejectedValueOnce(new Error("db caída"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await handlePaymentNotification(notificacionB);

        expect(result).toEqual({ updated: false, status: "APPROVED" });
        expect(prisma.paymentAlert.delete).toHaveBeenCalledWith({
          where: { key: "DUPLICATE_CHARGE:pay1:mp-B" },
        });
        warn.mockRestore();
        error.mockRestore();
      });
    });

    it("saldo aprobado sobre una carga retirada: no devuelve nada y avisa a los admins", async () => {
      // no debería pasar (el saldo se cobra con la carga confirmada), pero si
      // pasa hay plata cobrada que nadie devuelve: la decisión es de un admin
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(
        basePayment({ type: "BALANCE", amount: new Prisma.Decimal("400.00") }) as never
      );
      mpDice("APPROVED", "pay1", { amount: 400, currencyId: "ARS" });
      vi.mocked(prisma.payment.findUnique).mockResolvedValue(
        basePayment({
          type: "BALANCE",
          status: "APPROVED",
          mpPaymentId: "mp-77",
          amount: new Prisma.Decimal("400.00"),
          cargoItem: {
            ...basePayment().cargoItem,
            status: "CANCELLED",
            cancellationFeeAmount: new Prisma.Decimal("0.00"),
          },
        }) as never
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await handlePaymentNotification(notificacion);

      expect(prisma.refundRequest.upsert).not.toHaveBeenCalled();
      expect(mp.refundPayment).not.toHaveBeenCalled();
      // ni "acreditamos tu saldo" a la empresa: el único aviso es a los admins
      expect(notifyUsers).toHaveBeenCalledTimes(1);
      alertaAdmins();
      expect(prisma.paymentAlert.create).toHaveBeenCalledWith({
        data: { key: "BALANCE_ON_CANCELLED_CARGO:pay1:mp-77" },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ updated: true, status: "APPROVED" });
      warn.mockRestore();
    });

    it("APPROVED → REFUNDED: el CAS exige el mismo mpPaymentId", async () => {
      vi.mocked(prisma.payment.findFirst).mockResolvedValue(
        basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
      );
      mpDice("REFUNDED");

      await handlePaymentNotification(notificacion);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "pay1", status: "APPROVED", mpPaymentId: "mp-77" },
        data: { status: "REFUNDED", mpPaymentId: "mp-77" },
      });
    });

    describe("reintento con otra tarjeta (MP crea un payment id nuevo)", () => {
      /** primer intento rechazado: el pago local quedó apuntando a mp-A */
      const rechazadoConA = (overrides: Record<string, unknown> = {}) =>
        basePayment({ status: "REJECTED", mpPaymentId: "mp-A", ...overrides });

      it("REJECTED → APPROVED reemplaza el mpPaymentId por el del pago aprobado", async () => {
        // mp-B todavía no está guardado: se llega por la pista
        vi.mocked(prisma.payment.findFirst)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(rechazadoConA() as never);

        const result = await handlePaymentNotification({
          mpPaymentId: "mp-B",
          hintPaymentId: "pay1",
        });

        expect(mp.fetchPaymentState).toHaveBeenCalledWith("mp-B", MP_TOKEN_PLAIN);
        expect(prisma.payment.updateMany).toHaveBeenCalledWith({
          where: { id: "pay1", status: "REJECTED" },
          data: { status: "APPROVED", mpPaymentId: "mp-B" },
        });
        expect(notifyUsers).toHaveBeenCalledWith(
          [companyUserId],
          expect.objectContaining({ type: "PAYMENT_APPROVED" })
        );
        expect(result).toEqual({ updated: true, status: "APPROVED" });
      });

      it("el rechazo tardío de mp-A no pisa el mpPaymentId del aprobado (mp-B)", async () => {
        vi.mocked(prisma.payment.findFirst)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(
            basePayment({ status: "APPROVED", mpPaymentId: "mp-B" }) as never
          );
        mpDice("REJECTED");

        await handlePaymentNotification({ mpPaymentId: "mp-A", hintPaymentId: "pay1" });

        sinEscrituras();
      });

      it("con la carga retirada, reembolsa mp-B y nunca el rechazado mp-A", async () => {
        vi.mocked(prisma.payment.findFirst)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(
            rechazadoConA({
              cargoItem: {
                ...basePayment().cargoItem,
                status: "CANCELLED",
                cancellationFeeAmount: new Prisma.Decimal("0.00"),
              },
            }) as never
          );
        // la relectura es posterior al CAS, que dejó el pago APPROVED con mp-B
        vi.mocked(prisma.payment.findUnique).mockResolvedValue(
          rechazadoConA({
            status: "APPROVED",
            mpPaymentId: "mp-B",
            cargoItem: {
              ...basePayment().cargoItem,
              status: "CANCELLED",
              cancellationFeeAmount: new Prisma.Decimal("0.00"),
            },
          }) as never
        );
        outboxPendiente();

        await handlePaymentNotification({ mpPaymentId: "mp-B", hintPaymentId: "pay1" });

        expect(mp.refundPayment).toHaveBeenCalledTimes(1);
        expect(mp.refundPayment).toHaveBeenCalledWith("mp-B", 100, MP_TOKEN_PLAIN, {
          idempotencyKey: "refund-rr1-0",
        });
      });
    });
  });
});

describe("seña devuelta por fuera de la app (desde el panel de MP)", () => {
  // El fletero devolvió la seña entera desde su cuenta de MP: MP pasa el pago a
  // refunded y el webhook lo lleva a REFUNDED. La app solo devuelve señas de
  // cargas ya retiradas, así que una carga viva con la seña REFUNDED es una
  // devolución que la app no pidió: la carga se retira sola, sin penalidad.
  const notificacion = { mpPaymentId: "mp-77", hintPaymentId: "pay1" };

  /** lo que relee la transacción: el pago con su carga y el viaje */
  function devuelta(
    opts: {
      paymentStatus?: string;
      type?: string;
      cargoStatus?: string;
      tripStatus?: string;
      payments?: Array<{ type: string }>;
      capacityTotal?: number;
      cargoItems?: Array<{ id: string; volume: number; status: string }>;
    } = {}
  ) {
    return {
      id: "pay1",
      status: opts.paymentStatus ?? "REFUNDED",
      type: opts.type ?? "DEPOSIT",
      amount: new Prisma.Decimal("100.00"),
      refundedAmount: null,
      cargoItem: {
        id: "i1",
        status: opts.cargoStatus ?? "PENDING",
        companyId: companyUserId,
        volume: 10,
        description: "Cajas de maquinaria",
        company: { name: "Acero SA" },
        payments: opts.payments ?? [{ type: "DEPOSIT" }],
        trip: {
          id: "t1",
          status: opts.tripStatus ?? "OPEN",
          capacityTotal: opts.capacityTotal ?? 30,
          carrierId: "carrier1",
          origin: "Córdoba",
          destination: "Rosario",
          cargoItems: opts.cargoItems ?? [
            { id: "i1", volume: 10, status: opts.cargoStatus ?? "PENDING" },
          ],
        },
      },
    };
  }

  /** MP informa refunded sobre el pago que la app tenía APPROVED */
  function mpInformaDevolucion(local: Record<string, unknown> = {}) {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(
      basePayment({ status: "APPROVED", mpPaymentId: "mp-77", ...local }) as never
    );
    vi.mocked(mp.fetchPaymentState).mockResolvedValue({
      state: "REFUNDED",
      externalReference: "pay1",
      amount: 100,
      currencyId: "ARS",
    });
  }

  const serializacion = () =>
    new Prisma.PrismaClientKnownRequestError("could not serialize access", {
      code: "P2034",
      clientVersion: "test",
    });

  /** a quién se avisó y con qué tipo */
  const avisados = () =>
    vi.mocked(notifyUsers).mock.calls.map(([ids, data]) => ({ ids, type: data.type }));

  /** nunca otra devolución: ni MP ni el outbox */
  const sinReembolsoNuevo = () => {
    expect(mp.refundPayment).not.toHaveBeenCalled();
    expect(prisma.refundRequest.upsert).not.toHaveBeenCalled();
  };

  const cargaRetirada = () =>
    expect(prisma.cargoItem.updateMany).toHaveBeenCalledWith({
      where: { id: "i1", status: { in: ["PENDING", "CONFIRMED"] } },
      data: {
        status: "CANCELLED",
        cancelledAt: expect.any(Date),
        cancellationFeeAmount: new Prisma.Decimal(0),
      },
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: unknown) =>
      (fn as (tx: typeof prisma) => unknown)(prisma)) as never);
    mpInformaDevolucion();
    vi.mocked(prisma.payment.findUnique)
      .mockReset()
      .mockResolvedValue(devuelta() as never);
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.cargoItem.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.trip.update).mockResolvedValue({} as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "admin1" }] as never);
    vi.mocked(prisma.paymentAlert.create).mockResolvedValue({} as never);
    vi.mocked(notifyUsers).mockResolvedValue(1);
  });

  it("carga PENDING: la retira sin penalidad, asienta lo devuelto y avisa a la empresa y al fletero", async () => {
    const result = await handlePaymentNotification(notificacion);

    expect(result).toEqual({ updated: true, status: "REFUNDED" });
    // la relectura y la escritura van en una transacción serializable: se
    // puede cruzar con el retiro de la empresa
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    );
    cargaRetirada();
    // MP devolvió el total: queda asentado, y con eso nada lo vuelve a devolver
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay1", status: "REFUNDED", refundedAmount: null },
      data: { refundedAmount: new Prisma.Decimal("100.00") },
    });
    // el viaje no estaba lleno: sigue OPEN
    expect(prisma.trip.update).not.toHaveBeenCalled();
    expect(avisados()).toEqual([
      { ids: [companyUserId], type: "CARGO_CANCELLED" },
      { ids: ["carrier1"], type: "CARGO_CANCELLED" },
    ]);
    sinReembolsoNuevo();
  });

  it("carga CONFIRMED con el viaje FULL: la retira igual y el viaje vuelve a OPEN", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      devuelta({
        cargoStatus: "CONFIRMED",
        tripStatus: "FULL",
        capacityTotal: 20,
        cargoItems: [
          { id: "i1", volume: 10, status: "CONFIRMED" },
          { id: "i2", volume: 10, status: "CONFIRMED" },
        ],
      }) as never
    );

    await handlePaymentNotification(notificacion);

    cargaRetirada();
    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "OPEN" },
    });
    expect(avisados()).toHaveLength(2);
    sinReembolsoNuevo();
  });

  it("carga con un pago de saldo (BALANCE): no la toca y avisa a los admins", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      devuelta({
        cargoStatus: "CONFIRMED",
        payments: [{ type: "DEPOSIT" }, { type: "BALANCE" }],
      }) as never
    );

    await handlePaymentNotification(notificacion);

    expect(prisma.cargoItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.trip.update).not.toHaveBeenCalled();
    expect(prisma.paymentAlert.create).toHaveBeenCalledWith({
      data: { key: "EXTERNAL_REFUND:pay1:mp-77" },
    });
    expect(avisados()).toEqual([{ ids: ["admin1"], type: "PAYMENT_ALERT" }]);
    sinReembolsoNuevo();
  });

  it("viaje en curso: no toca la carga y avisa a los admins", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      devuelta({ cargoStatus: "CONFIRMED", tripStatus: "IN_TRANSIT" }) as never
    );

    await handlePaymentNotification(notificacion);

    expect(prisma.cargoItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentAlert.create).toHaveBeenCalledWith({
      data: { key: "EXTERNAL_REFUND:pay1:mp-77" },
    });
    expect(avisados()).toEqual([{ ids: ["admin1"], type: "PAYMENT_ALERT" }]);
    sinReembolsoNuevo();
  });

  it("devolución del saldo: no toca la carga y avisa a los admins", async () => {
    mpInformaDevolucion({ type: "BALANCE" });
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      devuelta({
        type: "BALANCE",
        cargoStatus: "CONFIRMED",
        tripStatus: "IN_TRANSIT",
        payments: [{ type: "DEPOSIT" }, { type: "BALANCE" }],
      }) as never
    );

    await handlePaymentNotification(notificacion);

    expect(prisma.cargoItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentAlert.create).toHaveBeenCalledWith({
      data: { key: "EXTERNAL_REFUND:pay1:mp-77" },
    });
    expect(avisados()).toEqual([{ ids: ["admin1"], type: "PAYMENT_ALERT" }]);
    sinReembolsoNuevo();
  });

  it("carga ya retirada (la devolución la pidió la app): no hace nada más", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      devuelta({ cargoStatus: "CANCELLED" }) as never
    );

    const result = await handlePaymentNotification(notificacion);

    expect(result).toEqual({ updated: true, status: "REFUNDED" });
    expect(prisma.cargoItem.updateMany).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(prisma.paymentAlert.create).not.toHaveBeenCalled();
    sinReembolsoNuevo();
  });

  it("caída entre REFUNDED y el retiro: la notificación repetida termina el retiro", async () => {
    // el webhook anterior pasó el pago a REFUNDED y se cayó antes de retirar
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(
      basePayment({ status: "REFUNDED", mpPaymentId: "mp-77" }) as never
    );

    const result = await handlePaymentNotification(notificacion);

    // el pago no se vuelve a mover; solo se retira la carga
    expect(prisma.payment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: expect.anything() }),
      })
    );
    cargaRetirada();
    expect(avisados()).toHaveLength(2);
    expect(result).toEqual({ updated: false, status: "REFUNDED" });
    sinReembolsoNuevo();
  });

  it("webhook duplicado: el segundo no retira ni avisa de nuevo", async () => {
    await handlePaymentNotification(notificacion);

    // MP repite la notificación: el pago ya está REFUNDED y la carga retirada
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(
      basePayment({ status: "REFUNDED", mpPaymentId: "mp-77" }) as never
    );
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      devuelta({ cargoStatus: "CANCELLED" }) as never
    );
    await handlePaymentNotification(notificacion);

    expect(prisma.cargoItem.updateMany).toHaveBeenCalledTimes(1);
    expect(avisados()).toHaveLength(2);
    sinReembolsoNuevo();
  });

  it("carrera con el retiro de la empresa: si la retiró antes de la escritura, no avisa ni toca el viaje", async () => {
    // la empresa retiró la carga entre la relectura y el update: el CAS no la encuentra
    vi.mocked(prisma.cargoItem.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      devuelta({ tripStatus: "FULL", capacityTotal: 10 }) as never
    );

    await handlePaymentNotification(notificacion);

    expect(prisma.payment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refundedAmount: expect.anything() }),
      })
    );
    expect(prisma.trip.update).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
    sinReembolsoNuevo();
  });

  it("conflicto de serialización con otra transacción: reintenta y retira una sola vez", async () => {
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce(serializacion())
      .mockImplementation((async (fn: unknown) =>
        (fn as (tx: typeof prisma) => unknown)(prisma)) as never);

    await handlePaymentNotification(notificacion);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.cargoItem.updateMany).toHaveBeenCalledTimes(1);
    expect(avisados()).toHaveLength(2);
    sinReembolsoNuevo();
  });

  it("si el conflicto no se resuelve, el webhook falla para que MP reintente, sin avisar", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(serializacion());

    await expect(handlePaymentNotification(notificacion)).rejects.toMatchObject({
      code: "P2034",
    });
    expect(notifyUsers).not.toHaveBeenCalled();
    sinReembolsoNuevo();
  });

  it("si falla un aviso, la carga igual queda retirada, el otro aviso sale y el webhook responde bien", async () => {
    // falla el de la empresa: el del fletero sale igual
    vi.mocked(notifyUsers).mockRejectedValueOnce(new Error("base caída"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await handlePaymentNotification(notificacion);

    cargaRetirada();
    expect(result).toEqual({ updated: true, status: "REFUNDED" });
    expect(avisados()).toEqual([
      { ids: [companyUserId], type: "CARGO_CANCELLED" },
      { ids: ["carrier1"], type: "CARGO_CANCELLED" },
    ]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("devolución parcial (MP sigue en approved): no toca la carga", async () => {
    vi.mocked(mp.fetchPaymentState).mockResolvedValue({
      state: "APPROVED",
      externalReference: "pay1",
      amount: 100,
      currencyId: "ARS",
    });
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
    );

    await handlePaymentNotification(notificacion);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cargoItem.updateMany).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
    sinReembolsoNuevo();
  });
});

describe("errores de pago", () => {
  it("PaymentRequiredError expone 409 y el código", () => {
    const err = new AppError("x", 409, "PAYMENT_REQUIRED");
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(409);
  });
});

describe("reparto de la comisión de plataforma", () => {
  const dec = (v: string) => new Prisma.Decimal(v);

  it("la seña se lleva su parte proporcional y el saldo el resto del total", () => {
    const item = { priceShare: dec("500.00"), depositAmount: dec("100.00") };

    // 10% de 500 = 50 de comisión en toda la carga
    const deposit = splitPlatformFee(item, 10, "DEPOSIT");
    const balance = splitPlatformFee(item, 10, "BALANCE");

    expect(deposit.platformFeeAmount).toBe(10); // 10% de la seña
    expect(balance.platformFeeAmount).toBe(40); // lo que faltaba del total
  });

  it("la suma de los dos pagos da exactamente el 10% del priceShare", () => {
    const item = { priceShare: dec("500.00"), depositAmount: dec("100.00") };

    const total =
      splitPlatformFee(item, 10, "DEPOSIT").platformFeeAmount +
      splitPlatformFee(item, 10, "BALANCE").platformFeeAmount;

    expect(total).toBe(50);
    // ni un peso más que el 10% del total
    expect(total).toBe(Number(item.priceShare.mul(10).div(100)));
  });

  it("no se cuelga un peso por redondear los dos porcentajes por separado", () => {
    // con centavos impares, redondear 10% de la seña y 10% del saldo por
    // separado da 10.00 en vez de 10.01: el saldo tiene que absorbing el resto
    const item = { priceShare: dec("100.05"), depositAmount: dec("50.03") };

    const deposit = splitPlatformFee(item, 10, "DEPOSIT");
    const balance = splitPlatformFee(item, 10, "BALANCE");
    const total = deposit.platformFeeAmount + balance.platformFeeAmount;

    expect(deposit.platformFeeAmount + balance.platformFeeAmount).toBe(10.01);
    // lo que daría el cálculo ingenuo, que es lo que hay que evitar
    const ingenuo = Math.round(50.03 * 10) / 100 + Math.round(50.02 * 10) / 100;
    expect(total).not.toBe(ingenuo);
    expect(total).toBe(10.01);
  });

  it("el neto del transportista más la comisión da lo que se cobra", () => {
    const item = { priceShare: dec("500.00"), depositAmount: dec("100.00") };

    for (const type of ["DEPOSIT", "BALANCE"] as const) {
      const { platformFeeAmount, carrierAmount } = splitPlatformFee(item, 10, type);
      const charged = type === "DEPOSIT" ? item.depositAmount : dec("400.00");
      expect(platformFeeAmount + carrierAmount).toBe(Number(charged));
    }
  });

  it("respeta un porcentaje distinto del 10% del viaje", () => {
    const item = { priceShare: dec("1000.00"), depositAmount: dec("500.00") };

    const deposit = splitPlatformFee(item, 20, "DEPOSIT");
    const balance = splitPlatformFee(item, 20, "BALANCE");

    expect(deposit.platformFeeAmount).toBe(100);
    expect(balance.platformFeeAmount).toBe(100);
    expect(deposit.platformFeeAmount + balance.platformFeeAmount).toBe(200);
  });

  it("con 100% de comisión el transportista se queda con nada", () => {
    const item = { priceShare: dec("500.00"), depositAmount: dec("100.00") };

    const deposit = splitPlatformFee(item, 100, "DEPOSIT");
    const balance = splitPlatformFee(item, 100, "BALANCE");

    expect(deposit.platformFeeAmount).toBe(100);
    expect(deposit.carrierAmount).toBe(0);
    expect(balance.platformFeeAmount).toBe(400);
    expect(balance.carrierAmount).toBe(0);
  });

  it("rechaza un porcentaje imposible en vez de pagar de más", () => {
    const item = { priceShare: dec("500.00"), depositAmount: dec("100.00") };

    for (const percent of [-1, 101, Number.NaN]) {
      expect(() => splitPlatformFee(item, percent, "DEPOSIT")).toThrowError(
        expect.objectContaining({ code: "MP_INVALID_FEE_PERCENT" })
      );
    }
  });
});
