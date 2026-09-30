import { describe, it, expect, beforeEach, vi } from "vitest";

// El SDK de Mercado Pago se reemplaza entero: acá se prueba la lógica de
// idempotencia de refundPayment, no la integración con MP.
const { create, total, paymentMethods, preferenceCreate, mpConfigs } = vi.hoisted(() => ({
  create: vi.fn(),
  total: vi.fn(),
  paymentMethods: vi.fn(),
  preferenceCreate: vi.fn(),
  // guardamos los opts de cada MercadoPagoConfig para poder verificar de dónde
  // sale el access token
  mpConfigs: [] as Array<{ accessToken?: string }>,
}));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {
    constructor(readonly opts: { accessToken?: string }) {
      mpConfigs.push(opts);
    }
  },
  PaymentRefund: class {
    create = create;
    total = total;
  },
  Payment: class {
    get = vi.fn();
  },
  PaymentMethod: class {
    get = paymentMethods;
  },
  Preference: class {
    create = preferenceCreate;
  },
}));

const { checkAccountConnection, createTestPreference, refundPayment } = await import(
  "../lib/mercadopago.js"
);
const { AppError } = await import("../lib/errors.js");

const MP_ID = "mp-77";

/** el SDK real responde { amount }, no un número suelto */
const totalDevuelve = (amount: number) => ({ amount });

beforeEach(() => {
  create.mockReset();
  paymentMethods.mockReset();
  preferenceCreate.mockReset();
  mpConfigs.length = 0;
  total.mockReset();
  create.mockResolvedValue({ id: 1 });
  process.env.MP_ACCESS_TOKEN = "token-de-prueba";
});

/** lo que se le pasó a Mercado Pago en cada create() */
const pedidos = () =>
  create.mock.calls.map((c) => (c[0] as { body: { amount: number } }).body.amount);

describe("refundPayment", () => {
  it("pide el monto completo la primera vez", async () => {
    total
      .mockResolvedValueOnce(totalDevuelve(0))
      .mockResolvedValueOnce(totalDevuelve(50));
    const refunded = await refundPayment(MP_ID, 50);
    expect(pedidos()).toEqual([50]);
    expect(refunded).toBe(50);
  });

  it("NO vuelve a pedir nada si el objetivo ya está cubierto", async () => {
    // el caso que faltaba: un reembolso de 50 ya entró en Mercado Pago y el
    // commit de la base se cayó después, así que la transacción se reintenta
    // con el mismo objetivo. Antes esto pedía 50 otra vez y devolvía el 100%
    // de una seña que sólo debía recibir la mitad.
    total.mockResolvedValue(totalDevuelve(50));
    const refunded = await refundPayment(MP_ID, 50);
    expect(create).not.toHaveBeenCalled();
    expect(refunded).toBe(50);
  });

  it("pide sólo el delta cuando ya hubo un reembolso parcial", async () => {
    total
      .mockResolvedValueOnce(totalDevuelve(30))
      .mockResolvedValueOnce(totalDevuelve(50));
    const refunded = await refundPayment(MP_ID, 50);
    expect(pedidos()).toEqual([20]);
    expect(refunded).toBe(50);
  });

  it("no pide nada si ya se devolvió de más que el objetivo", async () => {
    total.mockResolvedValue(totalDevuelve(80));
    const refunded = await refundPayment(MP_ID, 50);
    expect(create).not.toHaveBeenCalled();
    expect(refunded).toBe(80);
  });

  it("ignora diferencias de redondeo de un centavo", async () => {
    total.mockResolvedValue(totalDevuelve(49.999999));
    const refunded = await refundPayment(MP_ID, 50);
    expect(create).not.toHaveBeenCalled();
    expect(refunded).toBe(49.999999);
  });

  it("acepta el retiro como hecho si el create falla pero el total ya cubrió", async () => {
    create.mockRejectedValue(new Error("timeout de red"));
    total
      .mockResolvedValueOnce(totalDevuelve(0))
      .mockResolvedValueOnce(totalDevuelve(50));
    const refunded = await refundPayment(MP_ID, 50);
    expect(refunded).toBe(50);
  });

  it("propaga el error si el create falla y el total no cubrió", async () => {
    create.mockRejectedValue(new Error("timeout de red"));
    total.mockResolvedValue(totalDevuelve(0));
    await expect(refundPayment(MP_ID, 50)).rejects.toBeInstanceOf(AppError);
  });

  it("no emite ningún reembolso si no puede leer cuánto se devolvió", async () => {
    // fail closed: a ciegas, pedir de más es el resultado probable
    total.mockRejectedValue(new Error("MP no responde"));
    await expect(refundPayment(MP_ID, 50)).rejects.toBeInstanceOf(AppError);
    expect(create).not.toHaveBeenCalled();
  });

  it("reintentar dos veces seguidas con el mismo objetivo devuelve una sola vez", async () => {
    // el escenario completo: intento 1 entra en MP, la transacción se cae,
    // intento 2 no debe volver a pagar
    total
      .mockResolvedValueOnce(totalDevuelve(0))
      .mockResolvedValueOnce(totalDevuelve(50));
    await refundPayment(MP_ID, 50);
    expect(pedidos()).toEqual([50]);

    // segundo intento, ahora MP ya reporta 50
    total.mockResolvedValue(totalDevuelve(50));
    const refunded = await refundPayment(MP_ID, 50);
    expect(pedidos()).toEqual([50]);
    expect(refunded).toBe(50);
  });
});

describe("checkAccountConnection", () => {
  it("devuelve cuántos métodos de pago habilitó la cuenta", async () => {
    paymentMethods.mockResolvedValue([
      { id: "visa", name: "Visa", payment_type_id: "credit_card", status: "active" },
      {
        id: "master",
        name: "Mastercard",
        payment_type_id: "credit_card",
        status: "active",
      },
    ]);

    const result = await checkAccountConnection();

    expect(result.paymentMethodsCount).toBe(2);
    expect(result.sample).toEqual([
      { id: "visa", name: "Visa", paymentType: "credit_card", status: "active" },
      { id: "master", name: "Mastercard", paymentType: "credit_card", status: "active" },
    ]);
  });

  it("nunca incluye el access token en la respuesta", async () => {
    process.env.MP_ACCESS_TOKEN = "APP_USR-token-muy-secreto";
    paymentMethods.mockResolvedValue([
      {
        id: "visa",
        name: "Visa",
        payment_type_id: "credit_card",
        status: "active",
        // esto es de Mercado Pago (patrones de BIN, reglas de CVB) y no debe
        // salir del backend hacia el endpoint
        settings: [{ card_number: { length: 16 }, security_code: { length: 3 } }],
      },
    ]);

    const result = await checkAccountConnection();

    const serializado = JSON.stringify(result);
    expect(serializado).not.toContain("token-muy-secreto");
    expect(serializado).not.toContain("security_code");
    expect(serializado).not.toContain("settings");
    expect(serializado).not.toContain("APP_USR");
  });

  it("arma la config con MP_ACCESS_TOKEN del entorno, no hardcodeado", async () => {
    process.env.MP_ACCESS_TOKEN = "APP_USR-token-del-entorno";
    paymentMethods.mockResolvedValue([]);

    await checkAccountConnection();

    // el token se le pasa al SDK desde process.env
    expect(mpConfigs.at(-1)).toEqual({ accessToken: "APP_USR-token-del-entorno" });
    // y si cambia la variable, cambia lo que se manda
    process.env.MP_ACCESS_TOKEN = "APP_USR-otro-token";
    await checkAccountConnection();
    expect(mpConfigs.at(-1)).toEqual({ accessToken: "APP_USR-otro-token" });
  });

  it("falla con 503 si falta MP_ACCESS_TOKEN, sin pegarle a la API", async () => {
    const previous = process.env.MP_ACCESS_TOKEN;
    delete process.env.MP_ACCESS_TOKEN;

    await expect(checkAccountConnection()).rejects.toMatchObject({
      statusCode: 503,
      code: "MP_NOT_CONFIGURED",
    });
    expect(paymentMethods).not.toHaveBeenCalled();

    if (previous !== undefined) process.env.MP_ACCESS_TOKEN = previous;
  });

  it("sube un 502 sanitizado si Mercado Pago rechaza el token (401)", async () => {
    process.env.MP_ACCESS_TOKEN = "APP_USR-token-vencido";
    paymentMethods.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 401"), { status: 401 })
    );

    const error = await checkAccountConnection().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    // AppError viene de un import dinámico: como valor sí, como tipo no
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(502);
    expect(appError.code).toBe("MP_ERROR");
    // el mensaje ayuda a diagnosticar, pero no filtra el token
    expect(appError.message).toContain("401");
    expect(appError.message).not.toContain("token-vencido");
  });

  it("sube un 502 sin status si la red falla", async () => {
    process.env.MP_ACCESS_TOKEN = "APP_USR-token-de-prueba";
    paymentMethods.mockRejectedValue(new Error("fetch failed"));

    await expect(checkAccountConnection()).rejects.toMatchObject({
      statusCode: 502,
      code: "MP_ERROR",
    });
  });
});

describe("createTestPreference", () => {
  it("crea la preference en la cuenta de la plataforma con un item ARS", async () => {
    preferenceCreate.mockResolvedValue({
      id: "pref-123",
      init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
      sandbox_init_point: "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
    });

    const result = await createTestPreference({
      title: "Transporte TruckPool - Prueba",
      quantity: 2,
      unitPrice: 100,
    });

    expect(preferenceCreate).toHaveBeenCalledTimes(1);
    const body = (preferenceCreate.mock.calls[0]?.[0] as { body: Record<string, unknown> })
      .body;
    // el id del item sigue siendo el slug derivado del título
    expect(body.items).toEqual([
      {
        id: "transporte-truckpool-prueba",
        title: "Transporte TruckPool - Prueba",
        quantity: 2,
        unit_price: 100,
        currency_id: "ARS",
      },
    ]);
    // y ahora hay clave de correlación: el prefijo la marca como prueba y el
    // hex aleatorio evita que dos pruebas compartan external_reference
    expect(body.external_reference).toMatch(/^truckpool-test:[0-9a-f]{12}$/);
    expect(body.metadata).toEqual({
      source: "truckpool-test",
      external_reference: body.external_reference,
    });
    expect(body.notification_url).toBe(
      "http://localhost:4000/api/payments/webhook?source=test-preference"
    );
    // usa MP_ACCESS_TOKEN, el del carrier no aparece por ningún lado
    expect(mpConfigs).toEqual([{ accessToken: "token-de-prueba" }]);
    expect(result).toEqual({
      preferenceId: "pref-123",
      initPoint: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
      sandboxInitPoint: "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
    });
  });

  it("no manda back_urls, marketplace ni auto_return, pero sí manda el webhook", async () => {
    preferenceCreate.mockResolvedValue({ id: "pref-1", init_point: "https://x.test" });

    await createTestPreference({ title: "Prueba", quantity: 1, unitPrice: 100 });

    const body = JSON.stringify(
      (preferenceCreate.mock.calls[0]?.[0] as { body: unknown }).body
    );
    expect(body).not.toContain("back_urls");
    expect(body).not.toContain("marketplace");
    expect(body).not.toContain("auto_return");
    // ni un payment_id que no existe en la base: el webhook respondería 404
    // y Mercado Pago lo reintentaría
    expect(body).not.toContain("payment_id");
    // pero sí el webhook, para que el pago se pueda cerrar de punta a punta
    expect(body).toContain("notification_url");
  });

  it("deja sandbox_init_point vacío si la cuenta no lo devuelve", async () => {
    preferenceCreate.mockResolvedValue({ id: "pref-2", init_point: "https://x.test" });

    const result = await createTestPreference({ title: "Prueba", quantity: 1, unitPrice: 1 });

    expect(result.sandboxInitPoint).toBe("");
    expect(result.initPoint).toBe("https://x.test");
  });

  it("sube MP_INVALID_RESPONSE si no vuelve un id o un init_point", async () => {
    preferenceCreate.mockResolvedValue({ init_point: "https://x.test" });
    await expect(
      createTestPreference({ title: "Prueba", quantity: 1, unitPrice: 1 })
    ).rejects.toMatchObject({ statusCode: 502, code: "MP_INVALID_RESPONSE" });

    preferenceCreate.mockResolvedValue({ id: "pref-3" });
    await expect(
      createTestPreference({ title: "Prueba", quantity: 1, unitPrice: 1 })
    ).rejects.toMatchObject({ statusCode: 502, code: "MP_INVALID_RESPONSE" });
  });

  it("sube un 502 sanitizado si falla la llamada", async () => {
    preferenceCreate.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 403"), { status: 403 })
    );

    const error = await createTestPreference({
      title: "Prueba",
      quantity: 1,
      unitPrice: 1,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(502);
    expect(appError.code).toBe("MP_ERROR");
    expect(appError.message).not.toContain("token-de-prueba");
  });

  it("sube MP_NOT_CONFIGURED sin token y sin llamar a la API", async () => {
    const previous = process.env.MP_ACCESS_TOKEN;
    delete process.env.MP_ACCESS_TOKEN;

    await expect(
      createTestPreference({ title: "Prueba", quantity: 1, unitPrice: 1 })
    ).rejects.toMatchObject({ statusCode: 503, code: "MP_NOT_CONFIGURED" });
    expect(preferenceCreate).not.toHaveBeenCalled();

    if (previous !== undefined) process.env.MP_ACCESS_TOKEN = previous;
  });
});
