import { Prisma } from "@prisma/client";
import type { PaymentStatus, PaymentType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  createCheckoutPreference,
  createTestPreference,
  checkAccountConnection,
  fetchPaymentState,
  getPaymentDetails,
  resolveCarrierMpToken,
} from "../../lib/mercadopago.js";
import type { MpPaymentDetails } from "../../lib/mercadopago.js";
import {
  AppError,
  BalanceNotDueError,
  CargoItemNotFoundError,
  NothingToPayError,
  PaymentChargedBackError,
  PaymentNotFoundError,
} from "../../lib/errors.js";
import { activeVolume } from "../../lib/mappers.js";
import { notifyUsers } from "../../lib/notifications.js";
import { processRefundRequest } from "./refunds.service.js";
import { alertAdmins } from "./alerts.service.js";

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
  // un contracargo es final: volver a cobrarlo lo decide un admin, no la empresa
  if (existing?.status === "CHARGED_BACK") throw new PaymentChargedBackError();

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
      // el CAS también deja afuera un contracargo que llegó entre la lectura y
      // el reset (el status leído ya no coincide)
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
 * `createPaymentPreference`, que vuelve el pago a PENDING.
 *
 * CHARGED_BACK (contracargo) solo sale de APPROVED y es final: lo que MP diga
 * después se ignora y se avisa a los admins, que lo resuelven a mano.
 */
const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  REJECTED: ["APPROVED"],
  APPROVED: ["REFUNDED", "CHARGED_BACK"],
  REFUNDED: [],
  CHARGED_BACK: [],
};

/** el mismo estado cuenta como válido: el webhook se repite y es un no-op */
export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/** la moneda en la que se crean todas las preferences (`lib/mercadopago.ts`) */
const PAYMENT_CURRENCY = "ARS";

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
    // si ese otro pago está aprobado, la empresa pagó dos veces y la segunda
    // quedó en la cuenta del transportista: nadie más lo va a ver
    if (state === "APPROVED") {
      await alertAdmins(`DUPLICATE_CHARGE:${payment.id}:${mpPaymentId}`, {
        tripId: payment.cargoItem.tripId,
        title: "cobro duplicado en Mercado Pago",
        body: `el pago ${payment.id} ya estaba aprobado y MP aprobó otro (${mpPaymentId}) sobre la misma preference. revisalo y devolvé el duplicado desde la cuenta del transportista.`,
      });
    }
    return { updated: false, status: payment.status };
  }

  // un reclamo abierto no mueve el estado: la plata sigue cobrada mientras MP
  // decide. Se avisa una vez, por si termina en contracargo
  if (consulta.inMediation) {
    await alertAdmins(`IN_MEDIATION:${payment.id}:${mpPaymentId}`, {
      tripId: payment.cargoItem.tripId,
      title: "reclamo abierto en Mercado Pago",
      body: `quien pagó abrió un reclamo sobre el pago ${mpPaymentId} (pago ${payment.id}). el pago no cambia mientras MP decide; si termina en contracargo llega otro aviso.`,
    });
    return { updated: false, status: payment.status };
  }

  if (!state) return { updated: false, status: payment.status };

  if (!canTransition(payment.status, state)) {
    // p. ej. el rechazo tardío de un intento anterior sobre un pago ya
    // aprobado, o un "approved" sobre uno ya reembolsado
    console.warn(
      `[payments] transición ignorada ${payment.status}→${state} payment=${payment.id}`
    );
    await alertIgnoredChargeback(payment, mpPaymentId, state);
    return { updated: false, status: payment.status };
  }

  // Un pago no se aprueba por menos de lo que vale ni en otra moneda: la
  // preference fija el monto en ARS, pero lo que vale es lo que MP cobró.
  if (state === "APPROVED" && payment.status !== "APPROVED") {
    const cobrado = consulta.amount;
    const coincide =
      cobrado !== null &&
      consulta.currencyId === PAYMENT_CURRENCY &&
      new Prisma.Decimal(cobrado).equals(payment.amount);
    if (!coincide) {
      console.warn(
        `[payments] aprobación ignorada: el monto o la moneda de MP no coinciden con el pago ${payment.id}`
      );
      // MP cobró y el pago local sigue sin aprobar: hay que mirarlo a mano
      await alertAdmins(`AMOUNT_MISMATCH:${payment.id}:${mpPaymentId}`, {
        tripId: payment.cargoItem.tripId,
        title: "cobro con monto o moneda distintos",
        body: `MP aprobó el pago ${mpPaymentId} para el pago ${payment.id} con un monto o una moneda que no coinciden. quedó sin aprobar: revisalo en Mercado Pago.`,
      });
      return { updated: false, status: payment.status };
    }
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
    // devolver la seña de una carga retirada (o MP pudo fallar y dejar la
    // RefundRequest PENDING): el repetido termina el trabajo
    if (state === "APPROVED") {
      const refunded = await refundIfCancelled(
        payment.id,
        mpPaymentId,
        payment.cargoItem.tripId
      );
      if (refunded) return { updated: refunded !== payment.status, status: refunded };
    }
    // un webhook anterior pudo pasar el pago a REFUNDED y caerse antes de
    // retirar la carga: el repetido termina el trabajo
    if (state === "REFUNDED") {
      await releaseCargoAfterExternalRefund(
        payment.id,
        mpPaymentId,
        payment.cargoItem.tripId
      );
    }
    return { updated: false, status: payment.status };
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

  if (state === "REFUNDED") {
    await releaseCargoAfterExternalRefund(
      payment.id,
      mpPaymentId,
      payment.cargoItem.tripId
    );
  }

  // Contracargo: la plata ya volvió a quien pagó (no se devuelve nada más; el
  // outbox no devuelve un pago que no está APPROVED). Nada se mueve solo: ni la
  // carga ni el viaje. Avisa solo el webhook que ganó el CAS.
  if (state === "CHARGED_BACK") {
    await alertAdmins(`CHARGED_BACK:${payment.id}:${mpPaymentId}`, {
      tripId: payment.cargoItem.tripId,
      title: "contracargo en Mercado Pago",
      body: `MP informó un contracargo del pago ${mpPaymentId} (${payment.type === "DEPOSIT" ? "seña" : "saldo"} ${payment.id}, carga ${payment.cargoItemId}). el pago quedó en CHARGED_BACK y no se mueve más solo: revisalo en Mercado Pago y resolvelo a mano.`,
    });
  }

  // Solo avisa el webhook que ganó la transición a APPROVED: MP repite la
  // notificación y no puede ser motivo de tres campanas.
  if (state === "APPROVED") {
    // La empresa puede retirar la carga mientras el pago está en vuelo. Si el
    // pago se aprueba igual, se devuelve en el momento: no puede quedar una
    // carga retirada con el pago cobrado. Se decide después del CAS, que es el
    // reclamo: de dos webhooks simultáneos solo el que lo ganó llega acá. Y se
    // relee la carga, porque el retiro pudo commitear entre la lectura y el CAS.
    const refunded = await refundIfCancelled(
      payment.id,
      mpPaymentId,
      payment.cargoItem.tripId
    );
    if (refunded) return { updated: true, status: refunded };

    const esSeña = payment.type === "DEPOSIT";
    const { cargoItem } = payment;
    const avisos: Promise<number>[] = [
      notifyUsers([cargoItem.companyId], {
        type: "PAYMENT_APPROVED",
        title: esSeña ? "acreditamos tu seña" : "acreditamos tu saldo",
        // D1 = a: confirmar es del fletero, la empresa espera
        body: esSeña
          ? `tu seña de $${Number(payment.amount)} entró. ahora el fletero tiene que confirmar tu carga; te avisamos cuando lo haga.`
          : `tu saldo de $${Number(payment.amount)} entró. gracias por cerrar el viaje.`,
        tripId: cargoItem.tripId,
      }),
    ];
    // D1: el fletero se entera de que tiene una carga con seña para confirmar.
    // Las que no confirme se cancelan al salir (D3), con la seña devuelta.
    if (esSeña) {
      avisos.push(
        notifyUsers([cargoItem.trip.carrierId], {
          type: "PAYMENT_APPROVED",
          title: `${cargoItem.company.name} pagó la seña: ${cargoItem.trip.origin} → ${cargoItem.trip.destination}`,
          body: `entró la seña de ${cargoItem.description.toLowerCase()} (${cargoItem.volume} m³). confirmá la carga antes de salir: si salís sin confirmarla, se cancela y le devolvemos la seña a la empresa.`,
          tripId: cargoItem.tripId,
        })
      );
    }
    // best-effort: el pago ya quedó asentado. Un aviso que falla no se
    // reintenta (el webhook repetido no vuelve a ganar el CAS) ni frena el otro.
    for (const aviso of await Promise.allSettled(avisos)) {
      if (aviso.status === "rejected") {
        console.error("[payments] falló el aviso de un pago acreditado", {
          name: aviso.reason instanceof Error ? aviso.reason.name : typeof aviso.reason,
        });
      }
    }
  }

  return { updated: true, status: state };
}

/**
 * Una transición ignorada que involucra un contracargo también es plata que se
 * movió sin que la app la asiente:
 * - el pago ya tiene contracargo y MP informa otro estado (CHARGED_BACK es
 *   final; p. ej. MP falló a favor del vendedor)
 * - MP informa un contracargo de un pago que acá no estaba aprobado (se perdió
 *   el aviso de la aprobación, o el monto no coincidía)
 * Un aviso por evento: MP repite el webhook.
 */
async function alertIgnoredChargeback(
  payment: { id: string; status: PaymentStatus; cargoItem: { tripId: string } },
  mpPaymentId: string,
  state: PaymentStatus
) {
  if (payment.status === "CHARGED_BACK") {
    await alertAdmins(`CHARGED_BACK_TRANSITION:${payment.id}:${mpPaymentId}:${state}`, {
      tripId: payment.cargoItem.tripId,
      title: "cambio sobre un pago con contracargo",
      body: `MP informa el pago ${mpPaymentId} como ${state} y el pago ${payment.id} tiene un contracargo. no se movió: revisalo en Mercado Pago y resolvelo a mano.`,
    });
  } else if (state === "CHARGED_BACK") {
    await alertAdmins(`CHARGED_BACK:${payment.id}:${mpPaymentId}`, {
      tripId: payment.cargoItem.tripId,
      title: "contracargo sobre un pago no acreditado",
      body: `MP informó un contracargo del pago ${mpPaymentId} y el pago ${payment.id} figuraba ${payment.status}. no se movió: revisalo en Mercado Pago y resolvelo a mano.`,
    });
  }
}

/**
 * Devuelve la seña de un pago APPROVED cuya carga está retirada sin que la
 * política de cancelación haya previsto un reembolso: pasa cuando la empresa
 * retiró con la seña todavía PENDING (penalidad congelada en 0) y el pago se
 * aprobó igual. Relee la base a propósito: lo que se leyó antes del CAS puede
 * estar viejo.
 *
 * La devolución va por el outbox, igual que la del retiro: primero queda la
 * RefundRequest (registro durable aunque MP falle y deje de reintentar), y el
 * processor la reclama con su CAS, así que de dos webhooks a la vez solo uno le
 * pide plata a MP. Si la del retiro ya existía, no se pisa su monto: se retoma.
 *
 * Devuelve null si la carga no está retirada (el pago sigue su curso normal) o
 * el estado del pago si la devolución es cosa del outbox. Si MP falló, lanza
 * 502 para que MP reintente el webhook; la request queda PENDING igual.
 */
async function refundIfCancelled(
  paymentId: string,
  mpPaymentId: string,
  tripId: string
): Promise<PaymentStatus | null> {
  const current = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      status: true,
      type: true,
      amount: true,
      refundedAmount: true,
      cargoItemId: true,
      cargoItem: { select: { status: true, cancellationFeeAmount: true } },
    },
  });
  if (!current || current.cargoItem.status !== "CANCELLED") return null;
  // con `refundedAmount` asentado, alguien ya devolvió lo que correspondía
  if (current.refundedAmount !== null) return current.status;
  if (current.type !== "DEPOSIT") {
    // no debería pasar: el saldo se cobra con la carga confirmada, que ya no
    // se puede retirar. Si pasa, hay plata cobrada que nadie devuelve. El
    // outbox devuelve solo la seña, así que no se encola: lo decide un admin.
    console.warn(
      `[payments] saldo cobrado sobre una carga retirada: payment=${paymentId}`
    );
    await alertAdmins(`BALANCE_ON_CANCELLED_CARGO:${paymentId}:${mpPaymentId}`, {
      tripId,
      title: "saldo cobrado sobre una carga retirada",
      body: `MP aprobó el pago ${mpPaymentId} del saldo ${paymentId} y la carga está retirada. no se devuelve solo: revisalo y devolvelo desde la cuenta del transportista si corresponde.`,
    });
    return current.status;
  }

  // lo congelado al retirar manda: si la seña no estaba cobrada es 0 y vuelve
  // entera; si se retuvo entera (retiro a menos de 24 h) no hay nada que devolver
  const target = new Prisma.Decimal(current.amount).minus(
    current.cargoItem.cancellationFeeAmount ?? 0
  );
  if (target.lessThan(0.01)) return current.status;

  await prisma.refundRequest.upsert({
    where: { cargoItemId: current.cargoItemId },
    create: { cargoItemId: current.cargoItemId, targetAmount: target, status: "PENDING" },
    update: {},
  });

  const outcome = await processRefundRequest(current.cargoItemId);
  if (outcome.kind === "failed") {
    throw new AppError(
      "no pudimos devolver la seña de una carga retirada: queda pendiente de reintento",
      502,
      "MP_ERROR"
    );
  }
  if (outcome.kind === "completed" && outcome.paymentStatus) return outcome.paymentStatus;
  return current.status;
}

/** reintentos de la transacción ante un conflicto de serialización (P2034) */
const EXTERNAL_REFUND_RETRIES = 3;

type ExternalRefundOutcome =
  | { kind: "nada" }
  | { kind: "admins"; body: string }
  | {
      kind: "retirada";
      amount: number;
      companyId: string;
      companyName: string;
      carrierId: string;
      volume: number;
      trip: { id: string; origin: string; destination: string };
    };

/**
 * La seña volvió entera por fuera de la app: el transportista la devolvió desde
 * su cuenta de MP y el webhook ya pasó el pago a REFUNDED.
 *
 * La app solo devuelve señas de cargas ya retiradas (`cancelCargoItem`,
 * `refundIfCancelled`), así que una carga viva con la seña REFUNDED es una
 * devolución que la app no pidió. Sin seña la reserva no tiene respaldo: si el
 * viaje no salió, la carga se retira sola, sin penalidad (la plata ya volvió
 * entera), se libera el espacio y se avisa a la empresa y al transportista.
 * Lo que no se puede deshacer solo (el viaje ya salió, la carga tiene un pago
 * de saldo, o lo devuelto fue el saldo) no se toca: se avisa a los admins.
 *
 * Nunca le pide plata a MP ni encola una devolución: deja `refundedAmount`
 * asentado con el total, y una carga CANCELLED ya no se puede retirar.
 *
 * Relee todo dentro de una transacción serializable: se puede cruzar con el
 * retiro de la empresa o con la liberación de reservas vencidas. El CAS sobre
 * el estado de la carga hace que de dos caminos simultáneos solo uno la retire
 * (y avise). Si el conflicto no se resuelve, el error sube y MP reintenta.
 */
async function releaseCargoAfterExternalRefund(
  paymentId: string,
  mpPaymentId: string,
  tripId: string
): Promise<void> {
  let outcome: ExternalRefundOutcome | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < EXTERNAL_REFUND_RETRIES; attempt++) {
    try {
      outcome = await prisma.$transaction(
        async (tx): Promise<ExternalRefundOutcome> => {
          const current = await tx.payment.findUnique({
            where: { id: paymentId },
            select: {
              status: true,
              type: true,
              amount: true,
              cargoItem: {
                select: {
                  id: true,
                  status: true,
                  companyId: true,
                  volume: true,
                  company: { select: { name: true } },
                  payments: { select: { type: true } },
                  trip: {
                    select: {
                      id: true,
                      status: true,
                      capacityTotal: true,
                      carrierId: true,
                      origin: true,
                      destination: true,
                      cargoItems: { select: { id: true, volume: true, status: true } },
                    },
                  },
                },
              },
            },
          });
          if (!current || current.status !== "REFUNDED") return { kind: "nada" };
          const item = current.cargoItem;
          // retirada por la app (que pidió esta devolución) o por un webhook anterior
          if (item.status === "CANCELLED") return { kind: "nada" };

          const trip = item.trip;
          if (current.type !== "DEPOSIT") {
            return {
              kind: "admins",
              body: `MP informa que el pago ${mpPaymentId} del saldo ${paymentId} se devolvió entero desde la cuenta del transportista. la carga no se tocó: revisala.`,
            };
          }
          if (trip.status !== "OPEN" && trip.status !== "FULL") {
            return {
              kind: "admins",
              body: `MP informa que el pago ${mpPaymentId} de la seña ${paymentId} se devolvió entero desde la cuenta del transportista, y el viaje ya salió. la carga no se tocó: revisala.`,
            };
          }
          if (item.payments.some((p) => p.type === "BALANCE")) {
            return {
              kind: "admins",
              body: `MP informa que el pago ${mpPaymentId} de la seña ${paymentId} se devolvió entero desde la cuenta del transportista, y la carga ya tiene un pago de saldo. la carga no se tocó: revisala.`,
            };
          }

          // CAS: si la empresa la retiró después de la relectura, no se pisa su retiro
          const released = await tx.cargoItem.updateMany({
            where: { id: item.id, status: { in: ["PENDING", "CONFIRMED"] } },
            data: {
              status: "CANCELLED",
              cancelledAt: new Date(),
              // la seña volvió entera: no se retuvo nada
              cancellationFeeAmount: new Prisma.Decimal(0),
              cancellationReason: "REFUNDED_BY_CARRIER",
            },
          });
          if (released.count === 0) return { kind: "nada" };

          await tx.payment.updateMany({
            where: { id: paymentId, status: "REFUNDED", refundedAmount: null },
            data: { refundedAmount: current.amount },
          });

          const used = activeVolume(trip.cargoItems.filter((c) => c.id !== item.id));
          if (trip.status === "FULL" && used < trip.capacityTotal) {
            await tx.trip.update({ where: { id: trip.id }, data: { status: "OPEN" } });
          }

          return {
            kind: "retirada",
            amount: Number(current.amount),
            companyId: item.companyId,
            companyName: item.company.name,
            carrierId: trip.carrierId,
            volume: item.volume,
            trip: { id: trip.id, origin: trip.origin, destination: trip.destination },
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 15000,
        }
      );
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
        continue;
      }
      throw err;
    }
  }
  if (!outcome) throw lastError;

  if (outcome.kind === "admins") {
    console.warn(`[payments] devolución hecha por fuera de la app: payment=${paymentId}`);
    await alertAdmins(`EXTERNAL_REFUND:${paymentId}:${mpPaymentId}`, {
      tripId,
      title: "devolución hecha desde Mercado Pago",
      body: outcome.body,
    });
    return;
  }
  if (outcome.kind !== "retirada") return;

  // best-effort: la carga ya quedó retirada. Un aviso que falla no se reintenta
  // (el repetido de MP ve la carga CANCELLED), pero tampoco tumba el webhook ni
  // frena el otro aviso.
  const r = outcome;
  const ruta = `${r.trip.origin} → ${r.trip.destination}`;
  const avisos = await Promise.allSettled([
    notifyUsers([r.companyId], {
      type: "CARGO_CANCELLED",
      title: "el transportista te devolvió la seña",
      body: `te devolvió la seña de $${r.amount} desde Mercado Pago, así que tu carga (${r.volume} m³) se retiró del viaje ${ruta}. si todavía querés ese espacio, reservalo de nuevo.`,
      tripId: r.trip.id,
    }),
    notifyUsers([r.carrierId], {
      type: "CARGO_CANCELLED",
      title: `devolviste una seña del viaje ${ruta}`,
      body: `como devolviste la seña de $${r.amount} desde Mercado Pago, la carga de ${r.companyName} (${r.volume} m³) se retiró del viaje y el espacio quedó libre.`,
      tripId: r.trip.id,
    }),
  ]);
  for (const aviso of avisos) {
    if (aviso.status === "rejected") {
      console.error(
        "[payments] falló el aviso de una seña devuelta por fuera de la app",
        {
          name: aviso.reason instanceof Error ? aviso.reason.name : typeof aviso.reason,
        }
      );
    }
  }
}

// companyId y el viaje se piden para poder avisarle a la empresa qué se acreditó
// y, si es la seña, al fletero que tiene una carga para confirmar (D1).
// El estado de la carga no: se relee después del CAS (ver refundIfCancelled).
const LOOKUP = {
  include: {
    cargoItem: {
      select: {
        companyId: true,
        tripId: true,
        // para el aviso al fletero cuando entra la seña (D1)
        description: true,
        volume: true,
        company: { select: { name: true } },
        trip: {
          select: {
            carrierId: true,
            origin: true,
            destination: true,
            carrier: { select: { mpUserId: true, mpAccessToken: true } },
          },
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
