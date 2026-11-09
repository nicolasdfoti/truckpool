import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// El SDK de Mercado Pago se reemplaza entero: acá se prueba la lógica de
// idempotencia de refundPayment, no la integración con MP.
const { create, total, paymentGet, paymentMethods, preferenceCreate, mpConfigs } =
  vi.hoisted(() => ({
    create: vi.fn(),
    paymentGet: vi.fn(),
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
    get = paymentGet;
  },
  PaymentMethod: class {
    get = paymentMethods;
  },
  Preference: class {
    create = preferenceCreate;
  },
}));

const {
  checkAccountConnection,
  createCheckoutPreference,
  createTestPreference,
  fetchPaymentState,
  refundPayment,
  verifyWebhookSignature,
} = await import("../lib/mercadopago.js");
const { AppError } = await import("../lib/errors.js");

const MP_ID = "mp-77";

/** el SDK real responde { amount }, no un número suelto */
const totalDevuelve = (amount: number) => ({ amount });

beforeEach(() => {
  create.mockReset();
  paymentGet.mockReset();
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
    const refunded = await refundPayment(MP_ID, 50, "token-de-prueba");
    expect(pedidos()).toEqual([50]);
    expect(refunded).toBe(50);
  });

  it("NO vuelve a pedir nada si el objetivo ya está cubierto", async () => {
    // el caso que faltaba: un reembolso de 50 ya entró en Mercado Pago y el
    // commit de la base se cayó después, así que la transacción se reintenta
    // con el mismo objetivo. Antes esto pedía 50 otra vez y devolvía el 100%
    // de una seña que sólo debía recibir la mitad.
    total.mockResolvedValue(totalDevuelve(50));
    const refunded = await refundPayment(MP_ID, 50, "token-de-prueba");
    expect(create).not.toHaveBeenCalled();
    expect(refunded).toBe(50);
  });

  it("pide sólo el delta cuando ya hubo un reembolso parcial", async () => {
    total
      .mockResolvedValueOnce(totalDevuelve(30))
      .mockResolvedValueOnce(totalDevuelve(50));
    const refunded = await refundPayment(MP_ID, 50, "token-de-prueba");
    expect(pedidos()).toEqual([20]);
    expect(refunded).toBe(50);
  });

  it("no pide nada si ya se devolvió de más que el objetivo", async () => {
    total.mockResolvedValue(totalDevuelve(80));
    const refunded = await refundPayment(MP_ID, 50, "token-de-prueba");
    expect(create).not.toHaveBeenCalled();
    expect(refunded).toBe(80);
  });

  it("ignora diferencias de redondeo de un centavo", async () => {
    total.mockResolvedValue(totalDevuelve(49.999999));
    const refunded = await refundPayment(MP_ID, 50, "token-de-prueba");
    expect(create).not.toHaveBeenCalled();
    expect(refunded).toBe(49.999999);
  });

  it("acepta el retiro como hecho si el create falla pero el total ya cubrió", async () => {
    create.mockRejectedValue(new Error("timeout de red"));
    total
      .mockResolvedValueOnce(totalDevuelve(0))
      .mockResolvedValueOnce(totalDevuelve(50));
    const refunded = await refundPayment(MP_ID, 50, "token-de-prueba");
    expect(refunded).toBe(50);
  });

  it("propaga el error si el create falla y el total no cubrió", async () => {
    create.mockRejectedValue(new Error("timeout de red"));
    total.mockResolvedValue(totalDevuelve(0));
    await expect(refundPayment(MP_ID, 50, "token-de-prueba")).rejects.toBeInstanceOf(
      AppError
    );
  });

  it("no emite ningún reembolso si no puede leer cuánto se devolvió", async () => {
    // fail closed: a ciegas, pedir de más es el resultado probable
    total.mockRejectedValue(new Error("MP no responde"));
    await expect(refundPayment(MP_ID, 50, "token-de-prueba")).rejects.toBeInstanceOf(
      AppError
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("reintentar dos veces seguidas con el mismo objetivo devuelve una sola vez", async () => {
    // el escenario completo: intento 1 entra en MP, la transacción se cae,
    // intento 2 no debe volver a pagar
    total
      .mockResolvedValueOnce(totalDevuelve(0))
      .mockResolvedValueOnce(totalDevuelve(50));
    await refundPayment(MP_ID, 50, "token-de-prueba");
    expect(pedidos()).toEqual([50]);

    // segundo intento, ahora MP ya reporta 50
    total.mockResolvedValue(totalDevuelve(50));
    const refunded = await refundPayment(MP_ID, 50, "token-de-prueba");
    expect(pedidos()).toEqual([50]);
    expect(refunded).toBe(50);
  });
});

describe("refundPayment: el total final falla", () => {
  it("traduce el error del SDK a MP_ERROR sin loguear el token", async () => {
    const token = "APP_USR-secreto-del-refund";
    total.mockResolvedValueOnce(totalDevuelve(0)).mockRejectedValueOnce(
      Object.assign(new Error("Internal Server Error"), {
        status: 500,
        config: { headers: { Authorization: `Bearer ${token}` } },
      })
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const err = await refundPayment(MP_ID, 50, token).catch((e: unknown) => e);

    expect(create).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 502, code: "MP_ERROR" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    warn.mockRestore();
  });
});

describe("refundPayment con idempotencyKey", () => {
  it("manda la clave a Mercado Pago para que un pedido repetido no devuelva dos veces", async () => {
    total
      .mockResolvedValueOnce(totalDevuelve(0))
      .mockResolvedValueOnce(totalDevuelve(50));

    await refundPayment(MP_ID, 50, "token-de-prueba", { idempotencyKey: "refund-pay1" });

    expect(create).toHaveBeenCalledWith({
      payment_id: MP_ID,
      body: { amount: 50 },
      requestOptions: { idempotencyKey: "refund-pay1" },
    });
  });
});

describe("refundPayment con el token del transportista", () => {
  it("consulta y reembolsa con el token recibido, sin MP_ACCESS_TOKEN", async () => {
    delete process.env.MP_ACCESS_TOKEN;
    total
      .mockResolvedValueOnce(totalDevuelve(0))
      .mockResolvedValueOnce(totalDevuelve(50));

    const refunded = await refundPayment(MP_ID, 50, "APP_USR-token-del-carrier");

    expect(refunded).toBe(50);
    expect(create).toHaveBeenCalledTimes(1);
    expect(mpConfigs.length).toBeGreaterThan(0);
    expect(mpConfigs.every((c) => c.accessToken === "APP_USR-token-del-carrier")).toBe(
      true
    );
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

describe("createCheckoutPreference", () => {
  it("agrega source_news=webhooks a la notification_url (probado en sandbox con test-preference)", async () => {
    // las IPN (?topic=…&id=…) no traen una firma verificable: el webhook las
    // rechaza con 401 y MP las reintentaría para siempre
    preferenceCreate.mockResolvedValue({ id: "pref-1", init_point: "https://mp/pref-1" });

    await createCheckoutPreference({
      paymentId: "pay1",
      cargoItemId: "i1",
      description: "Cajas",
      amount: 100,
      tripId: "t1",
      carrierMpUserId: "mp-user-123",
      carrierMpAccessToken: "APP_USR-carrier",
      platformFeeAmount: 10,
    });

    const { body } = preferenceCreate.mock.calls[0]![0] as {
      body: { notification_url: string };
    };
    expect(body.notification_url).toBe(
      "http://localhost:4000/api/payments/webhook?payment_id=pay1&source_news=webhooks"
    );
  });

  describe("back_urls y auto_return según APP_URL", () => {
    afterEach(() => {
      delete process.env.APP_URL;
    });

    /** el body que se le mandó a MP para una seña */
    const bodyDeLaSena = async () => {
      preferenceCreate.mockResolvedValue({
        id: "pref-1",
        init_point: "https://mp/pref-1",
      });
      await createCheckoutPreference({
        paymentId: "pay1",
        cargoItemId: "i1",
        description: "Cajas",
        amount: 9310,
        tripId: "t1",
        carrierMpUserId: "mp-user-123",
        carrierMpAccessToken: "APP_USR-carrier",
        platformFeeAmount: 931,
      });
      return (preferenceCreate.mock.calls[0]![0] as { body: Record<string, unknown> })
        .body;
    };

    it.each([
      ["sin definir (localhost:5173 por defecto)", undefined],
      ["localhost", "http://localhost:5173"],
      ["127.0.0.1", "http://127.0.0.1:5173"],
      ["::1", "http://[::1]:5173"],
      ["*.localhost", "http://app.localhost:5173"],
    ])(
      "con APP_URL %s no manda back_urls ni auto_return (MP rechaza localhost)",
      async (_caso, valor) => {
        // en sandbox MP respondió 400 "auto_return invalid. back_url.success must
        // be defined" con back_urls a localhost
        if (valor !== undefined) process.env.APP_URL = valor;

        const body = await bodyDeLaSena();

        expect(body).not.toHaveProperty("back_urls");
        expect(body).not.toHaveProperty("auto_return");
        // el webhook y el split no dependen de la vuelta al sitio
        expect(body.notification_url).toContain("/api/payments/webhook?payment_id=pay1");
        expect(body.marketplace_fee).toBe(931);
      }
    );

    it("con una APP_URL pública manda back_urls a /pagos/retorno y auto_return", async () => {
      process.env.APP_URL = "https://app.truckpool.app";

      const body = await bodyDeLaSena();

      const retorno =
        "https://app.truckpool.app/pagos/retorno?tripId=t1&cargoItemId=i1&type=DEPOSIT";
      expect(body.back_urls).toEqual({
        success: `${retorno}&status=approved`,
        failure: `${retorno}&status=rejected`,
        pending: `${retorno}&status=pending`,
      });
      expect(body.auto_return).toBe("approved");
    });

    it("no depende de NODE_ENV: en producción con APP_URL local tampoco los manda", async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      process.env.APP_URL = "http://localhost:5173";
      try {
        const body = await bodyDeLaSena();
        expect(body).not.toHaveProperty("back_urls");
        expect(body).not.toHaveProperty("auto_return");
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  });

  describe("qué link de checkout devuelve (MP_CHECKOUT_SANDBOX)", () => {
    const SANDBOX =
      "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1";
    const REAL = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1";
    const crear = () =>
      createCheckoutPreference({
        paymentId: "pay1",
        cargoItemId: "i1",
        description: "Cajas",
        amount: 100,
        tripId: "t1",
        carrierMpUserId: "mp-user-123",
        carrierMpAccessToken: "APP_USR-carrier",
        platformFeeAmount: 10,
      });

    afterEach(() => {
      delete process.env.MP_CHECKOUT_SANDBOX;
    });

    it.each([
      ["sin definir", undefined],
      ["false", "false"],
    ])(
      "con MP_CHECKOUT_SANDBOX %s usa init_point aunque MP mande el de sandbox",
      async (_caso, valor) => {
        // con credenciales reales, el link de sandbox mandaría un pago real al sandbox
        if (valor !== undefined) process.env.MP_CHECKOUT_SANDBOX = valor;
        preferenceCreate.mockResolvedValue({
          id: "pref-1",
          init_point: REAL,
          sandbox_init_point: SANDBOX,
        });
        await expect(crear()).resolves.toMatchObject({ initPoint: REAL });
      }
    );

    it("con MP_CHECKOUT_SANDBOX=true usa el link de sandbox", async () => {
      process.env.MP_CHECKOUT_SANDBOX = "true";
      preferenceCreate.mockResolvedValue({
        id: "pref-1",
        init_point: REAL,
        sandbox_init_point: SANDBOX,
      });
      await expect(crear()).resolves.toMatchObject({ initPoint: SANDBOX });
    });

    it("con MP_CHECKOUT_SANDBOX=true y sin link de sandbox no cae al real", async () => {
      process.env.MP_CHECKOUT_SANDBOX = "true";
      preferenceCreate.mockResolvedValue({ id: "pref-1", init_point: REAL });
      await expect(crear()).rejects.toMatchObject({
        statusCode: 502,
        code: "MP_INVALID_RESPONSE",
      });
    });

    it("sin MP_CHECKOUT_SANDBOX y sin init_point no cae al de sandbox", async () => {
      preferenceCreate.mockResolvedValue({ id: "pref-1", sandbox_init_point: SANDBOX });
      await expect(crear()).rejects.toMatchObject({
        statusCode: 502,
        code: "MP_INVALID_RESPONSE",
      });
    });

    it("en producción con MP_CHECKOUT_SANDBOX=true no crea la preference", async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      process.env.MP_CHECKOUT_SANDBOX = "true";
      try {
        await expect(crear()).rejects.toMatchObject({
          statusCode: 500,
          code: "MP_NOT_CONFIGURED",
        });
        expect(preferenceCreate).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  });
});

describe("createTestPreference", () => {
  it("crea la preference en la cuenta de la plataforma con un item ARS", async () => {
    preferenceCreate.mockResolvedValue({
      id: "pref-123",
      init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
      sandbox_init_point:
        "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
    });

    const result = await createTestPreference({
      title: "Transporte TruckPool - Prueba",
      quantity: 2,
      unitPrice: 100,
    });

    expect(preferenceCreate).toHaveBeenCalledTimes(1);
    const body = (
      preferenceCreate.mock.calls[0]?.[0] as { body: Record<string, unknown> }
    ).body;
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
      "http://localhost:4000/api/payments/webhook?source=test-preference&source_news=webhooks"
    );
    // usa MP_ACCESS_TOKEN, el del carrier no aparece por ningún lado
    expect(mpConfigs).toEqual([{ accessToken: "token-de-prueba" }]);
    expect(result).toEqual({
      preferenceId: "pref-123",
      initPoint: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
      sandboxInitPoint:
        "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123",
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

    const result = await createTestPreference({
      title: "Prueba",
      quantity: 1,
      unitPrice: 1,
    });

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

describe("verifyWebhookSignature", () => {
  const secret = "whsec-de-prueba";
  const ahora = new Date("2026-11-03T12:00:00.000Z");

  /** firma HMAC válida para ese ts: lo único que puede fallar es la frescura */
  const firmar = (ts: string) => {
    const manifest = `id:mp-77;request-id:req-1;ts:${ts};`;
    const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
    return {
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestIdHeader: "req-1",
      dataId: "mp-77",
    };
  };
  const segundos = (ms: number) => String(Math.floor(ms / 1000));

  beforeEach(() => {
    process.env.MP_WEBHOOK_SECRET = secret;
    vi.useFakeTimers();
    vi.setSystemTime(ahora);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("acepta un ts actual", () => {
    expect(() => verifyWebhookSignature(firmar(segundos(ahora.getTime())))).not.toThrow();
  });

  it("acepta un ts actual en milisegundos", () => {
    expect(() => verifyWebhookSignature(firmar(String(ahora.getTime())))).not.toThrow();
  });

  it("rechaza un ts de hace más de 5 minutos (reenvío de una notificación vieja)", () => {
    const viejo = segundos(ahora.getTime() - 6 * 60_000);
    expect(() => verifyWebhookSignature(firmar(viejo))).toThrow(
      expect.objectContaining({ statusCode: 401, code: "INVALID_SIGNATURE" })
    );
  });

  it("rechaza un ts de más de 5 minutos en el futuro", () => {
    const futuro = segundos(ahora.getTime() + 6 * 60_000);
    expect(() => verifyWebhookSignature(firmar(futuro))).toThrow(
      expect.objectContaining({ statusCode: 401, code: "INVALID_SIGNATURE" })
    );
  });

  /** firma de MP sobre un manifest arbitrario, con un ts actual */
  const firmarManifest = (manifest: (ts: string) => string) => {
    const ts = segundos(ahora.getTime());
    const v1 = createHmac("sha256", secret).update(manifest(ts)).digest("hex");
    return `ts=${ts},v1=${v1}`;
  };

  it("sin data.id, el manifest no lleva la parte id (como indica la doc de MP)", () => {
    const sinId = firmarManifest((ts) => `request-id:req-1;ts:${ts};`);
    expect(() =>
      verifyWebhookSignature({
        signatureHeader: sinId,
        requestIdHeader: "req-1",
        dataId: undefined,
      })
    ).not.toThrow();
  });

  it("sin data.id, rechaza una firma hecha sobre `id:;` (el manifest anterior)", () => {
    const idVacio = firmarManifest((ts) => `id:;request-id:req-1;ts:${ts};`);
    expect(() =>
      verifyWebhookSignature({
        signatureHeader: idVacio,
        requestIdHeader: "req-1",
        dataId: undefined,
      })
    ).toThrow(expect.objectContaining({ statusCode: 401, code: "INVALID_SIGNATURE" }));
  });

  it("un data.id alfanumérico con mayúsculas se firma en minúsculas", () => {
    // ejemplo de la doc: ORD01JQ4S4KY8HWQ6NA5PXB65B3D3 → ord01jq4s4ky8hwq6na5pxb65b3d3
    const firma = firmarManifest(
      (ts) => `id:ord01jq4s4ky8hwq6na5pxb65b3d3;request-id:req-1;ts:${ts};`
    );
    expect(() =>
      verifyWebhookSignature({
        signatureHeader: firma,
        requestIdHeader: "req-1",
        dataId: "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3",
      })
    ).not.toThrow();
  });
});

describe("fetchPaymentState", () => {
  const TOKEN = "APP_USR-secreto";

  /** así llega un error del SDK: con la request original, headers incluidos */
  const errorDelSdk = () =>
    Object.assign(new Error("Internal Server Error"), {
      status: 500,
      config: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });

  /** todo lo que se mandó a la consola, serializado */
  const logueado = (...spies: Array<ReturnType<typeof vi.spyOn>>) =>
    spies
      .flatMap((spy) => spy.mock.calls)
      .map((args) =>
        JSON.stringify(args, (_k, v) =>
          v instanceof Error ? { ...v, message: v.message } : v
        )
      )
      .join("\n");

  it("traduce un error del SDK a MP_ERROR sin loguear el token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    paymentGet.mockRejectedValue(errorDelSdk());

    const err = await fetchPaymentState("mp-77", "token-de-prueba").catch(
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 502, code: "MP_ERROR" });
    expect(JSON.stringify(err)).not.toContain(TOKEN);
    expect(logueado(warn, error)).not.toContain(TOKEN);
    warn.mockRestore();
    error.mockRestore();
  });

  it("devuelve el monto y la moneda que cobró MP", async () => {
    paymentGet.mockResolvedValue({
      id: 77,
      status: "approved",
      external_reference: "pay1",
      transaction_amount: 100,
      currency_id: "ARS",
    });

    await expect(fetchPaymentState("mp-77", "token-de-prueba")).resolves.toEqual({
      state: "APPROVED",
      externalReference: "pay1",
      amount: 100,
      currencyId: "ARS",
    });
  });

  it("una respuesta sin id es MP_INVALID_RESPONSE", async () => {
    paymentGet.mockResolvedValue({ status: "approved" });

    await expect(fetchPaymentState("mp-77", "token-de-prueba")).rejects.toMatchObject({
      statusCode: 502,
      code: "MP_INVALID_RESPONSE",
    });
  });
});
