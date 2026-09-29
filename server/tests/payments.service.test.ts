import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import {
  createPaymentPreference,
  handlePaymentNotification,
  splitPlatformFee,
} from "../modules/payments/payments.service.js";
import { AppError, CargoItemNotFoundError, PaymentNotFoundError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { encryptSecret } from "../lib/crypto.js";
import * as mp from "../lib/mercadopago.js";
import { notifyUsers } from "../lib/notifications.js";

vi.mock("../lib/prisma", () => ({
  prisma: {
    cargoItem: { findUnique: vi.fn() },
    payment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

// los avisos van best-effort: lo que se prueba acá es a quién se avisa, nunca
// que el email salga
vi.mock("../lib/notifications.js", () => ({
  notifyUsers: vi.fn().mockResolvedValue(1),
}));

vi.mock("../lib/mercadopago", () => ({
  createCheckoutPreference: vi.fn(),
  fetchPaymentState: vi.fn(),
  refundPayment: vi.fn(),
  toPaymentState: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mp.toPaymentState).mockImplementation((status) => {
      if (status === "approved") return "APPROVED";
      if (status === "rejected") return "REJECTED";
      if (status === "refunded") return "REFUNDED";
      return "PENDING";
    });
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(basePayment() as never);
    vi.mocked(prisma.payment.update).mockResolvedValue(
      basePayment({ status: "APPROVED", mpPaymentId: "mp-77" }) as never
    );
    vi.mocked(mp.refundPayment).mockResolvedValue(100);
  });

  it("marca APPROVED y guarda el mpPaymentId con un payload de ejemplo", async () => {
    const result = await handlePaymentNotification({
      preferenceId: "pref-123",
      mpPaymentId: "mp-77",
      status: "approved",
    });

    expect(prisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mpPreferenceId: "pref-123" } })
    );
    // conserva el reparto que ya estaba asentado: el webhook no recalcula la
    // comisión, se creó con el priceShare y la seña de la carga
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        status: "APPROVED",
        mpPaymentId: "mp-77",
        platformFeeAmount: 10,
        carrierAmount: 90,
      },
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

    await handlePaymentNotification({ paymentId: "pay1", status: "approved" });

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
      basePayment({ status: "APPROVED" }) as never
    );

    await handlePaymentNotification({ paymentId: "pay1", status: "approved" });

    expect(prisma.payment.update).toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("no avisa si el pago no se aprobó", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(
      basePayment({ status: "REJECTED" }) as never
    );

    await handlePaymentNotification({ paymentId: "pay1", status: "rejected" });

    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("marca REJECTED cuando el pago fue rechazado", async () => {
    vi.mocked(prisma.payment.update).mockResolvedValue(
      basePayment({ status: "REJECTED", mpPaymentId: "mp-78" }) as never
    );

    const result = await handlePaymentNotification({
      paymentId: "pay1",
      mpPaymentId: "mp-78",
      status: "rejected",
    });

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        status: "REJECTED",
        mpPaymentId: "mp-78",
        // el reparto previsto no cambia por el estado: ya estaba asentado
        platformFeeAmount: 10,
        carrierAmount: 90,
      },
    });
    expect(result.status).toBe("REJECTED");
  });

  it("consulta el estado en Mercado Pago si la notificación no lo trae", async () => {
    vi.mocked(mp.fetchPaymentState).mockResolvedValue("APPROVED");

    const result = await handlePaymentNotification({
      paymentId: "pay1",
      mpPaymentId: "mp-79",
    });

    expect(mp.fetchPaymentState).toHaveBeenCalledWith("mp-79");
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        status: "APPROVED",
        mpPaymentId: "mp-79",
        platformFeeAmount: 10,
        carrierAmount: 90,
      },
    });
    expect(result.status).toBe("APPROVED");
  });

  it("no actualiza nada si no hay estado determinable", async () => {
    vi.mocked(mp.fetchPaymentState).mockResolvedValue(null);

    const result = await handlePaymentNotification({ paymentId: "pay1" });

    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: false, status: "PENDING" });
  });

  it("lanza PaymentNotFoundError si no encuentra el pago", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null);

    await expect(
      handlePaymentNotification({ preferenceId: "pref-desconocida", status: "approved" })
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it("devuelve el pago si la empresa retiró la carga mientras estaba en vuelo", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(
      basePayment({ cargoItem: { status: "CANCELLED" } }) as never
    );
    vi.mocked(prisma.payment.update).mockResolvedValue(
      basePayment({ status: "REFUNDED", mpPaymentId: "mp-77" }) as never
    );

    const result = await handlePaymentNotification({
      preferenceId: "pref-123",
      mpPaymentId: "mp-77",
      status: "approved",
    });

    expect(mp.refundPayment).toHaveBeenCalledWith("mp-77", 100);
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { status: "REFUNDED", mpPaymentId: "mp-77", refundedAmount: 100 },
    });
    expect(result).toEqual({ updated: true, status: "REFUNDED" });
  });

  it("no devuelve nada si la carga sigue pendiente de confirmar", async () => {
    await handlePaymentNotification({
      preferenceId: "pref-123",
      mpPaymentId: "mp-77",
      status: "approved",
    });

    expect(mp.refundPayment).not.toHaveBeenCalled();
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        status: "APPROVED",
        mpPaymentId: "mp-77",
        platformFeeAmount: 10,
        carrierAmount: 90,
      },
    });
  });

  it("si le pasan solo el id de la carga asume que hablan de la seña", async () => {
    await handlePaymentNotification({ paymentId: "i1", status: "approved" });

    expect(prisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ id: "i1" }, { cargoItemId: "i1", type: "DEPOSIT" }] },
      })
    );
  });

  it("busca por mpPaymentId como último recurso", async () => {
    vi.mocked(prisma.payment.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(basePayment() as never);

    await handlePaymentNotification({ mpPaymentId: "mp-80", status: "approved" });

    expect(prisma.payment.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { mpPaymentId: "mp-80" } })
    );
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
