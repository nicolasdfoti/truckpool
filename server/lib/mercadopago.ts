import { createHmac, timingSafeEqual } from "node:crypto";
import {
  MercadoPagoConfig,
  Payment,
  PaymentMethod,
  PaymentRefund,
  Preference,
} from "mercadopago";
import { AppError } from "./errors.js";

export type MpPaymentState = "PENDING" | "APPROVED" | "REJECTED" | "REFUNDED";

const STATUS_BY_MP_STATE: Record<string, MpPaymentState> = {
  approved: "APPROVED",
  authorized: "PENDING",
  in_process: "PENDING",
  pending: "PENDING",
  requires_action: "PENDING",
  rejected: "REJECTED",
  cancelled: "REJECTED",
  charged_back: "REJECTED",
  refunded: "REFUNDED",
};

function mpConfig() {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new AppError(
      "Mercado Pago no está configurado: falta MP_ACCESS_TOKEN",
      503,
      "MP_NOT_CONFIGURED"
    );
  }
  return new MercadoPagoConfig({ accessToken });
}

export function mapMpStatus(status: string | undefined): MpPaymentState | null {
  if (!status) return null;
  return STATUS_BY_MP_STATE[status.toLowerCase()] ?? null;
}

/**
 * Un método de pago, reducido a lo que no es sensible.
 *
 * La respuesta de Mercado Pago trae además `settings` (patrones de BIN, largos
 * de tarjeta, reglas de código de seguridad). Eso es de Mercado Pago y no
 * nuestro: lo mapeamos a estos cuatro campos en vez de reenviar el objeto
 * crudo, para que ningún endpoint termine filtrando el detalle de sus reglas.
 */
export type MpPaymentMethodInfo = {
  id: string;
  name: string;
  paymentType: string;
  status: string;
};

/** Lo que devuelve la prueba de conexión. No incluye el token, por diseño. */
export type MpConnectionCheck = {
  /** total de métodos de pago que habilitó la cuenta */
  paymentMethodsCount: number;
  /** los primeros, para confirmar a simple vista que es la cuenta esperada */
  sample: MpPaymentMethodInfo[];
};

/**
 * Prueba de humo contra la API de Mercado Pago: confirma que `MP_ACCESS_TOKEN`
 * está presente y que la API lo acepta.
 *
 * Es la única forma barata de distinguir "el token está mal" de "Mercado Pago
 * está caído" sin crear un preference de verdad (que sí deja basura en la
 * cuenta). Pide `GET /v1/payment_methods`, que es de solo lectura.
 *
 * El token se lee por `mpConfig()` desde `process.env` y no sale de acá: el
 * tipo de retorno no tiene dónde ponerlo. Si faltara, el `AppError` de
 * `mpConfig()` sube tal cual (503 MP_NOT_CONFIGURED), que es justo lo que
 * `lib/env.ts` quiere: Mercado Pago es opcional y cada módulo falla sólo
 * cuando se lo usa.
 */
export async function checkAccountConnection(): Promise<MpConnectionCheck> {
  let methods;
  try {
    // PaymentMethod.get() es exactamente GET /v1/payment_methods con
    // Authorization: Bearer <MP_ACCESS_TOKEN> (lo arma el propio SDK).
    methods = await new PaymentMethod(mpConfig()).get();
  } catch (err) {
    // 503 de mpConfig(): la variable no está, no hay nada que diagnosticar
    // arriba y el mensaje ya lo dice.
    if (err instanceof AppError) throw err;
    // status de la respuesta de MP. No es una credencial, y es lo que
    // diferencia un 401 (token malo) de un 5xx (MP caído).
    const status =
      typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : null;
    // El detalle crudo del error de MP no se loguea: puede venir con echoed
    // headers. Sólo el status, que es lo accionable.
    console.warn("[mercadopago] checkAccountConnection falló", { status });
    throw new AppError(
      status === null
        ? "no pudimos comunicarnos con Mercado Pago"
        : `Mercado Pago rechazó la petición (HTTP ${status}): revisá MP_ACCESS_TOKEN`,
      502,
      "MP_ERROR"
    );
  }

  return {
    paymentMethodsCount: methods.length,
    sample: methods.slice(0, 5).map((m) => ({
      id: m.id ?? "",
      name: m.name ?? "",
      paymentType: m.payment_type_id ?? "",
      status: m.status ?? "",
    })),
  };
}

export function toPaymentState(status: string | undefined): MpPaymentState {
  return mapMpStatus(status) ?? "PENDING";
}

export type PreferenceInput = {
  paymentId: string;
  cargoItemId: string;
  description: string;
  amount: number;
  tripId: string;
  clientEmail?: string;
  /** DEPOSIT (la seña que reserva espacio) o BALANCE (lo que falta al salir) */
  paymentType?: "DEPOSIT" | "BALANCE";
  // Split de Mercado Pago: sin esto no hay a quién pagarle, así que no es
  // opcional. Un viaje sin carrier conectado es un error, no un pago sin
  // comisión.
  carrierMpUserId: string;
  carrierMpAccessToken: string;
  /**
   * Comisión de plataforma que corresponde a ESTE pago, ya calculada por el
   * caller con el contexto completo de la carga (priceShare, seña y saldo): la
   * comisión total se cobra una sola vez en el ciclo, no por separado en cada
   * pago parcial. Acá solo se la resta al total para armar el split.
   */
  platformFeeAmount: number;
};

export async function createCheckoutPreference(input: PreferenceInput): Promise<{
  preferenceId: string;
  initPoint: string;
  platformFeeAmount: number;
  carrierAmount: number;
}> {
  if (!input.carrierMpUserId || !input.carrierMpAccessToken) {
    throw new AppError(
      "el transportista de este viaje no tiene cuenta de Mercado Pago conectada",
      409,
      "MP_ACCOUNT_NOT_CONNECTED"
    );
  }
  if (input.platformFeeAmount < 0 || input.platformFeeAmount > input.amount) {
    throw new AppError(
      "la comisión de plataforma no puede ser mayor al pago",
      500,
      "MP_INVALID_FEE"
    );
  }

  const clientUrl = process.env.APP_URL ?? "http://localhost:5173";
  const apiUrl = process.env.API_PUBLIC_URL ?? "http://localhost:4000";
  // el tipo viaja en la URL de retorno para que la pantalla de thanks sepa si
  // la empresa acaba de pagar la seña o el saldo.
  const returnUrl = `${clientUrl}/pagos/retorno?tripId=${encodeURIComponent(input.tripId)}&cargoItemId=${encodeURIComponent(input.cargoItemId)}&type=${input.paymentType ?? "DEPOSIT"}`;

  // Comisión y neto de este pago (la comisión total ya viene repartida por el
  // caller). Lo que se descuenta del total es lo que va al transportista.
  const platformFeeAmount = Math.round(input.platformFeeAmount * 100) / 100;
  const carrierAmount = Math.round((input.amount - platformFeeAmount) * 100) / 100;

  // El pago se crea en la cuenta del transportista para que el split vaya a él.
  // Nunca en la de la plataforma: eso cobra el total sin comisión y nadie lo ve.
  const carrierConfig = new MercadoPagoConfig({
    accessToken: input.carrierMpAccessToken,
  });
  const preferenceClient = new Preference(carrierConfig);

  try {
    const body = {
      items: [
        {
          id: input.cargoItemId,
          title: `${input.paymentType === "BALANCE" ? "Saldo" : "Seña"} — ${input.description}`,
          quantity: 1,
          unit_price: input.amount,
          currency_id: "ARS",
        },
      ],
      ...(input.clientEmail ? { payer: { email: input.clientEmail } } : {}),
      external_reference: input.paymentId,
      metadata: {
        payment_id: input.paymentId,
        cargo_item_id: input.cargoItemId,
        payment_type: input.paymentType ?? "DEPOSIT",
      },
      notification_url: `${apiUrl}/api/payments/webhook?payment_id=${encodeURIComponent(input.paymentId)}`,
      back_urls: {
        success: `${returnUrl}&status=approved`,
        failure: `${returnUrl}&status=rejected`,
        pending: `${returnUrl}&status=pending`,
      },
      auto_return: "approved",
      marketplace_fee: platformFeeAmount,
      marketplace: input.carrierMpUserId,
    };

    const created = await preferenceClient.create({ body });

    const initPoint = created.sandbox_init_point ?? created.init_point;
    if (!created.id || !initPoint) {
      throw new AppError(
        "Mercado Pago no devolvió una preference utilizable",
        502,
        "MP_INVALID_RESPONSE"
      );
    }

    return { preferenceId: created.id, initPoint, platformFeeAmount, carrierAmount };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      "no pudimos generar el link de pago con Mercado Pago",
      502,
      "MP_ERROR"
    );
  }
}

export async function createTestPreference(input: {
  title: string;
  quantity: number;
  unitPrice: number;
}): Promise<{
  preferenceId: string;
  sandboxInitPoint: string;
  initPoint: string;
}> {
  const preferenceClient = new Preference(mpConfig());

  try {
    const body = {
      items: [
        {
          id: input.title
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
          title: input.title,
          quantity: input.quantity,
          unit_price: input.unitPrice,
          currency_id: "ARS",
        },
      ],
    };

    const created = await preferenceClient.create({ body });

    const sandboxInitPoint = created.sandbox_init_point ?? "";
    const initPoint = created.init_point ?? "";
    if (!created.id || !initPoint) {
      throw new AppError(
        "Mercado Pago no devolvió una preference utilizable",
        502,
        "MP_INVALID_RESPONSE"
      );
    }

    return { preferenceId: created.id, sandboxInitPoint, initPoint };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      "no pudimos generar el link de pago con Mercado Pago",
      502,
      "MP_ERROR"
    );
  }
}

export async function fetchPaymentState(
  mpPaymentId: string
): Promise<MpPaymentState | null> {
  const paymentClient = new Payment(mpConfig());
  const payment = await paymentClient.get({ id: mpPaymentId });
  return mapMpStatus(payment.status);
}

/**
 * Devuelve `amount` del pago de Mercado Pago. El monto va explícito siempre
 * (incluso cuando es el total) porque la cancelación entre 24 y 48hs devuelve
 * solo la mitad de la seña.
 *
 * Se usa cuando una empresa retira una carga que ya había pagado: el dinero se
 * devuelve antes de sacar la carga del viaje, así que nunca queda una carga
 * retirada con el pago cobrado.
 *
 * Idempotente, y la idempotencia se comprueba ANTES de pedirle nada a Mercado
 * Pago, no sólo cuando la llamada falla. El escenario que obliga a esto es el
 * reintento: la transacción de retiro es Serializable y se reintenta ante un
 * P2034, así que puede pasar que el reembolso de la empresa ya entró en MP y
 * después se cayera el commit de la base. Si el segundo intento pidiera el monto
 * completo otra vez, en la ventana de 24 a 48hs (mitad de la seña) devolvería
 * el 100% y la empresa se llevaría también la parte que era fee de la
 * plataforma.
 *
 * Por eso el orden es: cuánto le devolvimos hasta ahora → si ya cubrió el
 * objetivo, no se pide nada → si falta, se pide sólo el delta. Y si ni esa
 * consulta se puede hacer, no se emite ningún reembolso: no saber cuánto se
 * devolvió es exactamente la condición bajo la cual pedir de más es probable.
 *
 * Devuelve cuánto lleva reembolsado ese pago en total, para dejarlo asentado.
 */
export async function refundPayment(
  mpPaymentId: string,
  amount: number
): Promise<number> {
  // cuánto le devolvimos HASTA AHORA, antes de pedir nada (ver el comentario de
  // arriba: el reintento de la transacción es lo que hace falta cubrir acá)
  let already: number;
  try {
    already = await refundedAmount(mpPaymentId);
  } catch {
    // a ciegas no se devuelve plata: si no se puede leer el estado, se corta y
    // la empresa reintenta, en vez de arriesgar un reembolso duplicado
    throw new AppError(
      "no pudimos verificar con Mercado Pago cuánto se devolvió de este pago: no se devuelve nada hasta confirmar el estado",
      502,
      "MP_ERROR"
    );
  }

  const pending = round2(amount - already);
  // ya cubierto (o ya se devolvió de más): no se toca nada más
  if (pending < CENT) return already;

  try {
    await new PaymentRefund(mpConfig()).create({
      payment_id: mpPaymentId,
      body: { amount: pending },
    });
  } catch (err) {
    // puede haber funcionado igual y fallado el response: se vuelve a preguntar
    const refunded = await refundedAmount(mpPaymentId).catch(() => 0);
    if (refunded + CENT >= amount) return refunded;
    if (err instanceof AppError) throw err;
    throw new AppError("no pudimos devolver el dinero con Mercado Pago", 502, "MP_ERROR");
  }
  return refundedAmount(mpPaymentId);
}

/** tolerancia de un centavo: evita pedir reembolsos de ruido por redondeo */
const CENT = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** cuánto le devolvimos a Mercado Pago hasta ahora por ese pago */
export async function refundedAmount(mpPaymentId: string): Promise<number> {
  const res = await new PaymentRefund(mpConfig()).total({ payment_id: mpPaymentId });
  return Number(res.amount ?? 0);
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyWebhookSignature(input: {
  signatureHeader: string | undefined;
  requestIdHeader: string | undefined;
  dataId: string | undefined;
}) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    throw new AppError(
      "Mercado Pago no está configurado: falta MP_WEBHOOK_SECRET",
      503,
      "MP_NOT_CONFIGURED"
    );
  }

  const signature = input.signatureHeader ?? "";
  const ts = /(?:^|,)ts=([^,]+)/.exec(signature)?.[1];
  const v1 = /(?:^|,)v1=([a-fA-F0-9]+)/.exec(signature)?.[1];

  if (!ts || !v1 || !input.requestIdHeader) {
    throw new AppError("firma de Mercado Pago inválida", 401, "INVALID_SIGNATURE");
  }

  const manifest = `id:${input.dataId ?? ""};request-id:${input.requestIdHeader};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  if (!safeEqual(expected, v1.toLowerCase())) {
    throw new AppError("firma de Mercado Pago inválida", 401, "INVALID_SIGNATURE");
  }
}
