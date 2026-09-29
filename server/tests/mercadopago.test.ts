import { describe, it, expect, beforeEach, vi } from "vitest";

// El SDK de Mercado Pago se reemplaza entero: acá se prueba la lógica de
// idempotencia de refundPayment, no la integración con MP.
const { create, total } = vi.hoisted(() => ({ create: vi.fn(), total: vi.fn() }));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {
    constructor(readonly opts: unknown) {}
  },
  PaymentRefund: class {
    create = create;
    total = total;
  },
  Payment: class {
    get = vi.fn();
  },
  Preference: class {
    create = vi.fn();
  },
}));

const { refundPayment } = await import("../lib/mercadopago.js");
const { AppError } = await import("../lib/errors.js");

const MP_ID = "mp-77";

/** el SDK real responde { amount }, no un número suelto */
const totalDevuelve = (amount: number) => ({ amount });

beforeEach(() => {
  create.mockReset();
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
