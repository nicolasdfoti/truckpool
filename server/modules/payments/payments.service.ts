import { Prisma } from "@prisma/client";
import type { PaymentType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { decryptSecret } from "../../lib/crypto.js";
import {
  createCheckoutPreference,
  createTestPreference,
  checkAccountConnection,
  fetchPaymentState,
  getPaymentDetails,
  refundPayment,
  toPaymentState,
} from "../../lib/mercadopago.js";
import type { MpPaymentDetails } from "../../lib/mercadopago.js";
import {
  AppError,
  BalanceNotDueError,
  CargoItemNotFoundError,
  NothingToPayError,
  PaymentNotFoundError,
} from "../../lib/errors.js";
import { notifyUsers } from "../../lib/notifications.js";

export type PaymentPreferenceResult = {
  paymentId: string;
  cargoItemId: string;
  type: PaymentType;
  amount: number;
  status: "PENDING";
  initPoint: string;
  platformFeeAmount: number;
  carrierAmount: number;
};

/** lo que falta pagar: el saldo es el total de la carga menos la seña */
function balanceOf(item: { priceShare: Prisma.Decimal; depositAmount: Prisma.Decimal }) {
  return new Prisma.Decimal(item.priceShare).minus(item.depositAmount).toDecimalPlaces(2);
}

/**
 * Reparte la comisión de plataforma de una carga entre sus dos pagos.
 *
 * La comisión total es `priceShare * platformFeePercent / 100` y se cobra UNA
 * sola vez en todo el ciclo de la carga:
 *   - la seña se lleva su parte proporcional (`depositAmount * percent / 100`);
 *   - el saldo se lleva lo que queda del total, no su propio porcentaje.
 *
 * No es lo mismo calcular `balance * percent` y redondear por separado: con
 * centavos impares los dos redondeos se pueden ir un peso del total. Por eso el
 * saldo se calcula como la resta, y la suma de los dos pagos da exactamente
 * `priceShare * percent / 100`.
 */
export function splitPlatformFee(
  item: { priceShare: Prisma.Decimal; depositAmount: Prisma.Decimal },
  platformFeePercent: number,
  type: PaymentType
): { platformFeeAmount: number; carrierAmount: number } {
  if (
    !Number.isFinite(platformFeePercent) ||
    platformFeePercent < 0 ||
    platformFeePercent > 100
  ) {
    throw new AppError(
      "el porcentaje de comisión de plataforma es inválido",
      500,
      "MP_INVALID_FEE_PERCENT"
    );
  }

  const priceShare = new Prisma.Decimal(item.priceShare);
  const depositAmount = new Prisma.Decimal(item.depositAmount);
  const percent = new Prisma.Decimal(platformFeePercent);

  const totalFee = priceShare.mul(percent).div(100).toDecimalPlaces(2);
  const depositFee = depositAmount.mul(percent).div(100).toDecimalPlaces(2);
  const fee = type === "DEPOSIT" ? depositFee : totalFee.minus(depositFee);

  const charged = type === "DEPOSIT" ? depositAmount : priceShare.minus(depositAmount);

  return {
    platformFeeAmount: fee.toNumber(),
    carrierAmount: charged.minus(fee).toNumber(),
  };
}

export async function createPaymentPreference(
  cargoItemId: string,
  companyId: string,
  type: PaymentType = "DEPOSIT"
): Promise<PaymentPreferenceResult> {
  const item = await prisma.cargoItem.findUnique({
    where: { id: cargoItemId },
    include: {
      company: { select: { email: true } },
      trip: {
        select: {
          status: true,
          platformFeePercent: true,
          carrier: { select: { mpUserId: true, mpAccessToken: true } },
        },
      },
    },
  });
  if (!item) throw new CargoItemNotFoundError();
  if (item.companyId !== companyId) {
    throw new AppError(
      "solo la empresa dueña de la carga puede pagarla",
      403,
      "FORBIDDEN"
    );
  }

  const existing = await prisma.payment.findUnique({
    where: { cargoItemId_type: { cargoItemId: item.id, type } },
  });
  // nunca pisamos un pago ya acreditado: la empresa volvería a pagar por lo
  // mismo. (el status lo mueve el webhook, no esta función)
  if (existing?.status === "APPROVED" || existing?.status === "REFUNDED") {
    throw new NothingToPayError();
  }

  // la seña se paga al reservar; el saldo recién cuando el viaje salió, así que
  // una carga retirada o sin confirmar no tiene nada que cobrar.
  const amount =
    type === "DEPOSIT" ? new Prisma.Decimal(item.depositAmount) : balanceOf(item);
  if (type === "BALANCE") {
    if (item.status !== "CONFIRMED" || item.trip.status !== "IN_TRANSIT") {
      throw new BalanceNotDueError();
    }
    if (amount.lte(0)) throw new NothingToPayError();
  } else {
    // la seña existe solo para reservar el lugar: si la carga ya se confirmó
    // (o se retiró) cobrar una seña nueva no tiene sentido y dejaría el pago
    // colgado de una carga que ya pasó la etapa de la reserva.
    if (item.status === "CANCELLED") {
      throw new AppError("esa carga fue retirada, no se cobra", 409, "CARGO_CANCELLED");
    }
    if (item.status !== "PENDING") throw new NothingToPayError();
  }

  // El pago se resetea a PENDING para reintentar con otra tarjeta. Es un
  // compare-and-swap contra el status que leímos: si el webhook de Mercado Pago
  // acreditó o reembolsó el pago entre la lectura y el update, el count vuelve en
  // 0 y no lo pisamos (pisarlo dejaría una plata cobrada figurando impaga).
  let payment;
  if (existing) {
    const swapped = await prisma.payment.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { amount, status: "PENDING", mpPaymentId: null, refundedAmount: null },
    });
    if (swapped.count === 0) throw new NothingToPayError();
    payment = await prisma.payment.findUnique({ where: { id: existing.id } });
    if (!payment) throw new NothingToPayError();
  } else {
    try {
      payment = await prisma.payment.create({
        data: { cargoItemId: item.id, amount, type },
      });
    } catch (err) {
      // dos requests simultáneos del botón "pagar": el único (cargoItemId,
      // type) hace que uno gane. el que pierde reintenta con el link del otro.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(
          "ya hay un pago en curso para esta carga, probá de nuevo en un momento",
          409,
          "PAYMENT_IN_PROGRESS"
        );
      }
      throw err;
    }
  }

  // El token se descifra acá, en el último momento antes de pegarle a la API
  // de Mercado Pago, y no antes: en cualquier log o error de la base queda
  // siempre el sobre cifrado.
  const carrierMpUserId = item.trip.carrier.mpUserId;
  if (!carrierMpUserId || !item.trip.carrier.mpAccessToken) {
    throw new AppError(
      "el transportista de este viaje no tiene cuenta de Mercado Pago conectada",
      409,
      "MP_ACCOUNT_NOT_CONNECTED"
    );
  }
  const carrierMpAccessToken = decryptSecret(item.trip.carrier.mpAccessToken);

  const fee = splitPlatformFee(item, item.trip.platformFeePercent, type);

  const { preferenceId, initPoint, platformFeeAmount, carrierAmount } =
    await createCheckoutPreference({
      paymentId: payment.id,
      cargoItemId: item.id,
      description: item.description,
      amount: Number(amount),
      tripId: item.tripId,
      clientEmail: item.company.email,
      paymentType: type,
      carrierMpUserId,
      carrierMpAccessToken,
      platformFeeAmount: fee.platformFeeAmount,
    });

  // lo que queda asentado es exactamente el repartido que se mandó a Mercado
  // Pago, ya redondeado a dos decimales
  await prisma.payment.update({
    where: { id: payment.id },
    data: { mpPreferenceId: preferenceId, platformFeeAmount, carrierAmount },
  });

  return {
    paymentId: payment.id,
    cargoItemId: item.id,
    type,
    amount: Number(amount),
    status: "PENDING",
    initPoint,
    platformFeeAmount,
    carrierAmount,
  };
}

export type PaymentNotificationInput = {
  preferenceId?: string | undefined;
  paymentId?: string | undefined;
  mpPaymentId?: string | undefined;
  status?: string | undefined;
};

export async function handlePaymentNotification(input: PaymentNotificationInput) {
  const payment = await findPaymentForNotification(input);
  if (!payment) return { updated: false, status: null };

  const state = input.status
    ? toPaymentState(input.status)
    : input.mpPaymentId
      ? await fetchPaymentState(input.mpPaymentId)
      : null;

  if (!state) return { updated: false, status: payment.status };

  const mpPaymentId = input.mpPaymentId ?? payment.mpPaymentId;

  // La empresa puede retirar la carga mientras el pago está en vuelo (o antes de
  // que le llegue la notificación). Si el pago se aprueba igual, se devuelve el
  // dinero en el momento: no puede quedar una carga retirada con el pago cobrado.
  // Es la excepción a la ventana de cancelación: acá el retiro ya pasó y el
  // Acá va entero a propósito: el retiro ya pasó y la seña estaba sin cobrar, así
  // que la ventana de cancelación no aplica (no se cobró nada).
  if (state === "APPROVED" && payment.cargoItem.status === "CANCELLED" && mpPaymentId) {
    const refunded = await refundPayment(mpPaymentId, Number(payment.amount));
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", mpPaymentId, refundedAmount: refunded },
    });
    return { updated: true, status: updated.status };
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: state,
      mpPaymentId: input.mpPaymentId ?? payment.mpPaymentId,
      // La comisión NO se recalcula acá: se calculó al crear la preference,
      // cuando se sabía el priceShare, la seña y si este pago era el saldo.
      // Recalcularla desde payment.amount por separado haría que el webhook
      // y el checkout puedan discrepar. Se conserva lo que ya está asentado.
      platformFeeAmount: payment.platformFeeAmount,
      carrierAmount: payment.carrierAmount,
    },
  });

  // Solo se avisa al pasar a APPROVED: el webhook de Mercado Pago llega varias
  // veces por el mismo pago y no puede ser motivo de tres campanas.
  if (state === "APPROVED" && payment.status !== "APPROVED") {
    const esSeña = payment.type === "DEPOSIT";
    await notifyUsers([payment.cargoItem.companyId], {
      type: "PAYMENT_APPROVED",
      title: esSeña ? "acreditamos tu seña" : "acreditamos tu saldo",
      body: esSeña
        ? `tu seña de $${Number(payment.amount)} entró. ya podés confirmar la carga en el viaje.`
        : `tu saldo de $${Number(payment.amount)} entró. gracias por cerrar el viaje.`,
      tripId: payment.cargoItem.tripId,
    });
  }

  return { updated: true, status: updated.status };
}

// el estado de la carga importa: si estaba retirada hay que devolver el pago.
// companyId y el viaje se piden para poder avisarle a la empresa qué se acreditó.
const LOOKUP = {
  include: {
    cargoItem: { select: { status: true, companyId: true, tripId: true } },
  },
} as const;

async function findPaymentForNotification(input: PaymentNotificationInput) {
  if (input.preferenceId) {
    const byPreference = await prisma.payment.findFirst({
      where: { mpPreferenceId: input.preferenceId },
      ...LOOKUP,
    });
    if (byPreference) return byPreference;
  }

  if (input.paymentId) {
    const byReference = await prisma.payment.findFirst({
      // una carga tiene dos pagos: si nos pasan solo el id de la carga asumimos
      // que hablan de la seña, que es la que se paga antes de confirmar.
      where: {
        OR: [{ id: input.paymentId }, { cargoItemId: input.paymentId, type: "DEPOSIT" }],
      },
      ...LOOKUP,
    });
    if (byReference) return byReference;
  }

  if (input.mpPaymentId) {
    const byMpPaymentId = await prisma.payment.findFirst({
      where: { mpPaymentId: input.mpPaymentId },
      ...LOOKUP,
    });
    if (byMpPaymentId) return byMpPaymentId;
  }

  if (input.preferenceId || input.paymentId) {
    throw new PaymentNotFoundError();
  }

  return null;
}

/**
 * Prueba de conexión con Mercado Pago.
 *
 * Es un endpoint de diagnóstico: no toca la base ni el ciclo de pagos, sólo
 * confirma que la API acepta `MP_ACCESS_TOKEN`. Va por el mismo service que el
 * resto del módulo para que el token se lea siempre en un solo lugar
 * (`lib/mercadopago.ts`).
 */
export async function getMpConnectionStatus() {
  const result = await checkAccountConnection();
  return { ok: true as const, ...result };
}

export async function getTestPreference(input: {
  title: string;
  quantity: number;
  unitPrice: number;
}) {
  const result = await createTestPreference(input);
  return { ok: true as const, ...result };
}

/** Usuario logueado: id y rol, como los deja `requireAuth` en `req.user`. */
export type PaymentViewer = { id: string; role: "COMPANY" | "CARRIER" | "ADMIN" };

/**
 * Traza un pago de punta a punta: qué dice Mercado Pago, y qué pago interno
 * de nuestra base le corresponde.
 *
 * Quién puede verlo, y por qué: el `Payment` se busca por `mpPaymentId`, así que
 * el Dueño del recurso es quien está en el viaje: la empresa que Reservó la
 * carga o el transportista que la transporta. ADMIN ve todos. Nadie más.
 *
 * La alternativa obvia —"sólo ADMIN" como los otros endpoints de diagnóstico de
 * MP— dejaría el hueco que este endpoint viene a tapar: durante el desarrollo
 * el que necesita ver la traza es la empresa o el transportista que está
 * probando el pago, no el que administra la plataforma.
 *
 * Si el pago existe en MP pero no en nuestra base (una preference de prueba, o
 * un pago cuyo webhook todavía no llegó), se devuelve el detalle de MP igual y
 * `local: null`: la información pedida existe y esconderla porque falte el
 * link interno no ayuda a depurar. Si tampoco existe en MP, el 404 understandable
 * lo levanta `getPaymentDetails`.
 *
 * `liveMode` se devuelve explícito para poder distinguir a simple vista un pago
 * de sandbox de uno real, y se loguea: es la señal de alarma barata contra
 * cobrar plata real por error en desarrollo.
 */
export async function tracePayment(mpPaymentId: string, viewer: PaymentViewer) {
  const local = await prisma.payment.findFirst({
    where: { mpPaymentId },
    select: {
      id: true,
      type: true,
      status: true,
      amount: true,
      mpPaymentId: true,
      mpPreferenceId: true,
      platformFeeAmount: true,
      carrierAmount: true,
      refundedAmount: true,
      cargoItem: { select: { id: true, companyId: true, tripId: true } },
    },
  });

  if (local) {
    const isOwner =
      viewer.role === "ADMIN" ||
      local.cargoItem.companyId === viewer.id ||
      (await isTripCarrier(local.cargoItem.tripId, viewer.id));
    if (!isOwner) {
      // 404 y no 403 a propósito: no le confirmamos a un usuario ajeno que ese
      // pago existe, igual que hacemos con los avisos de otro usuario.
      throw new PaymentNotFoundError();
    }
  } else if (viewer.role !== "ADMIN") {
    // sin pago interno no hay dueño contra el cual comparar, así que sin
    // registro sólo puede mirarlo ADMIN.
    throw new PaymentNotFoundError();
  }

  const details: MpPaymentDetails = await getPaymentDetails(mpPaymentId);

  // sin datos de la tarjeta ni nada sensible: sólo el id de MP, si es real, y
  // el estado. El `console.info` (no warn/error) es deliberado: esto no es un
  // fallo, es la traza que se pidió.
  console.info(
    `[payments] traza mp=${details.id} status=${details.status} live_mode=${details.liveMode} ` +
      `mapped=${details.mappedStatus ?? "-"} local=${local?.id ?? "sin-pago-interno"}`
  );

  return {
    ok: true as const,
    // replicado arriba del objeto para que se lea sin bajar a `details`:
    // un `true` acá tiene que saltar a la vista.
    liveMode: details.liveMode,
    isTestPayment: details.liveMode === false,
    details,
    local: local
      ? {
          paymentId: local.id,
          type: local.type,
          status: local.status,
          amount: Number(local.amount),
          mpPreferenceId: local.mpPreferenceId,
          platformFeeAmount: local.platformFeeAmount,
          carrierAmount: local.carrierAmount,
          refundedAmount: local.refundedAmount === null ? null : Number(local.refundedAmount),
          cargoItemId: local.cargoItem.id,
          tripId: local.cargoItem.tripId,
        }
      : null,
  };
}

/** el transportista de ese viaje es `userId`? */
async function isTripCarrier(tripId: string, userId: string): Promise<boolean> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { carrierId: true },
  });
  return trip?.carrierId === userId;
}

export { balanceOf };
