import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@prisma/client";
import { CarrierNotFoundError } from "../lib/errors.js";
import { decryptSecret } from "../lib/crypto.js";
import { signOAuthState, signToken, verifyOAuthState } from "../lib/auth.js";
import * as usersService from "../modules/users/users.service.js";
import { prisma } from "../lib/prisma.js";

vi.mock("../lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    trip: { findMany: vi.fn(), create: vi.fn() },
    tripRequest: { findUnique: vi.fn(), update: vi.fn() },
    cargoItem: { findMany: vi.fn() },
    review: { aggregate: vi.fn(), groupBy: vi.fn() },
  },
}));

// los avisos son best-effort: lo que se prueba es la regla de negocio, nunca
// que el email salga
vi.mock("../lib/notifications.js", () => ({
  notifyUsers: vi.fn().mockResolvedValue(1),
}));

type PrismaUser = Awaited<ReturnType<typeof prisma.user.findUnique>>;

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    email: "flete@truckpool.app",
    password: "hash",
    name: "Transportes Flete",
    role: "CARRIER",
    bio: null,
    phone: null,
    createdAt: new Date(),
    ...overrides,
  } as User;
}

describe("users.service", () => {
  it("updateMyProfile envia solo los campos presentes", async () => {
    vi.mocked(prisma.user.update).mockResolvedValue(baseUser());
    const result = await usersService.updateMyProfile("u1", { phone: "351-555" });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { phone: "351-555" },
    });
    expect(result.user).toMatchObject({ id: "u1", phone: null });
  });

  it("updateMyProfile normaliza bio y phone vacíos a null", async () => {
    vi.mocked(prisma.user.update).mockResolvedValue(baseUser());

    await usersService.updateMyProfile("u1", { bio: "", phone: "" });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { bio: null, phone: null },
    });
  });

  it("getCarrierProfile lanza 404 si el usuario no existe", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    } as never);

    await expect(usersService.getCarrierProfile("nope")).rejects.toThrow(
      CarrierNotFoundError
    );
  });

  it("getCarrierProfile lanza 404 si no es CARRIER", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser(),
      id: "u2",
      role: "COMPANY",
      tripsAsCarrier: [],
      reviewsReceived: [],
    } as PrismaUser & { tripsAsCarrier: unknown[]; reviewsReceived: unknown[] });
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    } as never);

    await expect(usersService.getCarrierProfile("u2")).rejects.toThrow(
      CarrierNotFoundError
    );
  });

  it("getCarrierProfile filtra viajes OPEN y devuelve el perfil", async () => {
    const trips = [
      {
        id: "t1",
        origin: "Córdoba",
        destination: "Rosario",
        date: new Date(),
        truckType: "Semi",
        capacityTotal: 30,
        price: 1500,
        status: "OPEN",
        createdAt: new Date(),
        carrierId: "u1",
        cargoItems: [],
      },
    ];
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser({ bio: "fletero", phone: "351-555" }),
      tripsAsCarrier: trips,
      reviewsReceived: [],
    } as PrismaUser & { tripsAsCarrier: unknown[]; reviewsReceived: unknown[] });
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    } as never);

    const profile = await usersService.getCarrierProfile("u1");
    expect(profile).toMatchObject({
      id: "u1",
      name: "Transportes Flete",
      bio: "fletero",
      phone: "351-555",
    });
    expect(profile.trips).toHaveLength(1);
    expect(profile.trips[0]).toMatchObject({ id: "t1", capacityUsed: 0 });
  });

  it("listMyTrips filtra por carrierId", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValue([]);
    await usersService.listMyTrips("u1");

    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ carrierId: "u1" }),
        orderBy: { date: "desc" },
      })
    );
  });

  it("getCarrierProfile pide sólo viajes abiertos y de fecha futura", async () => {
    // esta vista es donde una empresa busca viaje para sumarle carga, así que
    // comparte el corte del listado público.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser(),
      tripsAsCarrier: [],
      reviewsReceived: [],
    } as PrismaUser & { tripsAsCarrier: unknown[]; reviewsReceived: unknown[] });
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    } as never);

    await usersService.getCarrierProfile("u1");

    const include = vi.mocked(prisma.user.findUnique).mock.calls[0]?.[0]?.include as {
      tripsAsCarrier: { where: unknown };
    };
    expect(include.tripsAsCarrier.where).toEqual({
      status: "OPEN",
      date: { gt: expect.any(Date) },
    });
  });

  it("listMyTrips no filtra por fecha: el historial del transportista se mantiene", async () => {
    const pasado = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.trip.findMany).mockResolvedValue([
      {
        id: "t-pasado",
        origin: "Córdoba",
        destination: "Rosario",
        date: pasado,
        truckType: "Semi",
        capacityTotal: 30,
        price: 1500,
        status: "OPEN",
        createdAt: new Date(),
        carrierId: "u1",
        cargoItems: [],
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.trip.findMany>>);

    const trips = await usersService.listMyTrips("u1");

    // sigue apareciendo aunque su fecha ya haya pasado y el estado sea OPEN:
    // dejó de estar disponible, no desapareció.
    expect(trips).toHaveLength(1);
    expect(trips.map((trip) => [trip.id, trip.status, trip.acceptsCargo])).toEqual([
      ["t-pasado", "OPEN", false],
    ]);
  });

  it("listMyCargoItems incluye los datos básicos del viaje", async () => {
    vi.mocked(prisma.cargoItem.findMany).mockResolvedValue([
      {
        id: "i1",
        description: "cajas",
        volume: 10,
        priceShare: 500,
        status: "PENDING",
        createdAt: new Date(),
        tripId: "t1",
        companyId: "u2",
        trip: {
          id: "t1",
          origin: "Córdoba",
          destination: "Rosario",
          date: new Date(),
          status: "OPEN",
        },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.cargoItem.findMany>>);

    const items = await usersService.listMyCargoItems("u2");
    expect(prisma.cargoItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "u2" }),
        include: expect.objectContaining({
          payments: true,
          trip: expect.objectContaining({ select: expect.anything() }),
        }),
      })
    );
    expect(items[0]).toMatchObject({
      id: "i1",
      priceShare: 500,
      trip: { origin: "Córdoba", status: "OPEN" },
    });
  });

  it("listMyCargoItems no filtra por la fecha del viaje: la carga sigue visible", async () => {
    vi.mocked(prisma.cargoItem.findMany).mockResolvedValue([
      {
        id: "i1",
        description: "cajas",
        volume: 10,
        priceShare: 500,
        status: "PENDING",
        createdAt: new Date(),
        tripId: "t1",
        companyId: "u2",
        trip: {
          id: "t1",
          origin: "Córdoba",
          destination: "Rosario",
          date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          status: "OPEN",
        },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.cargoItem.findMany>>);

    const items = await usersService.listMyCargoItems("u2");

    // el viaje ya no acepta cargas, pero la carga que la empresa tiene ahí
    // sigue en su historial, con el estado real del viaje.
    expect(items).toHaveLength(1);
    expect(items.map((item) => item.trip)).toMatchObject([{ id: "t1", status: "OPEN" }]);
    expect(
      vi.mocked(prisma.cargoItem.findMany).mock.calls[0]?.[0]?.where
    ).toEqual({ companyId: "u2" });
  });
});

describe("calificaciones de fleteros", () => {
  beforeEach(() => {
    vi.mocked(prisma.review.groupBy).mockReset();
    vi.mocked(prisma.review.aggregate).mockReset();
  });

  it("listCarriers calcula el promedio y el cantidad por fletero", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "u1",
        name: "Transportes Flete",
        bio: null,
        _count: { tripsAsCarrier: 2 },
      },
      {
        id: "u2",
        name: "Sin historial",
        bio: null,
        _count: { tripsAsCarrier: 0 },
      },
    ] as never);
    vi.mocked(prisma.review.groupBy).mockResolvedValue([
      { toUserId: "u1", _avg: { rating: 4.5 }, _count: { _all: 2 } },
    ] as never);

    const carriers = await usersService.listCarriers();

    expect(carriers[0]).toMatchObject({
      id: "u1",
      openTrips: 2,
      ratingAvg: 4.5,
      ratingCount: 2,
    });
    expect(carriers[1]).toMatchObject({
      id: "u2",
      ratingAvg: null,
      ratingCount: 0,
    });
  });

  it("getCarrierProfile redondea el promedio y trae los comentarios recientes", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser(),
      tripsAsCarrier: [],
      reviewsReceived: [
        {
          id: "r1",
          rating: 5,
          comment: "cargó y descargó sin dramas",
          createdAt: new Date("2026-09-20T10:00:00Z"),
          fromUser: { name: "Comercial Norte" },
          trip: { id: "t1", origin: "Rosario", destination: "Córdoba" },
        },
      ],
    } as PrismaUser & { tripsAsCarrier: unknown[]; reviewsReceived: unknown[] });
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: 4.333 },
      _count: { _all: 3 },
    } as never);

    const profile = await usersService.getCarrierProfile("u1");

    expect(profile.ratingAvg).toBe(4.33);
    expect(profile.ratingCount).toBe(3);
    expect(profile.reviews[0]).toMatchObject({
      rating: 5,
      comment: "cargó y descargó sin dramas",
      fromName: "Comercial Norte",
      trip: { origin: "Rosario", destination: "Córdoba" },
    });
  });

  it("getCarrierProfile devuelve ratingAvg null cuando no hay reseñas", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser(),
      tripsAsCarrier: [],
      reviewsReceived: [],
    } as PrismaUser & { tripsAsCarrier: unknown[]; reviewsReceived: unknown[] });
    vi.mocked(prisma.review.aggregate).mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    } as never);

    const profile = await usersService.getCarrierProfile("u1");
    expect(profile.ratingAvg).toBeNull();
    expect(profile.ratingCount).toBe(0);
    expect(profile.reviews).toEqual([]);
  });
});

describe("verificación de identidad", () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.user.update).mockReset();
    vi.mocked(prisma.user.findMany).mockReset();
  });

  it("requestVerification guarda el taxId y pasa a PENDING", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      baseUser({ verificationStatus: "UNVERIFIED" })
    );
    vi.mocked(prisma.user.update).mockResolvedValue(
      baseUser({
        taxId: "20345678901",
        verificationStatus: "PENDING",
        verificationNote: null,
      })
    );

    const result = await usersService.requestVerification("u1", { taxId: "20345678901" });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        taxId: "20345678901",
        verificationStatus: "PENDING",
        verificationNote: null,
      },
    });
    expect(result.user).toMatchObject({
      verificationStatus: "PENDING",
      taxId: "20345678901",
    });
  });

  it("requestVerification da 409 si ya está VERIFIED", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      baseUser({ verificationStatus: "VERIFIED" })
    );

    await expect(
      usersService.requestVerification("u1", { taxId: "20345678901" })
    ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_VERIFIED" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("reenviar limpia la nota del rechazo anterior", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      baseUser({ verificationStatus: "REJECTED" })
    );
    vi.mocked(prisma.user.update).mockResolvedValue(
      baseUser({ verificationStatus: "PENDING" })
    );

    await usersService.requestVerification("u1", { taxId: "20345678901" });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ verificationNote: null }),
      })
    );
  });

  it("listPendingVerifications devuelve solo los PENDING con taxId", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "u5",
        name: "Transporte Sur",
        email: "sur@truckpool.app",
        taxId: "20345678902",
        createdAt: new Date("2026-09-26T10:00:00.000Z"),
      },
    ] as never);

    const list = await usersService.listPendingVerifications();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { verificationStatus: "PENDING" } })
    );
    expect(list[0]).toMatchObject({
      id: "u5",
      name: "Transporte Sur",
      taxId: "20345678902",
    });
  });

  it("reviewVerification aprueba y deja VERIFIED sin nota", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      baseUser({ verificationStatus: "PENDING" })
    );
    vi.mocked(prisma.user.update).mockResolvedValue(
      baseUser({ verificationStatus: "VERIFIED", verificationNote: null })
    );

    const result = await usersService.reviewVerification("u1", { approve: true });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { verificationStatus: "VERIFIED", verificationNote: null },
    });
    expect(result.user).toMatchObject({ verificationStatus: "VERIFIED" });
  });

  it("reviewVerification rechaza guardando la nota", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      baseUser({ verificationStatus: "PENDING" })
    );
    vi.mocked(prisma.user.update).mockResolvedValue(
      baseUser({
        verificationStatus: "REJECTED",
        verificationNote: "el CUIT no coincide con el titular",
      })
    );

    const result = await usersService.reviewVerification("u1", {
      approve: false,
      note: "el CUIT no coincide con el titular",
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        verificationStatus: "REJECTED",
        verificationNote: "el CUIT no coincide con el titular",
      },
    });
    expect(result.user).toMatchObject({
      verificationStatus: "REJECTED",
      verificationNote: "el CUIT no coincide con el titular",
    });
  });

  it("rechazar sin nota da 400 y no toca la base", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      baseUser({ verificationStatus: "PENDING" })
    );

    await expect(
      usersService.reviewVerification("u1", { approve: false })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "VERIFICATION_NOTE_REQUIRED",
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("revisar algo que no está PENDING da 409", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      baseUser({ verificationStatus: "VERIFIED" })
    );

    await expect(
      usersService.reviewVerification("u1", { approve: true })
    ).rejects.toMatchObject({ statusCode: 409, code: "VERIFICATION_NOT_PENDING" });
  });
});

describe("responder una solicitud de viaje directo", () => {
  const tripDetails = {
    truckType: "CAMION",
    capacityTotal: 30,
    price: 250000,
    depositPercent: 20,
    features: [],
  };

  function baseRequest(overrides: Record<string, unknown> = {}) {
    return {
      id: "r1",
      status: "PENDING",
      carrierId: "u1",
      companyId: "c1",
      origin: "Córdoba",
      destination: "Rosario",
      desiredDate: new Date("2026-10-01"),
      createdAt: new Date("2026-09-01"),
      estimatedVolume: null,
      note: null,
      resultingTripId: null,
      company: { id: "c1", name: "Acero SA", email: "acero@truckpool.app" },
      carrier: { id: "u1", name: "Transportes Flete", email: "flete@truckpool.app" },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Aceptar una solicitud publica un viaje, así que tiene la misma exigencia
  // que crear uno: sin cuenta de MP el pago no podría cobrar comisión y el
  // error tiene que salir acá, no en el checkout.
  it("no acepta si el transportista no tiene cuenta de MP conectada", async () => {
    vi.mocked(prisma.tripRequest.findUnique).mockResolvedValue(baseRequest() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      mpUserId: null,
    } as never);

    await expect(
      usersService.respondTripRequest("r1", "u1", { accept: true, tripDetails })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "MP_ACCOUNT_NOT_CONNECTED",
    });

    expect(prisma.trip.create).not.toHaveBeenCalled();
    expect(prisma.tripRequest.update).not.toHaveBeenCalled();
  });

  it("acepta y publica el viaje si la cuenta de MP está conectada", async () => {
    vi.mocked(prisma.tripRequest.findUnique).mockResolvedValue(baseRequest() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      mpUserId: "mp-user-123",
    } as never);
    vi.mocked(prisma.trip.create).mockResolvedValue({ id: "t9" } as never);
    vi.mocked(prisma.tripRequest.update).mockResolvedValue(
      baseRequest({ status: "ACCEPTED", resultingTripId: "t9" }) as never
    );

    const result = await usersService.respondTripRequest("r1", "u1", {
      accept: true,
      tripDetails,
    });

    expect(prisma.trip.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ carrierId: "u1", origin: "Córdoba" }),
      })
    );
    expect(result.request.status).toBe("ACCEPTED");
    expect(result.request.resultingTripId).toBe("t9");
  });

  it("rechazar no exige cuenta de MP", async () => {
    vi.mocked(prisma.tripRequest.findUnique).mockResolvedValue(baseRequest() as never);
    vi.mocked(prisma.tripRequest.update).mockResolvedValue(
      baseRequest({ status: "DECLINED", resultingTripId: null }) as never
    );

    const result = await usersService.respondTripRequest("r1", "u1", { accept: false });

    expect(prisma.trip.create).not.toHaveBeenCalled();
    expect(result.request.status).toBe("DECLINED");
  });
});

describe("OAuth de Mercado Pago", () => {
  const TOKEN = "APP_USR-access-token-de-tercero";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MP_CLIENT_ID = "client-id";
    process.env.MP_CLIENT_SECRET = "client-secret";
    process.env.API_PUBLIC_URL = "https://api.truckpool.app";
  });

  it("guarda el access token cifrado, nunca en claro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: TOKEN, user_id: 987654321 }),
      })
    );
    vi.mocked(prisma.user.update).mockResolvedValue(baseUser() as never);

    await usersService.exchangeMpCode("u1", "code-de-autorizacion");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        mpAccessToken: expect.stringContaining("v1:"),
        mpUserId: "987654321",
      },
    });
    // el token de Mercado Pago no puede quedar escribible en la base
    const written = vi.mocked(prisma.user.update).mock.calls[0]?.[0] as {
      data: { mpAccessToken: string };
    };
    expect(written.data.mpAccessToken).not.toBe(TOKEN);
    expect(written.data.mpAccessToken).not.toContain(TOKEN);
    expect(decryptSecret(written.data.mpAccessToken)).toBe(TOKEN);

    vi.unstubAllGlobals();
  });

  it("no guarda nada si Mercado Pago no devuelve token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user_id: 1 }) })
    );

    await expect(usersService.exchangeMpCode("u1", "code")).rejects.toMatchObject({
      code: "MP_OAUTH_INVALID_RESPONSE",
    });
    expect(prisma.user.update).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("state de OAuth", () => {
  it("la URL de autorización viaja con un state que devuelve el mismo userId", async () => {
    process.env.MP_CLIENT_ID = "client-id";
    process.env.API_PUBLIC_URL = "https://api.truckpool.app";

    const { authUrl } = await usersService.getMpAuthUrl("u1");
    const state = new URL(authUrl).searchParams.get("state");

    // sin este state el callback no tiene forma de saber a quién es el token:
    // vuelve sin sesión
    expect(state).toBeTruthy();
    expect(verifyOAuthState(state!)).toBe("u1");
    expect(new URL(authUrl).searchParams.get("redirect_uri")).toBe(
      "https://api.truckpool.app/api/users/me/mp-callback"
    );
  });

  it("rechaza un state que no emitimos", () => {
    expect(() => verifyOAuthState("state-falsificado")).toThrow(
      expect.objectContaining({ code: "MP_OAUTH_INVALID_STATE" })
    );
  });

  it("rechaza un token de sesión usado como state", () => {
    // el state se valida con la misma firma que la sesión, así que hay que
    // dejar explícito que el propósito no deja pasar un JWT de usuario
    const sessionLike = signToken({ id: "u1", role: "CARRIER" });
    expect(() => verifyOAuthState(sessionLike)).toThrow(
      expect.objectContaining({ code: "MP_OAUTH_INVALID_STATE" })
    );
  });

  it("el state expira a los 10 minutos", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    const state = signOAuthState("u1");

    vi.setSystemTime(new Date("2026-09-27T12:09:59Z"));
    expect(verifyOAuthState(state)).toBe("u1");

    vi.setSystemTime(new Date("2026-09-27T12:10:01Z"));
    expect(() => verifyOAuthState(state)).toThrow(
      expect.objectContaining({ code: "MP_OAUTH_INVALID_STATE" })
    );
    vi.useRealTimers();
  });
});
