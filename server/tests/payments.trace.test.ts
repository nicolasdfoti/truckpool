import { describe, it, expect, beforeEach, vi } from "vitest";

// Test nuevo: cubre `getPaymentDetails` (mapeo del pago completo + traducción
// de errores) y el control de acceso de `tracePayment`. Los tests existentes de
// `mercadopago.test.ts` y `payments.service.test.ts` no se tocan.
//
// El SDK de Mercado Pago se reemplaza entero: acá no hay red. Lo que se prueba es
// cómo mapeamos lo que MP devuelve y cómo traducimos sus errores a AppError.
const { paymentGet, mpConfigs } = vi.hoisted(() => ({
  paymentGet: vi.fn(),
  // para verificar de qué token sale la consulta (siempre el de la plataforma:
  // es el riesgo conocido que esta función todavía no resuelve)
  mpConfigs: [] as Array<{ accessToken?: string }>,
}));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {
    constructor(readonly opts: { accessToken?: string }) {
      mpConfigs.push(opts);
    }
  },
  Payment: class {
    get = paymentGet;
  },
  PaymentMethod: class {
    get = vi.fn();
  },
  PaymentRefund: class {
    create = vi.fn();
    total = vi.fn();
  },
  Preference: class {
    create = vi.fn();
  },
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    payment: { findFirst: vi.fn() },
    trip: { findUnique: vi.fn() },
  },
}));

const { getPaymentDetails } = await import("../lib/mercadopago.js");
const { tracePayment } = await import("../modules/payments/payments.service.js");
const { prisma } = await import("../lib/prisma.js");
const { AppError } = await import("../lib/errors.js");

const MP_ID = "181493287400";
const MP_TOKEN_DE_PLATAFORMA = "APP_USR-token-de-plataforma-de-prueba";

const paymentFindFirst = prisma.payment.findFirst as unknown as ReturnType<typeof vi.fn>;
const tripFindUnique = prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>;

/** lo que devuelve GET /v1/payments/:id para un pago acreditado */
function pagoAprobado(overrides: Record<string, unknown> = {}) {
  return {
    id: 181493287400,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 2500.5,
    currency_id: "ARS",
    live_mode: false,
    external_reference: "payment-interno-1",
    date_approved: "2026-09-30T12:00:00.000-04:00",
    ...overrides,
  };
}

beforeEach(() => {
  paymentGet.mockReset();
  mpConfigs.length = 0;
  paymentFindFirst.mockReset();
  tripFindUnique.mockReset();
  process.env.MP_ACCESS_TOKEN = MP_TOKEN_DE_PLATAFORMA;
});

describe("getPaymentDetails", () => {
  it("mapea el pago completo cuando MP responde", async () => {
    paymentGet.mockResolvedValue(pagoAprobado());

    const details = await getPaymentDetails(MP_ID);

    expect(details).toEqual({
      id: MP_ID,
      status: "approved",
      mappedStatus: "APPROVED",
      statusDetail: "accredited",
      amount: 2500.5,
      currencyId: "ARS",
      liveMode: false,
      externalReference: "payment-interno-1",
      dateApproved: "2026-09-30T12:00:00.000-04:00",
    });
    expect(paymentGet).toHaveBeenCalledWith({ id: MP_ID });
  });

  it("convierte el id numérico del SDK en string, que es como lo usa MP", async () => {
    // el SDK tipa `id` como number pero MP lo devuelve como string: si esto se
    // rompe, el id que vuelve no sirve para consultar el pago después
    paymentGet.mockResolvedValue(pagoAprobado({ id: 181493287400 }));

    const details = await getPaymentDetails(MP_ID);

    expect(details.id).toBe(MP_ID);
    expect(typeof details.id).toBe("string");
  });

  it("deja mappedStatus en null para un estado que no conocemos", async () => {
    // antes de que exista el estado en el mapa, el pago no se puede acreditar:
    // null obliga a decidir qué hacer en vez de asumir PENDING
    paymentGet.mockResolvedValue(pagoAprobado({ status: "borboleta" }));

    const details = await getPaymentDetails(MP_ID);

    expect(details.status).toBe("borboleta");
    expect(details.mappedStatus).toBeNull();
  });

  it("trae liveMode en true cuando el pago se cobró de verdad", async () => {
    paymentGet.mockResolvedValue(pagoAprobado({ live_mode: true }));

    const details = await getPaymentDetails(MP_ID);

    expect(details.liveMode).toBe(true);
  });

  it("asume sandbox si MP no manda live_mode", async () => {
    paymentGet.mockResolvedValue(pagoAprobado({ live_mode: undefined }));

    const details = await getPaymentDetails(MP_ID);

    expect(details.liveMode).toBe(false);
  });

  it("sube 404 entendible cuando MP no tiene el pago", async () => {
    // el caso que pedía el hallazgo 5: antes esto subía crudo y el handler
    // global lo volvía un 500 genérico
    paymentGet.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 404"), { status: 404 })
    );

    const error = await getPaymentDetails(MP_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(404);
    expect(appError.code).toBe("MP_PAYMENT_NOT_FOUND");
    // el mensaje tiene que explicar el caso del transportista, que es la
    //reason real por la que un pago existente devuelve 404 acá
    expect(appError.message).toContain("transportista");
  });

  it("detecta el 404 aunque venga en response.status y no en status", async () => {
    paymentGet.mockRejectedValue(
      Object.assign(new Error("not found"), { response: { status: 404 } })
    );

    await expect(getPaymentDetails(MP_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "MP_PAYMENT_NOT_FOUND",
    });
  });

  it("sube 502 sanitizado si MP falla por otra razón", async () => {
    paymentGet.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 500"), { status: 500 })
    );

    const error = await getPaymentDetails(MP_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(502);
    expect(appError.code).toBe("MP_ERROR");
    expect(appError.message).not.toContain(MP_TOKEN_DE_PLATAFORMA);
  });

  it("sube 502 si MP responde algo sin id", async () => {
    paymentGet.mockResolvedValue({ status: "approved" });

    await expect(getPaymentDetails(MP_ID)).rejects.toMatchObject({
      statusCode: 502,
      code: "MP_INVALID_RESPONSE",
    });
  });

  it("sube MP_NOT_CONFIGURED sin llamar a la API si no hay token", async () => {
    const previous = process.env.MP_ACCESS_TOKEN;
    delete process.env.MP_ACCESS_TOKEN;

    await expect(getPaymentDetails(MP_ID)).rejects.toMatchObject({
      statusCode: 503,
      code: "MP_NOT_CONFIGURED",
    });
    expect(paymentGet).not.toHaveBeenCalled();

    if (previous !== undefined) process.env.MP_ACCESS_TOKEN = previous;
  });

  it("consulta siempre con el token de la plataforma (riesgo conocido)", async () => {
    // documenta el desalineamiento que falta resolver: los pagos creados con el
    // token del transportista no son visibles con este
    paymentGet.mockResolvedValue(pagoAprobado());

    await getPaymentDetails(MP_ID);

    expect(mpConfigs).toEqual([{ accessToken: MP_TOKEN_DE_PLATAFORMA }]);
  });
});

describe("tracePayment: control de acceso", () => {
  const pagoInterno = (overrides: Record<string, unknown> = {}) => ({
    id: "p1",
    type: "DEPOSIT",
    status: "APPROVED",
    amount: 1000,
    mpPaymentId: MP_ID,
    mpPreferenceId: "pref-1",
    platformFeeAmount: 100,
    carrierAmount: 900,
    refundedAmount: null,
    cargoItem: { id: "i1", companyId: "empresa-1", tripId: "viaje-1" },
    ...overrides,
  });

  beforeEach(() => {
    paymentGet.mockResolvedValue(pagoAprobado());
  });

  it("deja ver a la empresa que reservó la carga", async () => {
    paymentFindFirst.mockResolvedValue(pagoInterno());

    const result = await tracePayment(MP_ID, { id: "empresa-1", role: "COMPANY" });

    expect(result.local?.paymentId).toBe("p1");
    expect(result.details.id).toBe(MP_ID);
  });

  it("deja ver al transportista del viaje", async () => {
    paymentFindFirst.mockResolvedValue(pagoInterno());
    tripFindUnique.mockResolvedValue({ carrierId: "transportista-1" });

    const result = await tracePayment(MP_ID, { id: "transportista-1", role: "CARRIER" });

    expect(result.local?.paymentId).toBe("p1");
    expect(tripFindUnique).toHaveBeenCalledWith({
      where: { id: "viaje-1" },
      select: { carrierId: true },
    });
  });

  it("deja ver a un ADMIN sin ser dueño del recurso", async () => {
    paymentFindFirst.mockResolvedValue(pagoInterno());
    tripFindUnique.mockResolvedValue({ carrierId: "otro-transportista" });

    const result = await tracePayment(MP_ID, { id: "admin-1", role: "ADMIN" });

    expect(result.local?.paymentId).toBe("p1");
  });

  it("le da 404 a un usuario que no es ni empresa ni transportista del viaje", async () => {
    // 404 y no 403: no le confirmamos que ese pago existe
    paymentFindFirst.mockResolvedValue(pagoInterno());
    tripFindUnique.mockResolvedValue({ carrierId: "otro-transportista" });

    await expect(
      tracePayment(MP_ID, { id: "empresa-ajena", role: "COMPANY" })
    ).rejects.toMatchObject({ statusCode: 404, code: "PAYMENT_NOT_FOUND" });
    // y ni siquiera se le pregunta a Mercado Pago
    expect(paymentGet).not.toHaveBeenCalled();
  });

  it("sólo deja ver a ADMIN un pago que no tiene registro interno", async () => {
    // pago de una preference de prueba, o cuyo webhook todavía no llegó
    paymentFindFirst.mockResolvedValue(null);

    const result = await tracePayment(MP_ID, { id: "admin-1", role: "ADMIN" });

    expect(result.local).toBeNull();
    expect(result.details.id).toBe(MP_ID);
  });

  it("no deja ver a un no-ADMIN un pago sin registro interno", async () => {
    // no hay pago interno contra el cual comparar la pertenencia
    paymentFindFirst.mockResolvedValue(null);

    await expect(
      tracePayment(MP_ID, { id: "empresa-1", role: "COMPANY" })
    ).rejects.toMatchObject({ statusCode: 404, code: "PAYMENT_NOT_FOUND" });
    expect(paymentGet).not.toHaveBeenCalled();
  });

  it("propaga el 404 de MP cuando el pago no existe en Mercado Pago", async () => {
    paymentFindFirst.mockResolvedValue(pagoInterno());
    paymentGet.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 404"), { status: 404 })
    );

    await expect(
      tracePayment(MP_ID, { id: "empresa-1", role: "COMPANY" })
    ).rejects.toMatchObject({ statusCode: 404, code: "MP_PAYMENT_NOT_FOUND" });
  });
});

describe("tracePayment: liveMode visible", () => {
  beforeEach(() => {
    paymentFindFirst.mockResolvedValue(null);
  });

  it("expone liveMode arriba del objeto, no sólo anidado en details", async () => {
    // el pedido explícito: poder distinguir test de real sin bajar a details
    paymentGet.mockResolvedValue(pagoAprobado({ live_mode: true }));

    const result = await tracePayment(MP_ID, { id: "admin-1", role: "ADMIN" });

    expect(result.liveMode).toBe(true);
    expect(result.isTestPayment).toBe(false);
  });

  it("marca isTestPayment cuando el pago es de sandbox", async () => {
    paymentGet.mockResolvedValue(pagoAprobado({ live_mode: false }));

    const result = await tracePayment(MP_ID, { id: "admin-1", role: "ADMIN" });

    expect(result.liveMode).toBe(false);
    expect(result.isTestPayment).toBe(true);
  });

  it("loguea el pago con su live_mode para poder seguirlo en la consola", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    paymentGet.mockResolvedValue(pagoAprobado({ live_mode: true }));

    await tracePayment(MP_ID, { id: "admin-1", role: "ADMIN" });

    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]?.[0] as string;
    expect(line).toContain(MP_ID);
    expect(line).toContain("live_mode=true");
    expect(line).not.toContain(MP_TOKEN_DE_PLATAFORMA);
    log.mockRestore();
  });
});
