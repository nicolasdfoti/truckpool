import { prisma } from "../../lib/prisma.js";
import type { User } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import {
  AlreadyVerifiedError,
  CarrierNotFoundError,
  VerificationNotPendingError,
  VerificationNoteRequiredError,
} from "../../lib/errors.js";
import { toCargoItemResponse, toTripSummary } from "../../lib/mappers.js";
import { endOfArgentinaDay } from "../../lib/dates.js";
import { encryptSecret } from "../../lib/crypto.js";
import { signOAuthState } from "../../lib/auth.js";
import type {
  RequestVerificationInput,
  ReviewVerificationInput,
  UpdateProfileInput,
  CreateTripRequestInput,
  RespondTripRequestInput,
} from "./users.schemas.js";

const RECENT_REVIEWS = 5;

function toRatingSummary(avg: number | null, count: number): RatingSummary {
  return {
    ratingAvg: count > 0 && avg !== null ? Number(avg.toFixed(2)) : null,
    ratingCount: count,
  };
}

function toProfileUser(
  user: Pick<
    User,
    | "id"
    | "email"
    | "name"
    | "role"
    | "bio"
    | "phone"
    | "taxId"
    | "verificationStatus"
    | "verificationNote"
    | "emailNotifications"
    | "isAvailableNow"
    | "mpUserId"
  >
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    bio: user.bio,
    phone: user.phone,
    taxId: user.taxId,
    verificationStatus: user.verificationStatus,
    verificationNote: user.verificationNote,
    emailNotifications: user.emailNotifications,
    isAvailableNow: user.isAvailableNow,
    // Solo el booleano: el frontend necesita saber si puede cobrar, no
    // cuál es el id de la cuenta ni el token. mpUserId y mpAccessToken se
    // quedan adentro del server.
    mpConnected: user.mpUserId !== null,
  };
}

export async function getMyProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError("usuario no encontrado", 404, "USER_NOT_FOUND");
  }
  return { user: toProfileUser(user) };
}

export async function updateMyProfile(userId: string, input: UpdateProfileInput) {
  const data: {
    name?: string;
    bio?: string | null;
    phone?: string | null;
    emailNotifications?: boolean;
    isAvailableNow?: boolean;
  } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.bio !== undefined) data.bio = input.bio === "" ? null : input.bio;
  if (input.phone !== undefined) data.phone = input.phone === "" ? null : input.phone;
  if (input.emailNotifications !== undefined) {
    data.emailNotifications = input.emailNotifications;
  }
  if (input.isAvailableNow !== undefined) {
    data.isAvailableNow = input.isAvailableNow;
  }

  const user = await prisma.user.update({ where: { id: userId }, data });
  return { user: toProfileUser(user) };
}

export async function listMyTrips(carrierId: string) {
  const trips = await prisma.trip.findMany({
    where: { carrierId },
    include: { cargoItems: true, carrier: { select: { name: true } } },
    orderBy: { date: "desc" },
  });
  return trips.map(toTripSummary);
}

export async function listMyCargoItems(companyId: string) {
  const items = await prisma.cargoItem.findMany({
    where: { companyId },
    include: {
      payments: true,
      trip: {
        select: { id: true, origin: true, destination: true, date: true, status: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return items.map((item) => ({ ...toCargoItemResponse(item), trip: item.trip }));
}

type RatingSummary = { ratingAvg: number | null; ratingCount: number };

function emptyRatingSummary(): RatingSummary {
  return { ratingAvg: null, ratingCount: 0 };
}

export async function listCarriers() {
  const [carriers, ratings] = await Promise.all([
    prisma.user.findMany({
      where: { role: "CARRIER" },
      select: {
        id: true,
        name: true,
        bio: true,
        isAvailableNow: true,
        _count: { select: { tripsAsCarrier: { where: { status: "OPEN" } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.review.groupBy({
      by: ["toUserId"],
      where: { toUser: { role: "CARRIER" } },
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ]);

  const ratingsByUser = new Map(
    ratings.map((row) => [
      row.toUserId,
      toRatingSummary(row._avg.rating, row._count._all),
    ])
  );

  return carriers.map((carrier) => ({
    id: carrier.id,
    name: carrier.name,
    bio: carrier.bio,
    isAvailableNow: carrier.isAvailableNow,
    openTrips: carrier._count.tripsAsCarrier,
    ...(ratingsByUser.get(carrier.id) ?? emptyRatingSummary()),
  }));
}

export async function getCarrierProfile(id: string) {
  const [carrier, aggregate] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      include: {
        tripsAsCarrier: {
          // Esta vista es la de "viajes abiertos" del transportista: es donde una
          // empresa busca un viaje para sumarle carga. Por eso
          // comparte la regla de disponibilidad del listado público (status
          // OPEN + fecha de un día posterior a hoy en Argentina).
          where: { status: "OPEN", date: { gt: endOfArgentinaDay() } },
          include: { cargoItems: true, carrier: { select: { name: true } } },
          orderBy: { date: "asc" },
        },
        reviewsReceived: {
          orderBy: { createdAt: "desc" },
          take: RECENT_REVIEWS,
          include: {
            fromUser: { select: { name: true } },
            trip: { select: { id: true, origin: true, destination: true } },
          },
        },
      },
    }),
    prisma.review.aggregate({
      where: { toUserId: id },
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ]);
  if (!carrier || carrier.role !== "CARRIER") {
    throw new CarrierNotFoundError();
  }
  return {
    id: carrier.id,
    name: carrier.name,
    bio: carrier.bio,
    phone: carrier.phone,
    isAvailableNow: carrier.isAvailableNow,
    trips: carrier.tripsAsCarrier.map(toTripSummary),
    ...toRatingSummary(aggregate._avg.rating, aggregate._count._all),
    reviews: carrier.reviewsReceived.map((review) => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      fromName: review.fromUser.name,
      trip: review.trip,
    })),
  };
}

/** el fletero manda su DNI/CUIT y queda PENDING hasta que un admin lo apruebe */
export async function requestVerification(
  userId: string,
  input: RequestVerificationInput
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError("usuario no encontrado", 404, "USER_NOT_FOUND");
  }
  if (user.verificationStatus === "VERIFIED") throw new AlreadyVerifiedError();

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      taxId: input.taxId,
      verificationStatus: "PENDING",
      // al reenviar se limpia la nota del rechazo anterior.
      verificationNote: null,
    },
  });
  return { user: toProfileUser(updated) };
}

export async function listPendingVerifications() {
  const users = await prisma.user.findMany({
    where: { verificationStatus: "PENDING" },
    select: { id: true, name: true, email: true, taxId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    taxId: user.taxId,
    requestedAt: user.createdAt,
  }));
}

export async function reviewVerification(userId: string, input: ReviewVerificationInput) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError("usuario no encontrado", 404, "USER_NOT_FOUND");
  }
  if (user.verificationStatus !== "PENDING") throw new VerificationNotPendingError();
  if (!input.approve && !input.note) throw new VerificationNoteRequiredError();

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      verificationStatus: input.approve ? "VERIFIED" : "REJECTED",
      verificationNote: input.approve ? null : (input.note ?? null),
    },
  });

  return {
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      taxId: updated.taxId,
      verificationStatus: updated.verificationStatus,
      verificationNote: updated.verificationNote,
    },
  };
}

/**
 * Métricas reales de la plataforma para el dashboard del admin.
 *
 * Los campos que dependen de fases no implementadas vuelven en `null` en vez
 * de un 0 inventado. `kmEvitados` no se calcula: sin geodata no hay forma
 * honesta de estimarlo.
 */
export type AdminStats = {
  tripsByStatus: Record<"OPEN" | "FULL" | "IN_TRANSIT" | "COMPLETED", number>;
  totalTrips: number;
  volumeTransported: number;
  billedAmount: number | null;
  activeCarriers: number;
  activeCompanies: number;
  averageRating: number | null;
  /** por qué cada métrica quedó en null, para que la UI no muestre un 0 falso */
  pendingReasons: Record<string, string>;
  notes: string[];
};

const TRIP_STATUSES = ["OPEN", "FULL", "IN_TRANSIT", "COMPLETED"] as const;

export async function getAdminStats(): Promise<AdminStats> {
  const notes: string[] = [];
  const pendingReasons: Record<string, string> = {};

  // Si la fase de la que depende una métrica no está implementada, el delegate
  // no existe y la métrica queda en null (no en 0, para no mentir).
  const hasPayments = "payment" in prisma;
  const hasReviews = "review" in prisma;
  if (!hasPayments) {
    notes.push("facturado: fase de pagos no implementada");
    pendingReasons.billedAmount = "fase de pagos no implementada";
  }
  if (!hasReviews) {
    notes.push("rating promedio: fase de reviews no implementada");
    pendingReasons.averageRating = "fase de reviews no implementada";
  }
  notes.push("km evitados: no se calcula (fase 14, requiere geodata real)");

  const [tripGroups, volumeAgg, paymentAgg, carrierCount, companyCount, reviewAgg] =
    await Promise.all([
      prisma.trip.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.cargoItem.aggregate({
        _sum: { volume: true },
        where: { status: "CONFIRMED" },
      }),
      hasPayments
        ? prisma.payment.aggregate({
            _sum: { amount: true },
            where: { status: "APPROVED" },
          })
        : null,
      prisma.user.count({
        where: { role: "CARRIER", tripsAsCarrier: { some: {} } },
      }),
      prisma.user.count({
        where: { role: "COMPANY", cargoItems: { some: {} } },
      }),
      hasReviews ? prisma.review.aggregate({ _avg: { rating: true } }) : null,
    ]);

  const tripsByStatus = Object.fromEntries(
    TRIP_STATUSES.map((status) => [status, 0])
  ) as AdminStats["tripsByStatus"];
  for (const group of tripGroups) {
    if ((TRIP_STATUSES as readonly string[]).includes(group.status)) {
      tripsByStatus[group.status] = group._count._all;
    }
  }

  const billedAmount = paymentAgg?._sum.amount
    ? Number(paymentAgg._sum.amount)
    : paymentAgg
      ? 0
      : null;
  if (billedAmount === 0 && !pendingReasons.billedAmount) {
    notes.push("facturado: todavía no hay pagos aprobados");
  }

  const avg = reviewAgg?._avg.rating ?? null;
  const averageRating = avg === null ? null : Number(avg);
  if (averageRating === null && hasReviews) {
    notes.push("rating promedio: todavía no hay calificaciones");
    pendingReasons.averageRating = "todavía no hay calificaciones";
  }

  return {
    tripsByStatus,
    totalTrips: TRIP_STATUSES.reduce((sum, status) => sum + tripsByStatus[status], 0),
    volumeTransported: volumeAgg._sum.volume ?? 0,
    billedAmount,
    activeCarriers: carrierCount,
    activeCompanies: companyCount,
    averageRating,
    pendingReasons,
    notes,
  };
}

type TripRequestWithRelations = {
  id: string;
  origin: string;
  destination: string;
  desiredDate: Date;
  estimatedVolume: number;
  note: string | null;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  resultingTripId: string | null;
  createdAt: Date;
  company: { id: string; name: string; email?: string; emailNotifications?: boolean };
  carrier: { id: string; name: string; email?: string; emailNotifications?: boolean };
};

function toTripRequestResponse(request: TripRequestWithRelations) {
  return {
    id: request.id,
    origin: request.origin,
    destination: request.destination,
    desiredDate: request.desiredDate.toISOString(),
    estimatedVolume: request.estimatedVolume,
    note: request.note,
    status: request.status,
    resultingTripId: request.resultingTripId,
    createdAt: request.createdAt.toISOString(),
    company: { id: request.company.id, name: request.company.name },
    carrier: { id: request.carrier.id, name: request.carrier.name },
  };
}

export async function createTripRequest(
  companyId: string,
  input: CreateTripRequestInput
) {
  const carrier = await prisma.user.findUnique({
    where: { id: input.carrierId },
    select: {
      id: true,
      role: true,
      isAvailableNow: true,
      name: true,
      email: true,
      emailNotifications: true,
    },
  });
  if (!carrier) {
    throw new AppError("transportista no encontrado", 404, "CARRIER_NOT_FOUND");
  }
  if (carrier.role !== "CARRIER") {
    throw new AppError(
      "el usuario seleccionado no es un transportista",
      400,
      "NOT_A_CARRIER"
    );
  }
  // Cualquier CARRIER puede recibir requests; isAvailableNow es solo informativo

  const request = await prisma.tripRequest.create({
    data: {
      companyId,
      carrierId: input.carrierId,
      origin: input.origin,
      destination: input.destination,
      desiredDate: input.desiredDate,
      estimatedVolume: input.estimatedVolume,
      note: input.note ?? null,
    },
    include: {
      company: { select: { id: true, name: true } },
      carrier: {
        select: { id: true, name: true, email: true, emailNotifications: true },
      },
    },
  });

  // Notificar al carrier
  const { notifyUsers } = await import("../../lib/notifications.js");
  await notifyUsers([input.carrierId], {
    type: "TRIP_REQUEST",
    title: `nueva solicitud de viaje: ${input.origin} → ${input.destination}`,
    body: `${request.company.name} te pidió un viaje para el ${new Date(
      input.desiredDate
    ).toLocaleDateString("es-AR")} (${input.estimatedVolume} m³).`,
    tripId: null,
    email: (recipient) => ({
      subject: `Nueva solicitud de viaje: ${input.origin} → ${input.destination}`,
      html: `
        <p>Hola ${recipient.name},</p>
        <p><strong>${request.company.name}</strong> te solicitó un viaje directo:</p>
        <ul>
          <li><strong>Origen:</strong> ${input.origin}</li>
          <li><strong>Destino:</strong> ${input.destination}</li>
          <li><strong>Fecha deseada:</strong> ${new Date(
            input.desiredDate
          ).toLocaleDateString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}</li>
          <li><strong>Volumen estimado:</strong> ${input.estimatedVolume} m³</li>
          ${input.note ? `<li><strong>Nota:</strong> ${input.note}</li>` : ""}
        </ul>
        <p>Iniciá sesión para ver la solicitud y responder.</p>
      `,
    }),
  });

  return { request: toTripRequestResponse(request) };
}

export async function getReceivedTripRequests(carrierId: string) {
  const requests = await prisma.tripRequest.findMany({
    where: { carrierId, status: "PENDING" },
    include: {
      company: { select: { id: true, name: true } },
      carrier: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return requests.map(toTripRequestResponse);
}

export async function getSentTripRequests(companyId: string) {
  const requests = await prisma.tripRequest.findMany({
    where: { companyId },
    include: {
      company: { select: { id: true, name: true } },
      carrier: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return requests.map(toTripRequestResponse);
}

export async function respondTripRequest(
  requestId: string,
  carrierId: string,
  input: RespondTripRequestInput
) {
  const request = await prisma.tripRequest.findUnique({
    where: { id: requestId },
    include: {
      company: {
        select: { id: true, name: true, email: true, emailNotifications: true },
      },
      carrier: {
        select: { id: true, name: true, email: true, emailNotifications: true },
      },
    },
  });
  if (!request) {
    throw new AppError("solicitud no encontrada", 404, "TRIP_REQUEST_NOT_FOUND");
  }
  if (request.carrierId !== carrierId) {
    throw new AppError(
      "no tenés permiso para responder esta solicitud",
      403,
      "FORBIDDEN"
    );
  }
  if (request.status !== "PENDING") {
    throw new AppError(
      "esta solicitud ya fue respondida",
      409,
      "TRIP_REQUEST_ALREADY_RESPONDED"
    );
  }

  let resultingTripId: string | null = null;

  if (input.accept) {
    if (!input.tripDetails) {
      throw new AppError(
        "si aceptás, tenés que completar los detalles del viaje (truckType, capacityTotal, price, etc.)",
        400,
        "MISSING_TRIP_DETAILS"
      );
    }

    // Aceptar una solicitud también publica un viaje, así que corre la misma
    // exigência que `createTrip`: sin cuenta de Mercado Pago conectada el viaje
    // no podría cobrar comisión y nadie se enteraría hasta que alguien pague.
    const carrier = await prisma.user.findUnique({
      where: { id: carrierId },
      select: { mpUserId: true },
    });
    if (!carrier) {
      throw new AppError("usuario no encontrado", 404, "USER_NOT_FOUND");
    }
    if (!carrier.mpUserId) {
      throw new AppError(
        "para aceptar un viaje debés conectar tu cuenta de Mercado Pago desde tu perfil",
        403,
        "MP_ACCOUNT_NOT_CONNECTED"
      );
    }

    // Geocodificar origen y destino (best-effort)
    const { geocode } = await import("../../lib/geocode.js");
    const [originCoords, destCoords] = await Promise.all([
      geocode(request.origin),
      geocode(request.destination),
    ]);

    const newTrip = await prisma.trip.create({
      data: {
        carrierId,
        origin: request.origin,
        destination: request.destination,
        date: request.desiredDate,
        departureTime: input.tripDetails.departureTime ?? null,
        truckType: input.tripDetails.truckType,
        capacityTotal: input.tripDetails.capacityTotal,
        price: input.tripDetails.price,
        depositPercent: input.tripDetails.depositPercent,
        features: input.tripDetails.features,
        originLat: originCoords?.lat ?? null,
        originLng: originCoords?.lng ?? null,
        destLat: destCoords?.lat ?? null,
        destLng: destCoords?.lng ?? null,
      },
    });
    resultingTripId = newTrip.id;
  }

  const updated = await prisma.tripRequest.update({
    where: { id: requestId },
    data: {
      status: input.accept ? "ACCEPTED" : "DECLINED",
      resultingTripId,
    },
    include: {
      company: {
        select: { id: true, name: true, email: true, emailNotifications: true },
      },
      carrier: { select: { id: true, name: true } },
    },
  });

  // Notificar a la company
  const { notifyUsers } = await import("../../lib/notifications.js");
  const tripLink = resultingTripId ? `/viajes/${resultingTripId}` : null;
  await notifyUsers([request.companyId], {
    type: "TRIP_REQUEST_RESPONSE",
    title: input.accept
      ? `tu solicitud fue aceptada: ${request.origin} → ${request.destination}`
      : `tu solicitud fue rechazada: ${request.origin} → ${request.destination}`,
    body: input.accept
      ? `${request.carrier.name} aceptó tu pedido y creó el viaje.`
      : `${request.carrier.name} no puede hacer ese viaje en este momento.`,
    tripId: resultingTripId,
    email: (recipient) => ({
      subject: input.accept
        ? `Solicitud aceptada: ${request.origin} → ${request.destination}`
        : `Solicitud rechazada: ${request.origin} → ${request.destination}`,
      html: `
        <p>Hola ${recipient.name},</p>
        <p>Tu solicitud de viaje <strong>${request.origin} → ${request.destination}</strong> fue
          <strong>${input.accept ? "aceptada" : "rechazada"}</strong> por <strong>${request.carrier.name}</strong>.</p>
        ${input.accept ? `<p>El viaje ya está publicado y podés sumar carga.</p>` : ""}
        ${tripLink ? `<p><a href="${process.env.APP_URL}${tripLink}">Ver el viaje</a></p>` : ""}
      `,
    }),
  });

  return { request: toTripRequestResponse(updated) };
}

/**
 * Genera la URL de autorización OAuth de Mercado Pago.
 * El transportista será redirigido a MP para autorizar el acceso.
 */
export async function getMpAuthUrl(userId: string): Promise<{ authUrl: string }> {
  const clientId = process.env.MP_CLIENT_ID;
  if (!clientId) {
    throw new AppError(
      "Mercado Pago Marketplace no está configurado: falta MP_CLIENT_ID",
      503,
      "MP_NOT_CONFIGURED"
    );
  }
  const redirectUri = `${process.env.API_PUBLIC_URL ?? "http://localhost:4000"}/api/users/me/mp-callback`;
  const scope = "read write offline_access";
  // el state identifica al transportista en el callback, que vuelve sin
  // sesión: sin esto no hay forma de saber a quién guardar el token
  const authUrl = `https://auth.mercadopago.com/authorization?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(signOAuthState(userId))}`;
  return { authUrl };
}

/**
 * Intercambia el código de autorización por access_token y user_id de MP.
 * Guarda mpAccessToken y mpUserId en el usuario.
 */
export async function exchangeMpCode(userId: string, code: string): Promise<void> {
  const clientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  const redirectUri = `${process.env.API_PUBLIC_URL ?? "http://localhost:4000"}/api/users/me/mp-callback`;

  if (!clientId || !clientSecret) {
    throw new AppError(
      "Mercado Pago Marketplace no está configurado: faltan credenciales",
      503,
      "MP_NOT_CONFIGURED"
    );
  }

  const tokenUrl = "https://api.mercadopago.com/oauth/token";
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error_description?: string };
    throw new AppError(
      `Mercado Pago OAuth error: ${err.error_description ?? res.statusText}`,
      502,
      "MP_OAUTH_TOKEN_ERROR"
    );
  }

  const data = await res.json();
  const { access_token, user_id } = data as { access_token: string; user_id: string };

  if (!access_token || !user_id) {
    throw new AppError(
      "respuesta OAuth de Mercado Pago inválida",
      502,
      "MP_OAUTH_INVALID_RESPONSE"
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      // el token nunca se guarda en claro: es una credencial que permite
      // mover plata de este transportista.
      mpAccessToken: encryptSecret(access_token),
      mpUserId: String(user_id),
    },
  });
}
