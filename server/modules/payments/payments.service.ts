import { Prisma } from "@prisma/client";
import type { PaymentStatus, PaymentType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  createCheckoutPreference,
  createTestPreference,
  checkAccountConnection,
  fetchPaymentState,
  getPaymentDetails,
  refundPayment,
  resolveCarrierMpToken,
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

  const { mpUserId: carrierMpUserId, accessToken: carrierMpAccessToken } =
    resolveCarrierMpToken(item.trip.carrier);

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

/**
 * Transiciones válidas de un pago por webhook. REJECTED→APPROVED existe porque
 * dentro del mismo checkout la empresa puede reintentar con otra tarjeta; el
 * reintento desde nuestra app pasa en cambio por el CAS de
 * `createPaymentPreference`, que vuelve el pago a PENDING. `charged_back` mapea
 * a REJECTED, así que un contracargo sobre un pago aprobado queda bloqueado y
 * logueado (ver L4 en docs/review/04-launch.md).
 */
const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  REJECTED: ["APPROVED"],
  APPROVED: ["REFUNDED"],
  REFUNDED: [],
};

/** el mismo estado cuenta como válido: el webhook se repite y es un no-op */
export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Lo que el webhook puede aportar. Solo `mpPaymentId` (el `data.id`) está
 * cubierto por la firma; `hintPaymentId` es el `?payment_id` que armamos en el
 * `notification_url` y sirve únicamente para encontrar el pago candidato (y con
 * él el token del transportista) la primera vez que llega su notificación.
 */
export type PaymentNotificationInput = {
  mpPaymentId: string | undefined;
  hintPaymentId: string | undefined;
};

export async function handlePaymentNotification(input: PaymentNotificationInput) {
  const { mpPaymentId } = input;
  if (!mpPaymentId) return { updated: false, status: null };

  const payment = await findPaymentForNotification(mpPaymentId, input.hintPaymentId);
  if (!payment) {
    // 200 y no 404: un pago que no es nuestro (p. ej. una preference de prueba)
    // no va a aparecer nunca, y MP reintentaría para siempre
    console.warn("[payments] webhook de un pago desconocido: se ignora");
    return { updated: false, status: null };
  }

  // el pago vive en la cuenta MP del transportista: se consulta y se reembolsa
  // con su token. Si desconectó la cuenta, el error sube y MP reintenta.
  const { accessToken } = resolveCarrierMpToken(payment.cargoItem.trip.carrier);

  // el estado lo dice MP, consultado con el data.id firmado; nunca el body
  const consulta = await fetchPaymentState(mpPaymentId, accessToken);
  if (consulta.externalReference !== payment.id) {
    console.warn(
      `[payments] webhook ignorado: el pago de MP no corresponde al pago ${payment.id}`
    );
    return { updated: false, status: payment.status };
  }
  const state = consulta.state;

  // Un pago aprobado queda atado al pago de MP que lo aprobó. Otro pago de MP
  // con el mismo external_reference (la empresa pagó dos veces la preference)
  // no lo mueve: si no, el reembolso del duplicado lo pasaría a REFUNDED.
  if (payment.status === "APPROVED" && payment.mpPaymentId !== mpPaymentId) {
    console.warn(
      `[payments] webhook ignorado: otro pago de MP sobre el pago ya aprobado ${payment.id}`
    );
    return { updated: false, status: payment.status };
  }

  if (!state) return { updated: false, status: payment.status };

  if (!canTransition(payment.status, state)) {
    // p. ej. el rechazo tardío de un intento anterior sobre un pago ya
    // aprobado, o un "approved" sobre uno ya reembolsado
    console.warn(
      `[payments] transición ignorada ${payment.status}→${state} payment=${payment.id}`
    );
    return { updated: false, status: payment.status };
  }

  if (state === payment.status) {
    // nada que mover (MP repite el webhook): a lo sumo completar el id de MP
    // si todavía no lo teníamos
    if (!payment.mpPaymentId) {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: payment.status },
        data: { mpPaymentId },
      });
    }
    // un webhook anterior pudo ganar el CAS a APPROVED y caerse antes de
    // devolver la seña de una carga retirada: el repetido termina el trabajo
    if (state === "APPROVED") {
      const refunded = await refundIfCancelled(payment.id, mpPaymentId, accessToken);
      if (refunded) return { updated: true, status: refunded };
    }
    return { updated: false, status: payment.status };
  }

  // La empresa puede retirar la carga mientras el pago está en vuelo (o antes de
  // que le llegue la notificación). Si el pago se aprueba igual, se devuelve en
  // el momento: no puede quedar una carga retirada con el pago cobrado.
  //
  // Llegar acá con APPROVED quiere decir que el pago ENTRA a APPROVED (desde
  // PENDING o REJECTED): si ya estaba cobrado al retirar, la política de
  // cancelación se aplicó y quedó congelada (RefundRequest del outbox y
  // cancellationFeeAmount), y reembolsar acá devolvería la parte retenida.
  if (state === "APPROVED" && payment.cargoItem.status === "CANCELLED") {
    const outbox = await prisma.refundRequest.findUnique({
      where: { cargoItemId: payment.cargoItemId },
    });
    if (!outbox && payment.refundedAmount === null) {
      // la seña no estaba cobrada al retirar: la penalidad congelada es 0 y
      // vuelve entera; igual se descuenta lo congelado para no depender de eso
      const target = new Prisma.Decimal(payment.amount)
        .minus(payment.cargoItem.cancellationFeeAmount ?? 0)
        .toNumber();
      const refunded = await refundPayment(mpPaymentId, target, accessToken);
      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: refunded >= Number(payment.amount) ? "REFUNDED" : "APPROVED",
          mpPaymentId,
          refundedAmount: refunded,
        },
      });
      return { updated: true, status: updated.status };
    }
  }

  // CAS contra el estado leído: dos webhooks del mismo pago pueden llegar a la
  // vez. El mpPaymentId se reemplaza: en MP cada reintento con otra tarjeta es
  // un pago nuevo, y el que vale (contra el que se reembolsa) es el que movió
  // el estado. La comisión NO se toca: quedó asentada al crear la preference,
  // cuando se sabía el priceShare, la seña y si este pago era el saldo.
  const swapped = await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: payment.status,
      // desde APPROVED, el CAS también exige el pago de MP que lo aprobó
      ...(payment.status === "APPROVED" ? { mpPaymentId } : {}),
    },
    data: { status: state, mpPaymentId },
  });
  if (swapped.count === 0) return { updated: false, status: payment.status };

  // Solo avisa el webhook que ganó la transición a APPROVED: MP repite la
  // notificación y no puede ser motivo de tres campanas.
  if (state === "APPROVED") {
    // la carga se leyó antes del CAS: si la empresa la retiró en el medio (con
    // la seña todavía PENDING), recién ahora se ve, y la seña se devuelve
    const refunded = await refundIfCancelled(payment.id, mpPaymentId, accessToken);
    if (refunded) return { updated: true, status: refunded };

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

  return { updated: true, status: state };
}

/**
 * Devuelve la seña de un pago APPROVED cuya carga está retirada sin que la
 * política de cancelación haya previsto un reembolso: pasa cuando la empresa
 * retiró con la seña todavía PENDING (penalidad congelada en 0) y el pago se
 * aprobó igual. Relee la base a propósito: lo que se leyó antes del CAS puede
 * estar viejo.
 *
 * Con RefundRequest (la seña estaba cobrada al retirar) el reembolso es cosa del
 * outbox; con `refundedAmount` ya asentado, alguien lo hizo antes. En los dos
 * casos no se toca nada. Devuelve el estado nuevo si reembolsó, o null.
 */
async function refundIfCancelled(
  paymentId: string,
  mpPaymentId: string,
  accessToken: string
): Promise<PaymentStatus | null> {
  const current = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      amount: true,
      refundedAmount: true,
      cargoItemId: true,
      cargoItem: { select: { status: true, cancellationFeeAmount: true } },
    },
  });
  if (!current || current.cargoItem.status !== "CANCELLED") return null;
  if (current.refundedAmount !== null) return null;

  const outbox = await prisma.refundRequest.findUnique({
    where: { cargoItemId: current.cargoItemId },
  });
  if (outbox) return null;

  // lo congelado al retirar manda: si la seña no estaba cobrada es 0 y vuelve
  // entera; si se retuvo entera (retiro a menos de 24 h) no hay nada que devolver
  const target = new Prisma.Decimal(current.amount)
    .minus(current.cargoItem.cancellationFeeAmount ?? 0)
    .toNumber();
  if (target < 0.01) return null;

  const refunded = await refundPayment(mpPaymentId, target, accessToken);
  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: refunded >= Number(current.amount) ? "REFUNDED" : "APPROVED",
      refundedAmount: refunded,
    },
  });
  return updated.status;
}

// el estado de la carga importa: si estaba retirada hay que devolver el pago.
// companyId y el viaje se piden para poder avisarle a la empresa qué se acreditó.
const LOOKUP = {
  include: {
    cargoItem: {
      select: {
        status: true,
        companyId: true,
        tripId: true,
        cancellationFeeAmount: true,
        trip: {
          select: { carrier: { select: { mpUserId: true, mpAccessToken: true } } },
        },
      },
    },
  },
} as const;

async function findPaymentForNotification(mpPaymentId: string, hintPaymentId?: string) {
  // ya lo conocemos por un webhook anterior: el id firmado alcanza
  const byMpPaymentId = await prisma.payment.findFirst({
    where: { mpPaymentId },
    ...LOOKUP,
  });
  if (byMpPaymentId) return byMpPaymentId;

  // primera notificación de este pago: la pista solo elige el candidato, lo
  // que vale es el external_reference que confirma MP después
  if (!hintPaymentId) return null;
  return prisma.payment.findFirst({ where: { id: hintPaymentId }, ...LOOKUP });
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
          refundedAmount:
            local.refundedAmount === null ? null : Number(local.refundedAmount),
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
