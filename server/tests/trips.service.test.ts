import { encryptSecret } from "../lib/crypto.js";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import * as tripsService from "../modules/trips/trips.service.js";
import { processRefundRequest } from "../modules/payments/refunds.service.js";
import { createCheckoutPreference } from "../lib/mercadopago.js";
import { fetchRouteGeometry } from "../lib/routing.js";
import {
  CargoItemNotCancellableError,
  CargoItemNotFoundError,
  InvalidTransitionError,
  NotEnoughCapacityError,
  TripAlreadyStartedError,
  TripDatePassedError,
  TripNotFoundError,
  TripNotInTransitError,
  TripNotOpenError,
} from "../lib/errors.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { geocode } from "../lib/geocode.js";
import { notifyUsers } from "../lib/notifications.js";
import { refundPayment } from "../lib/mercadopago.js";
import { salidaEn } from "./helpers/salida.js";
import { cargoPrice } from "../lib/pricing.js";
import { CARRIER_CAN_CHARGE } from "../lib/mappers.js";
import { TRACKING_CODE_PATTERN } from "../lib/trackingCode.js";

// Los avisos son best-effort: en los tests de trips lo que importa es a Quién
// se avisa y con qué tipo/title, nunca que el email salga. Por eso el módulo de
// notificaciones va mockeado entero.
// los tests no pegan a Nominatim: el geocode va mockeado siempre
vi.mock("../lib/geocode.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/geocode.js")>();
  return { ...actual, geocode: vi.fn().mockResolvedValue(null) };
});

// los tests no pegan a OSRM: fetchRouteGeometry va mockeado
vi.mock("../lib/routing.js", () => ({
  fetchRouteGeometry: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/notifications.js", () => ({
  notifyUsers: vi.fn().mockResolvedValue(1),
}));

// los pagos de las pruebas no van a Mercado Pago: el reembolso va mockeado
vi.mock("../lib/mercadopago.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mercadopago.js")>();
  return {
    ...actual,
    refundPayment: vi.fn().mockResolvedValue(0),
    createCheckoutPreference: vi.fn().mockResolvedValue({
      preferenceId: "pref-1",
      initPoint: "https://mp.com/init",
      platformFeeAmount: 150,
      carrierAmount: 1350,
    }),
  };
});

vi.mock("../lib/prisma", () => ({
  prisma: {
    trip: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    cargoItem: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    refundRequest: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    review: { findUnique: vi.fn(), create: vi.fn() },
    message: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    tripLocation: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const tx = {
  trip: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  cargoItem: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    // reservas sin seña de la empresa (tope de U15): ninguna por defecto
    findMany: vi.fn().mockResolvedValue([]),
  },
  payment: {
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn(),
    upsert: vi.fn(),
  },
  refundRequest: {
    create: vi.fn().mockResolvedValue({}),
  },
  user: {
    findUnique: vi.fn(),
  },
};

type Mock = ReturnType<typeof vi.fn>;

/**
 * Sin reservas vencidas por defecto. CargoItem.findMany lo usan dos consultas
 * distintas (vencimiento y avisos de estado) y los tests mockean la que les
 * importa; este default evita que una implementación de un test anterior se
 * filtre al siguiente.
 */
beforeEach(() => {
  (prisma.cargoItem.findMany as unknown as Mock).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks(); // limpiar spies (p.ej. hoursUntilTrip) entre tests
});

/**
 * Fecha de un viaje que todavía está disponible. El default de `baseTrip`
 * tiene que caer en un día posterior al de hoy: un viaje con la fecha de hoy
 * ya no acepta carga, y los tests que prueban el resto del flujo necesitan un
 * viaje disponible.
 */
function futureTripDate(daysAhead = 3) {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
}

/**
 * "Hoy" fijo para los tests de disponibilidad: 09:00 del 30/09 en Argentina
 * (UTC-3). El último instante de ese día local es el 30/09 23:59:59.999 AR,
 * que en UTC es el 01/10 02:59:59.999Z.
 */
const AHORA = new Date("2026-09-30T12:00:00.000Z");
const CORTE_ARGENTINA = new Date("2026-10-01T02:59:59.999Z");

function baseTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    origin: "A",
    destination: "B",
    date: futureTripDate(),
    truckType: "Semi",
    capacityTotal: 30,
    price: new Prisma.Decimal("1500.00"),
    depositPercent: 20,
    status: "OPEN",
    createdAt: new Date(),
    carrierId: "u1",
    features: [],
    cargoItems: [],
    originLat: null,
    originLng: null,
    destLat: null,
    destLng: null,
    // por defecto el fletero tiene MP conectado: puede cobrar la seña
    carrier: {
      id: "u1",
      isAvailableForRequests: true,
      mpUserId: "mp-u1",
      mpAccessToken: "token-cifrado",
    },
    ...overrides,
  };
}

function baseCargoItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    tripId: "t1",
    companyId: "c1",
    description: "Maquinaria",
    volume: 10,
    priceShare: new Prisma.Decimal("500.00"),
    depositAmount: new Prisma.Decimal("100.00"),
    status: "PENDING",
    createdAt: new Date(),
    cancelledAt: null,
    cancellationFeeAmount: null,
    pickupAddress: "Córdoba, Córdoba",
    pickupLat: null,
    pickupLng: null,
    trackingCode: "TP-T1-C1",
    stopOrder: null,
    ...overrides,
  };
}

/** una carga con su pago de seña ya acreditado */
function basePaidCargoItem(overrides: Record<string, unknown> = {}) {
  return baseCargoItem({
    payments: [
      {
        id: "p1",
        cargoItemId: "i1",
        amount: new Prisma.Decimal("100.00"),
        status: "APPROVED",
        type: "DEPOSIT",
        refundedAmount: null,
        mpPreferenceId: "pref1",
        mpPaymentId: "mp1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    ...overrides,
  });
}

function basePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay1",
    cargoItemId: "i1",
    amount: new Prisma.Decimal("500.00"),
    status: "APPROVED",
    type: "DEPOSIT",
    refundedAmount: null,
    mpPreferenceId: "pref-1",
    mpPaymentId: "mp-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("listOpenTrips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.trip.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    // por defecto el transportista está verificado y puede publicar; cada
    // test que prueba el bloqueo lo sobreescribe.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      verificationStatus: "VERIFIED",
    } as never);
  });

  it("sin filtros devuelve los viajes OPEN de fecha futura", async () => {
    await tripsService.listOpenTrips({}, AHORA);

    expect(prisma.trip.findMany).toHaveBeenCalledWith({
      where: { status: "OPEN", carrier: CARRIER_CAN_CHARGE, date: { gt: CORTE_ARGENTINA } },
      include: { cargoItems: true, carrier: { select: { name: true } } },
      orderBy: { date: "asc" },
    });
  });

  it("no lista viajes de fleteros sin Mercado Pago conectado", async () => {
    await tripsService.listOpenTrips({}, AHORA);

    const where = vi.mocked(prisma.trip.findMany).mock.calls[0]?.[0]?.where;
    expect(where?.carrier).toEqual({
      mpUserId: { not: null },
      mpAccessToken: { not: null },
    });
  });

  it("filtra por origin con contains e insensible", async () => {
    await tripsService.listOpenTrips({ origin: "ros" }, AHORA);

    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "OPEN",
          carrier: CARRIER_CAN_CHARGE,
          origin: { contains: "ros", mode: "insensitive" },
          date: { gt: CORTE_ARGENTINA },
        },
      })
    );
  });

  it("combina origin y features con AND", async () => {
    await tripsService.listOpenTrips(
      { origin: "Córdoba", features: ["seguro", "expreso"] },
      AHORA
    );

    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "OPEN",
          carrier: CARRIER_CAN_CHARGE,
          origin: { contains: "Córdoba", mode: "insensitive" },
          features: { hasEvery: ["seguro", "expreso"] },
          date: { gt: CORTE_ARGENTINA },
        },
      })
    );
  });

  // el día de los filtros es el día argentino, como el de los viajes: desde las
  // 00:00 ART del primero hasta el último milisegundo ART del último
  it("traduce dateFrom/dateTo a días completos en Argentina y conserva el corte", async () => {
    await tripsService.listOpenTrips(
      {
        // como llegan del schema: el mediodía ART de cada día
        dateFrom: new Date("2026-10-01T15:00:00.000Z"),
        dateTo: new Date("2026-10-31T15:00:00.000Z"),
      },
      AHORA
    );

    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "OPEN",
          carrier: CARRIER_CAN_CHARGE,
          date: {
            gt: CORTE_ARGENTINA,
            gte: new Date("2026-10-01T03:00:00.000Z"),
            lte: new Date("2026-11-01T02:59:59.999Z"),
          },
        },
      })
    );
  });

  it("ignora un array de features vacío", async () => {
    await tripsService.listOpenTrips({ destination: "Rosario", features: [] }, AHORA);

    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "OPEN",
          carrier: CARRIER_CAN_CHARGE,
          destination: { contains: "Rosario", mode: "insensitive" },
          date: { gt: CORTE_ARGENTINA },
        },
      })
    );
  });

  it("devuelve solo los viajes que matchean según el where armado", async () => {
    const rows = [
      baseTrip({ id: "t-ros", origin: "Rosario", carrier: { name: "Flete" } }),
      baseTrip({ id: "t-mdz", origin: "Mendoza", carrier: { name: "Flete" } }),
    ];
    (prisma.trip.findMany as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }: { where: { origin?: { contains: string; mode: string } } }) => {
        const needle = where.origin?.contains?.toLowerCase();
        return Promise.resolve(
          needle ? rows.filter((row) => row.origin.toLowerCase().includes(needle)) : rows
        );
      }
    );

    const result = await tripsService.listOpenTrips({ origin: "ROSAR" }, AHORA);

    expect(result.map((trip) => trip.id)).toEqual(["t-ros"]);
  });

  describe("disponibilidad por fecha", () => {
    // El viaje se guarda con la hora con la que lo manda el cliente: 12:00 AR
    // para "hoy", o sea ~15:00Z.
    const filas = [
      baseTrip({ id: "t-manana", date: new Date("2026-10-01T15:00:00.000Z") }),
      baseTrip({ id: "t-hoy", date: new Date("2026-09-30T15:00:00.000Z") }),
      baseTrip({ id: "t-ayer", date: new Date("2026-09-29T15:00:00.000Z") }),
    ];

    beforeEach(() => {
      // el mock aplica el mismo filtro que hace la base, para que el test
      // compruebe de punta a punta qué viajes entran.
      (prisma.trip.findMany as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        ({ where }: { where: { date?: { gt?: Date } } }) =>
          Promise.resolve(filas.filter((row) => row.date > where.date!.gt!))
      );
    });

    it("deja fuera el viaje de hoy y el de ayer, y deja el de mañana", async () => {
      const result = await tripsService.listOpenTrips({}, AHORA);

      expect(result.map((trip) => trip.id)).toEqual(["t-manana"]);
    });

    it("no toca Trip.status: el viaje de hoy sigue OPEN, sólo deja de estar disponible", async () => {
      const result = await tripsService.listOpenTrips({}, AHORA);

      expect(filas.find((t) => t.id === "t-hoy")?.status).toBe("OPEN");
      expect(result.some((t) => t.id === "t-hoy")).toBe(false);
    });

    it("el viaje disponible llega con acceptsCargo", async () => {
      // acceptsCargo lo calcula el mapper con el reloj del sistema, no con el
      // `ahora` que recibe listOpenTrips: se congela en AHORA para que el
      // fixture no dependa del día en que corre el test.
      freezeClockAt(AHORA.toISOString());
      try {
        const result = await tripsService.listOpenTrips({}, AHORA);

        expect(result.map((trip) => trip.acceptsCargo)).toEqual([true]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

/**
 * El aviso que se le mandó a un usuario: con la email() a mano para poder
 *Assertar sobre el contenido del email sin mandarlo.
 */
function avisoA(userId: string) {
  const call = vi.mocked(notifyUsers).mock.calls.find(([ids]) => ids.includes(userId));
  if (!call) throw new Error(`no se avisó a ${userId}`);
  const [, data] = call;
  return {
    ...data,
    email: data.email
      ? data.email({ name: "Destinatario", email: "d@e.com" })
      : undefined,
  };
}

function baseCarrier(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "Transportes Flete",
    email: "flete@truckpool.app",
    emailNotifications: true,
    isAvailableNow: true,
    mpUserId: "mp-user-123",
    mpAccessToken: "access-token-123",
    ...overrides,
  };
}

function paidDeposit(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay1",
    cargoItemId: "i1",
    amount: new Prisma.Decimal("100.00"),
    status: "APPROVED",
    type: "DEPOSIT",
    refundedAmount: null,
    mpPreferenceId: "pref-1",
    mpPaymentId: "mp-77",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** fecha del viaje a X horas de ahora, para caer en la ventana de cancelacion */
function tripDateIn(hours: number) {
  return new Date(Date.now() + hours * 3_600_000);
}

/** Congela solo Date (no los timers) para que los bordes de hora sean exactos. */
function freezeClockAt(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

describe("cancelCargoItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
    );
    tx.cargoItem.findUnique.mockResolvedValue(
      baseCargoItem({ payments: [], company: { name: "Acero SA" } })
    );
    tx.cargoItem.update.mockImplementation(({ data }: { data: unknown }) => data);
    tx.payment.update.mockResolvedValue({});
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ carrier: baseCarrier(), date: tripDateIn(72) })
    );
    vi.mocked(refundPayment).mockResolvedValue(0);
  });

  it("retira una carga PENDING de la empresa y la marca CANCELLED sin borrarla", async () => {
    const result = await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(tx.cargoItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i1" },
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelledAt: expect.any(Date),
        }),
      })
    );
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(avisoA("u1").type).toBe("CARGO_CANCELLED");
    expect(result.status).toBe("CANCELLED");
    // el registro se conserva: es historial, no se borra
    expect(tx.cargoItem.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: "i1" }) })
    );
  });

  it("deja asentado que no se cobró nada de una carga sin pagar", async () => {
    await tripsService.cancelCargoItem("t1", "i1", "c1");

    // sin plata cobrada no hay fee: el fee es lo que la plataforma se queda, y
    // no se puede quedar nada de un pago que nunca entró.
    expect(tx.cargoItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancellationFeeAmount: new Prisma.Decimal(0),
        }),
      })
    );
  });

  it("no deja retirar dos veces la misma carga", async () => {
    tx.cargoItem.findUnique.mockResolvedValue(
      baseCargoItem({ status: "CANCELLED", payments: [], company: { name: "Acero SA" } })
    );

    await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toBeInstanceOf(
      CargoItemNotCancellableError
    );
    expect(tx.cargoItem.update).not.toHaveBeenCalled();
  });

  it("no deja retirar carga de un viaje que ya arrancó", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ status: "IN_TRANSIT", date: tripDateIn(72) })
    );

    await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toBeInstanceOf(
      TripAlreadyStartedError
    );
    expect(tx.cargoItem.update).not.toHaveBeenCalled();
  });

  it("no deja retirar carga de un viaje terminado", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ status: "COMPLETED", date: tripDateIn(72) })
    );

    await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toBeInstanceOf(
      TripAlreadyStartedError
    );
  });

  it("no deja retirar la carga de otra empresa", async () => {
    await expect(tripsService.cancelCargoItem("t1", "i1", "otra-empresa")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(tx.cargoItem.update).not.toHaveBeenCalled();
  });

  it("da 404 si la carga no existe o es de otro viaje", async () => {
    tx.cargoItem.findUnique.mockResolvedValue(null);
    await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toBeInstanceOf(
      CargoItemNotFoundError
    );

    tx.cargoItem.findUnique.mockResolvedValue(
      baseCargoItem({
        tripId: "otro-viaje",
        payments: [],
        company: { name: "Acero SA" },
      })
    );
    await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toBeInstanceOf(
      CargoItemNotFoundError
    );
  });

  it("abre el viaje FULL cuando la carga retirada era la que lo llenaba", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({
        status: "FULL",
        date: tripDateIn(72),
        capacityTotal: 30,
        cargoItems: [
          { id: "i1", volume: 10, status: "PENDING" },
          { id: "i2", volume: 20, status: "CONFIRMED" },
        ],
      })
    );

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(tx.trip.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "OPEN" },
    });
  });

  it("ignora las cargas ya retiradas al recalcular la capacidad", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({
        status: "FULL",
        date: tripDateIn(72),
        capacityTotal: 30,
        cargoItems: [
          { id: "i1", volume: 10, status: "PENDING" },
          { id: "i2", volume: 20, status: "CONFIRMED" },
          { id: "i3", volume: 8, status: "CANCELLED" },
        ],
      })
    );

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(tx.trip.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "OPEN" },
    });
  });

  it("no toca el estado de un viaje OPEN", async () => {
    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(tx.trip.update).not.toHaveBeenCalled();
  });
});

describe("cancelCargoItem con seña pagada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
    );
    tx.cargoItem.findUnique.mockResolvedValue(
      basePaidCargoItem({ payments: [paidDeposit()], company: { name: "Acero SA" } })
    );
    tx.cargoItem.update.mockImplementation(({ data }: { data: unknown }) => data);
    tx.payment.update.mockResolvedValue({});
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.refundRequest = { create: vi.fn().mockResolvedValue({}) };
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({
        carrier: baseCarrier(),
        origin: "Córdoba",
        destination: "Rosario",
        date: tripDateIn(72),
        capacityTotal: 30,
        cargoItems: [
          { id: "i1", volume: 10, status: "PENDING" },
          { id: "i2", volume: 5, status: "CONFIRMED" },
        ],
      })
    );
    // refundPayment NO se llama en la TX (outbox); el processor lo hace después
    vi.mocked(refundPayment).mockResolvedValue(100);
  });

  it("seña ya devuelta desde el panel de MP (REFUNDED): retira sin encolar otra devolución ni llamar a MP", async () => {
    // carrera con el webhook: MP ya pasó la seña a REFUNDED y la empresa retira
    // antes de que el webhook alcance a retirar la carga
    tx.cargoItem.findUnique.mockResolvedValue(
      basePaidCargoItem({
        payments: [paidDeposit({ status: "REFUNDED" })],
        company: { name: "Acero SA" },
      })
    );

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(tx.refundRequest.create).not.toHaveBeenCalled();
    expect(refundPayment).not.toHaveBeenCalled();
    expect(tx.cargoItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELLED",
          cancellationFeeAmount: new Prisma.Decimal(0),
        }),
      })
    );
  });

  it("más de 48hs: crea RefundRequest PENDING con monto total (outbox)", async () => {
    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(refundPayment).not.toHaveBeenCalled(); // outbox: processor lo hace después
    expect(tx.payment.update).not.toHaveBeenCalled(); // outbox: processor lo hace después
    expect(tx.refundRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cargoItemId: "i1",
        targetAmount: new Prisma.Decimal("100.00"),
        status: "PENDING",
      }),
    });
    expect(tx.cargoItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cancellationFeeAmount: new Prisma.Decimal(0) }),
      })
    );
  });

  it("entre 24 y 48hs: crea RefundRequest PENDING con la mitad (outbox)", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ carrier: baseCarrier(), ...salidaEn(36) })
    );
    vi.mocked(refundPayment).mockResolvedValue(50);

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(refundPayment).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.refundRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cargoItemId: "i1",
        targetAmount: new Prisma.Decimal("50.00"),
        status: "PENDING",
      }),
    });
    expect(tx.cargoItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cancellationFeeAmount: new Prisma.Decimal(50) }),
      })
    );
  });

  it("menos de 24hs: no devuelve nada y la seña queda como costo", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ carrier: baseCarrier(), ...salidaEn(10) })
    );

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(refundPayment).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.cargoItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cancellationFeeAmount: new Prisma.Decimal(100) }),
      })
    );
  });

  // Los dos bordes de la ventana (48h y 24h) se prueban con el reloj fijo:
  // con Date.now() real, el milisegundo que pasa entre armar el fixture y leer la
  // hora en el service deja 23.9999 horas y el test depende de cuándo corrió.
  it("justo en 48hs aplica la mitad, no el total (outbox)", async () => {
    freezeClockAt("2026-10-01T12:00:00.000Z");
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ carrier: baseCarrier(), ...salidaEn(48) })
    );
    vi.mocked(refundPayment).mockResolvedValue(50);

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(refundPayment).not.toHaveBeenCalled();
    expect(tx.refundRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cargoItemId: "i1",
        targetAmount: new Prisma.Decimal("50.00"),
        status: "PENDING",
      }),
    });
    vi.useRealTimers();
  });

  it("justo en 24hs todavía devuelve la mitad (outbox)", async () => {
    freezeClockAt("2026-10-01T12:00:00.000Z");
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ carrier: baseCarrier(), ...salidaEn(24) })
    );
    vi.mocked(refundPayment).mockResolvedValue(50)

    await tripsService.cancelCargoItem("t1", "i1", "c1")

    expect(refundPayment).not.toHaveBeenCalled()
    expect(tx.refundRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cargoItemId: "i1",
        targetAmount: new Prisma.Decimal("50.00"),
        status: "PENDING",
      }),
    })
    vi.useRealTimers();
  });

  it("avisa al transportista y crea RefundRequest PENDING (outbox)", async () => {
    // Verificar solo que se crea la RefundRequest y se avisa al carrier
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({
        carrier: baseCarrier(),
        origin: "Córdoba",
        destination: "Rosario",
        date: tripDateIn(72),
        capacityTotal: 30,
        cargoItems: [
          { id: "i1", volume: 10, status: "PENDING" },
          { id: "i2", volume: 5, status: "CONFIRMED" },
        ],
      })
    );

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    // OUTBOX: se crea RefundRequest PENDING (el test de arriba ya verifica el monto)
    expect(tx.refundRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cargoItemId: "i1",
          status: "PENDING",
        }),
      })
    );
    // Se avisa al carrier (id "u1" según baseCarrier)
    expect(notifyUsers).toHaveBeenCalledWith(
      ["u1"],
      expect.objectContaining({ type: "CARGO_CANCELLED" })
    );
  });

  it("si el reembolso falla, la cancelacion AÚN se hace y crea RefundRequest PENDING (outbox)", async () => {
    vi.mocked(refundPayment).mockRejectedValue(
      new AppError("no pudimos devolver el dinero", 502, "MP_ERROR")
    );

    // OUTBOX: la cancelacion NO falla; el reembolso se reintentara luego
    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(tx.refundRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cargoItemId: "i1",
        targetAmount: new Prisma.Decimal("100.00"),
        status: "PENDING",
      }),
    });
    expect(tx.cargoItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    );
    expect(notifyUsers).toHaveBeenCalled(); // se avisa igual
  });

  it("no toca Mercado Pago si la seña no estaba pagada", async () => {
    tx.cargoItem.findUnique.mockResolvedValue(
      baseCargoItem({
        payments: [paidDeposit({ status: "PENDING" })],
        company: { name: "Acero SA" },
      })
    );

    const result = await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(refundPayment).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(result.status).toBe("CANCELLED");
    // ni devolución ni costo: la seña nunca se cobró
    expect(avisoA("u1").email?.html).toContain(
      "la carga no estaba pagada, así que no había nada que devolver"
    );
  });

  it("con un pago BALANCE no se retira y el saldo no se devuelve", async () => {
    tx.cargoItem.findUnique.mockResolvedValue(
      baseCargoItem({
        payments: [
          paidDeposit({ status: "PENDING" }),
          paidDeposit({
            id: "pay2",
            type: "BALANCE",
            amount: new Prisma.Decimal("400.00"),
            status: "APPROVED",
          }),
        ],
        company: { name: "Acero SA" },
      })
    );

    // el saldo nace al pasar a IN_TRANSIT (en la práctica no puede existir con la
    // carga PENDING): con saldo la carga ya viajó y no se retira (D4)
    await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_ALREADY_STARTED",
    });
    expect(tx.cargoItem.update).not.toHaveBeenCalled();
    expect(refundPayment).not.toHaveBeenCalled();
  });
});

// U21: la cotización de retiro de una carga puntual, con lo que de verdad se
// cobró de su seña. La pública (`estimateCancellation`) solo ve un monto y una
// fecha, así que le prometía «la seña no se devuelve» a quien nunca la pagó.
describe("getCargoCancellationQuote (U21)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
    );
  });

  /** el viaje sale en `horas` y la carga tiene esta seña */
  function cargaConSena(horas: number, sena: Record<string, unknown> | null) {
    const salida = salidaEn(horas);
    const item = baseCargoItem({
      payments: sena ? [paidDeposit(sena)] : [],
      company: { name: "Acero SA" },
    });
    const trip = baseTrip({ ...salida, cargoItems: [item] });
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(item as never);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(trip as never);
    tx.cargoItem.findUnique.mockResolvedValue(item);
    tx.trip.findUnique.mockResolvedValue(trip);
    tx.cargoItem.update.mockImplementation(({ data }: { data: object }) => ({
      ...item,
      ...data,
    }));
  }

  it("seña PENDING (sin pagar): no promete devolución ni retención, $ 0", async () => {
    cargaConSena(30, { status: "PENDING", mpPaymentId: null });

    const quote = await tripsService.getCargoCancellationQuote("t1", "i1", "c1");

    expect(quote).toEqual({
      window: "PARTIAL_REFUND",
      cancellable: true,
      refundAmount: 0,
      feeAmount: 0,
    });
  });

  it("seña por acreditarse (pago creado en MP, pendiente): todavía no se cobró, $ 0", async () => {
    cargaConSena(10, { status: "PENDING", mpPaymentId: "mp-9" });

    const quote = await tripsService.getCargoCancellationQuote("t1", "i1", "c1");

    expect(quote).toMatchObject({ window: "NO_REFUND", refundAmount: 0, feeAmount: 0 });
  });

  it("sin pago de seña: $ 0", async () => {
    cargaConSena(72, null);

    const quote = await tripsService.getCargoCancellationQuote("t1", "i1", "c1");

    expect(quote).toMatchObject({ window: "FULL_REFUND", refundAmount: 0, feeAmount: 0 });
  });

  it.each([
    [72, { window: "FULL_REFUND", cancellable: true, refundAmount: 100, feeAmount: 0 }],
    [36, { window: "PARTIAL_REFUND", cancellable: true, refundAmount: 50, feeAmount: 50 }],
    [10, { window: "NO_REFUND", cancellable: true, refundAmount: 0, feeAmount: 100 }],
  ])("seña APPROVED a %i h de la salida: la ventana de la política", async (horas, esperado) => {
    cargaConSena(horas, {});

    const quote = await tripsService.getCargoCancellationQuote("t1", "i1", "c1");

    expect(quote).toEqual(esperado);
  });

  it("dice lo mismo que después hace el retiro", async () => {
    cargaConSena(36, {});

    const quote = await tripsService.getCargoCancellationQuote("t1", "i1", "c1");
    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(tx.cargoItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancellationFeeAmount: new Prisma.Decimal(quote.feeAmount),
        }),
      })
    );
    expect(tx.refundRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetAmount: new Prisma.Decimal(quote.refundAmount),
      }),
    });
  });

  it("desde la salida: CLOSED, sin montos", async () => {
    cargaConSena(-1, {});

    const quote = await tripsService.getCargoCancellationQuote("t1", "i1", "c1");

    expect(quote).toEqual({
      window: "CLOSED",
      cancellable: false,
      refundAmount: 0,
      feeAmount: 0,
    });
  });

  it("viaje IN_TRANSIT aunque la salida sea futura: CLOSED", async () => {
    cargaConSena(72, {});
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(
      baseTrip({ ...salidaEn(72), status: "IN_TRANSIT" }) as never
    );

    const quote = await tripsService.getCargoCancellationQuote("t1", "i1", "c1");

    expect(quote).toMatchObject({ window: "CLOSED", cancellable: false });
  });

  it("carga con saldo (ya viajó): CLOSED", async () => {
    const item = baseCargoItem({
      payments: [paidDeposit(), paidDeposit({ id: "pay2", type: "BALANCE" })],
    });
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(item as never);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(
      baseTrip({ ...salidaEn(72) }) as never
    );

    const quote = await tripsService.getCargoCancellationQuote("t1", "i1", "c1");

    expect(quote).toMatchObject({ window: "CLOSED", cancellable: false });
  });

  it("403 si la carga es de otra empresa", async () => {
    cargaConSena(72, {});

    await expect(
      tripsService.getCargoCancellationQuote("t1", "i1", "otra")
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  it("409 CARGO_ITEM_CANCELLED si ya la retiró", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(
      baseCargoItem({ status: "CANCELLED", payments: [] }) as never
    );

    await expect(
      tripsService.getCargoCancellationQuote("t1", "i1", "c1")
    ).rejects.toBeInstanceOf(CargoItemNotCancellableError);
  });

  it("404 si la carga no es de ese viaje", async () => {
    vi.mocked(prisma.cargoItem.findUnique).mockResolvedValue(
      baseCargoItem({ tripId: "otro", payments: [] }) as never
    );

    await expect(
      tripsService.getCargoCancellationQuote("t1", "i1", "c1")
    ).rejects.toBeInstanceOf(CargoItemNotFoundError);
  });
});

// U11: la ventana se mide contra la salida (día del viaje + hora, en hora
// argentina). `date` guarda el mediodía del navegador del fletero (~15:00Z), así
// que medir contra `date` le daba a la empresa horas de más o de menos.
describe("cancelCargoItem: ventana contra la hora de salida (U11)", () => {
  /** el 11/11 tal como lo guarda el cliente: 12:00 ART */
  const DIA_DEL_VIAJE = new Date("2026-11-11T15:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
    );
    tx.cargoItem.findUnique.mockResolvedValue(
      basePaidCargoItem({ payments: [paidDeposit()], company: { name: "Acero SA" } })
    );
    tx.cargoItem.update.mockImplementation(({ data }: { data: unknown }) => data);
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.refundRequest = { create: vi.fn().mockResolvedValue({}) };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function viajeConSalida(departureTime: string | null) {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ carrier: baseCarrier(), date: DIA_DEL_VIAJE, departureTime })
    );
  }

  /** lo que quedó encolado (null = nada) y el fee congelado en la carga */
  function resultado() {
    const encolado = tx.refundRequest.create.mock.calls[0]?.[0] as
      | { data: { targetAmount: Prisma.Decimal } }
      | undefined;
    const update = tx.cargoItem.update.mock.calls[0]?.[0] as {
      data: { cancellationFeeAmount: Prisma.Decimal };
    };
    return {
      devuelve: encolado ? Number(encolado.data.targetAmount) : null,
      fee: Number(update.data.cancellationFeeAmount),
    };
  }

  it("salida 18:00 ART, retiro a 60 h reales: devuelve el 100 %", async () => {
    viajeConSalida("18:00");
    freezeClockAt("2026-11-09T09:00:00.000Z");

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(resultado()).toEqual({ devuelve: 100, fee: 0 });
  });

  it("salida 18:00: a 50 h de la salida (44 h del mediodía) devuelve todo, no la mitad", async () => {
    viajeConSalida("18:00");
    freezeClockAt("2026-11-09T19:00:00.000Z");

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(resultado()).toEqual({ devuelve: 100, fee: 0 });
  });

  it("salida 06:00: a 44 h de la salida (50 h del mediodía) devuelve la mitad, no todo", async () => {
    viajeConSalida("06:00");
    freezeClockAt("2026-11-09T13:00:00.000Z");

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(resultado()).toEqual({ devuelve: 50, fee: 50 });
  });

  it("viaje viejo sin hora: mide contra las 23:59 ART (a 30 h devuelve la mitad)", async () => {
    viajeConSalida(null);
    // 30 h antes de las 23:59 ART del 11/11; contra el mediodía serían ~18 h
    freezeClockAt("2026-11-10T20:59:00.000Z");

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(resultado()).toEqual({ devuelve: 50, fee: 50 });
  });

  it("borde exacto de 48 h antes de la salida: la mitad", async () => {
    viajeConSalida("18:00");
    freezeClockAt("2026-11-09T21:00:00.000Z");

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(resultado()).toEqual({ devuelve: 50, fee: 50 });
  });

  it("un minuto antes del borde de 48 h: todo", async () => {
    viajeConSalida("18:00");
    freezeClockAt("2026-11-09T20:59:00.000Z");

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(resultado()).toEqual({ devuelve: 100, fee: 0 });
  });

  it("borde exacto de 24 h antes de la salida: todavía la mitad", async () => {
    viajeConSalida("18:00");
    freezeClockAt("2026-11-10T21:00:00.000Z");

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(resultado()).toEqual({ devuelve: 50, fee: 50 });
  });

  it("un minuto después del borde de 24 h: no devuelve nada", async () => {
    viajeConSalida("18:00");
    freezeClockAt("2026-11-10T21:01:00.000Z");

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(resultado()).toEqual({ devuelve: null, fee: 100 });
  });
});

describe("cancelCargoItem: carga CONFIRMED retirable hasta la salida (D4)", () => {
  /** el 11/11 tal como lo guarda el cliente (12:00 ART), con salida a las 18:00 ART */
  const DIA_DEL_VIAJE = new Date("2026-11-11T15:00:00.000Z");

  const confirmada = (overrides: Record<string, unknown> = {}) =>
    basePaidCargoItem({
      status: "CONFIRMED",
      payments: [paidDeposit()],
      company: { name: "Acero SA" },
      ...overrides,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
    );
    tx.cargoItem.findUnique.mockResolvedValue(confirmada());
    tx.cargoItem.update.mockImplementation(({ data }: { data: unknown }) => data);
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.refundRequest = { create: vi.fn().mockResolvedValue({}) };
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ carrier: baseCarrier(), date: DIA_DEL_VIAJE, departureTime: "18:00" })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** lo que quedó encolado (null = nada) y el fee congelado en la carga */
  function resultado() {
    const encolado = tx.refundRequest.create.mock.calls[0]?.[0] as
      | { data: { targetAmount: Prisma.Decimal } }
      | undefined;
    const update = tx.cargoItem.update.mock.calls[0]?.[0] as {
      data: { status: string; cancellationFeeAmount: Prisma.Decimal };
    };
    return {
      estado: update.data.status,
      devuelve: encolado ? Number(encolado.data.targetAmount) : null,
      fee: Number(update.data.cancellationFeeAmount),
    };
  }

  it.each([
    ["más de 48 h: devuelve toda la seña", "2026-11-09T09:00:00.000Z", 100, 0],
    ["entre 24 y 48 h: devuelve la mitad", "2026-11-10T15:00:00.000Z", 50, 50],
    ["menos de 24 h: se retiene la seña entera", "2026-11-11T11:00:00.000Z", null, 100],
  ] as const)("%s, igual que una PENDING", async (_tramo, ahora, devuelve, fee) => {
    freezeClockAt(ahora);

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(resultado()).toEqual({ estado: "CANCELLED", devuelve, fee });
  });

  it("libera el lugar: si el viaje estaba FULL vuelve a OPEN en la misma TX", async () => {
    freezeClockAt("2026-11-09T09:00:00.000Z");
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({
        carrier: baseCarrier(),
        date: DIA_DEL_VIAJE,
        departureTime: "18:00",
        status: "FULL",
        capacityTotal: 10,
        cargoItems: [confirmada()],
      })
    );

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(tx.trip.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "OPEN" },
    });
  });

  it("con el viaje en camino: 409 TRIP_ALREADY_STARTED, sin tocar nada", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ carrier: baseCarrier(), date: DIA_DEL_VIAJE, status: "IN_TRANSIT" })
    );

    await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_ALREADY_STARTED",
    });
    expect(tx.cargoItem.update).not.toHaveBeenCalled();
    expect(tx.refundRequest.create).not.toHaveBeenCalled();
  });

  it("con un pago de saldo ya creado: 409 TRIP_ALREADY_STARTED, sin tocar nada", async () => {
    // el saldo nace al pasar a IN_TRANSIT: una carga con saldo ya viajó, aunque
    // el estado del viaje diga otra cosa. El outbox solo devuelve la seña.
    tx.cargoItem.findUnique.mockResolvedValue(
      confirmada({
        payments: [
          paidDeposit(),
          paidDeposit({
            id: "pay2",
            type: "BALANCE",
            amount: new Prisma.Decimal("400.00"),
          }),
        ],
      })
    );

    await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_ALREADY_STARTED",
    });
    expect(tx.cargoItem.update).not.toHaveBeenCalled();
    expect(tx.refundRequest.create).not.toHaveBeenCalled();
  });

  it("avisa al transportista igual que con una PENDING", async () => {
    freezeClockAt("2026-11-09T09:00:00.000Z");

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(avisoA("u1").type).toBe("CARGO_CANCELLED");
  });

  // el retiro se corta a la hora de salida, no solo por el estado del viaje: si
  // el fletero no sale, D6 devuelve la seña entera, y retirar tarde la haría
  // perder. La salida es 18:00 ART del 11/11 = 21:00Z.
  describe.each([["PENDING"], ["CONFIRMED"]] as const)(
    "corte en la salida (%s)",
    (status) => {
      beforeEach(() => {
        tx.cargoItem.findUnique.mockResolvedValue(confirmada({ status }));
      });

      it("un minuto antes de la salida: se retira, con la seña retenida entera", async () => {
        freezeClockAt("2026-11-11T20:59:00.000Z");

        await tripsService.cancelCargoItem("t1", "i1", "c1");

        expect(resultado()).toEqual({ estado: "CANCELLED", devuelve: null, fee: 100 });
      });

      it("un minuto después de la salida: 409 TRIP_ALREADY_STARTED, sin tocar nada", async () => {
        freezeClockAt("2026-11-11T21:01:00.000Z");

        await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toMatchObject({
          statusCode: 409,
          code: "TRIP_ALREADY_STARTED",
        });
        expect(tx.cargoItem.update).not.toHaveBeenCalled();
        expect(tx.payment.updateMany).not.toHaveBeenCalled();
        expect(tx.refundRequest.create).not.toHaveBeenCalled();
        expect(tx.trip.update).not.toHaveBeenCalled();
      });
    }
  );
});

describe("cancelCargoItem: carrera con el webhook que aprueba la seña", () => {
  const conSeña = (overrides: Record<string, unknown>) =>
    basePaidCargoItem({ payments: [paidDeposit(overrides)], company: { name: "Acero SA" } });

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
    );
    tx.cargoItem.update.mockImplementation(({ data }: { data: unknown }) => data);
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.refundRequest = { create: vi.fn().mockResolvedValue({}) };
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ carrier: baseCarrier(), date: tripDateIn(72) })
    );
  });

  it("toma la fila de la seña PENDING dentro de la TX: el CAS del webhook espera al retiro", async () => {
    tx.cargoItem.findUnique.mockResolvedValue(
      conSeña({ status: "PENDING", mpPaymentId: null })
    );

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    // un write sobre la fila: si el webhook la cambió después de nuestra
    // lectura, Serializable aborta (P2034) y se reintenta con lo nuevo
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay1", status: "PENDING" },
      data: { updatedAt: expect.any(Date) },
    });
    expect(tx.refundRequest.create).not.toHaveBeenCalled();
  });

  it("la seña se aprobó entre la lectura y la toma: reintenta y encola la RefundRequest", async () => {
    tx.cargoItem.findUnique
      .mockResolvedValueOnce(conSeña({ status: "PENDING", mpPaymentId: null }))
      .mockResolvedValueOnce(conSeña({ status: "APPROVED", mpPaymentId: "mp-77" }));
    tx.payment.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.refundRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cargoItemId: "i1",
        targetAmount: new Prisma.Decimal("100.00"),
        status: "PENDING",
      }),
    });
  });

  it("si la seña no deja de cambiar, no retira la carga (409 para reintentar)", async () => {
    tx.cargoItem.findUnique.mockResolvedValue(
      conSeña({ status: "PENDING", mpPaymentId: null })
    );
    tx.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toMatchObject({
      statusCode: 409,
      code: "PAYMENT_IN_FLIGHT",
    });
    expect(tx.cargoItem.update).not.toHaveBeenCalled();
  });
});

describe("quoteCargoPrice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
    );
    tx.cargoItem.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "i1",
      ...(data as object),
    }));
    tx.payment.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "p1",
      ...(data as object),
    }));
  });

  it("cotiza lo mismo que después cobra addCargoItem", async () => {
    const viaje = baseTrip({
      price: new Prisma.Decimal("1000.00"),
      capacityTotal: 3,
      depositPercent: 15,
    });
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(viaje as never);
    tx.trip.findUnique.mockResolvedValue(viaje);

    const quote = await tripsService.quoteCargoPrice("t1", 1);
    const reservada = await tripsService.addCargoItem("t1", "c1", {
      description: "Maquinaria",
      pickupAddress: "Córdoba, Córdoba",
      volume: 1,
    });

    expect(quote).toEqual({
      volume: 1,
      depositPercent: 15,
      priceShare: 333.33,
      depositAmount: 50,
      balanceAmount: 283.33,
    });
    expect(quote.priceShare).toBe(reservada.priceShare);
    expect(quote.depositAmount).toBe(reservada.depositAmount);
  });

  it("404 si el viaje no existe", async () => {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);

    await expect(tripsService.quoteCargoPrice("nope", 1)).rejects.toBeInstanceOf(
      TripNotFoundError
    );
  });
});

describe("addCargoItem: tope de reservas sin seña (U15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
    );
    tx.cargoItem.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "i-nueva",
      ...(data as object),
    }));
    tx.payment.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "p-nueva",
      ...(data as object),
    }));
    tx.cargoItem.findMany.mockResolvedValue([]);
    tx.trip.findUnique.mockResolvedValue(baseTrip());
  });

  afterEach(() => {
    tx.cargoItem.findMany.mockResolvedValue([]);
  });

  const reservar = () =>
    tripsService.addCargoItem("t1", "c1", {
      description: "Maquinaria",
      pickupAddress: "Córdoba, Córdoba",
      volume: 1,
    });

  it("la 4.ª reserva sin seña → 409 TOO_MANY_PENDING", async () => {
    tx.cargoItem.findMany.mockResolvedValue([
      { tripId: "t2" },
      { tripId: "t3" },
      { tripId: "t4" },
    ]);

    const err = await reservar().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 409, code: "TOO_MANY_PENDING" });
    expect(tx.cargoItem.create).not.toHaveBeenCalled();
  });

  it("con 2 reservas sin seña en otros viajes, la 3.ª entra", async () => {
    tx.cargoItem.findMany.mockResolvedValue([{ tripId: "t2" }, { tripId: "t3" }]);

    const result = await reservar();

    expect(result.volume).toBe(1);
  });

  it("una 2.ª reserva sin seña en el mismo viaje → 409 TOO_MANY_PENDING", async () => {
    tx.cargoItem.findMany.mockResolvedValue([{ tripId: "t1" }]);

    const err = await reservar().catch((e: unknown) => e);

    expect(err).toMatchObject({ statusCode: 409, code: "TOO_MANY_PENDING" });
    expect(tx.cargoItem.create).not.toHaveBeenCalled();
  });

  it("cuenta dentro de la TX solo las PENDING de la empresa en viajes que no salieron, sin seña pagada ni por acreditarse", async () => {
    await reservar();

    expect(tx.cargoItem.findMany).toHaveBeenCalledWith({
      where: {
        companyId: "c1",
        status: "PENDING",
        trip: { status: { in: ["OPEN", "FULL"] } },
        payments: {
          none: {
            type: "DEPOSIT",
            OR: [
              { status: "APPROVED" },
              { status: "PENDING", mpPaymentId: { not: null } },
            ],
          },
        },
      },
      select: { tripId: true },
    });
  });
});

describe("addCargoItem con cargas retiradas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
    );
    tx.cargoItem.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "i1",
      ...(data as object),
    }));
    tx.payment.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "p1",
      ...(data as object),
    }));
    (createCheckoutPreference as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      preferenceId: "pref-1",
      initPoint: "https://mp.com/init",
      platformFeeAmount: 150,
      carrierAmount: 1350,
    });
    tx.user.findUnique.mockResolvedValue({
      name: "Transportes Flete",
      email: "flete@truckpool.app",
      emailNotifications: true,
    });
  });

  it("el espacio de una carga retirada vuelve a estar disponible", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({
        capacityTotal: 30,
        cargoItems: [
          { id: "i1", volume: 10, status: "CANCELLED" },
          { id: "i2", volume: 20, status: "CONFIRMED" },
        ],
      })
    );

    const result = await tripsService.addCargoItem("t1", "c1", {
      description: "Maquinaria",
      pickupAddress: "Córdoba, Córdoba",
      volume: 10,
    });

    expect(result.priceShare).toBe(500);
    expect(tx.trip.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "FULL" },
    });
  });

  it("sigue rechazando carga que excede la capacidad sin contar las retiradas", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({
        capacityTotal: 30,
        cargoItems: [
          { id: "i1", volume: 10, status: "CANCELLED" },
          { id: "i2", volume: 20, status: "CONFIRMED" },
        ],
      })
    );

    await expect(
      tripsService.addCargoItem("t1", "c1", {
        description: "Maquinaria",
        pickupAddress: "Córdoba, Córdoba",
        volume: 11,
      })
    ).rejects.toBeInstanceOf(NotEnoughCapacityError);
  });
});

describe("addCargoItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
    );
    tx.cargoItem.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "i1",
      ...(data as object),
    }));
    tx.payment.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "p1",
      ...(data as object),
    }));
    tx.user.findUnique.mockResolvedValue({
      name: "Transportes Flete",
      email: "flete@truckpool.app",
      emailNotifications: true,
      mpUserId: "mp-user-123",
      mpAccessToken: "access-token-123",
    });
  });

  it("prorratea el precio por volumen y guarda el item", async () => {
    tx.trip.findUnique.mockResolvedValue(baseTrip());

    const result = await tripsService.addCargoItem("t1", "c1", {
      description: "Maquinaria",
      pickupAddress: "Córdoba, Córdoba",
      volume: 10,
    });

    expect(tx.cargoItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tripId: "t1",
          companyId: "c1",
          volume: 10,
          description: "Maquinaria",
          priceShare: expect.any(Prisma.Decimal),
        }),
      })
    );
    expect(result.priceShare).toBe(500);
    expect(tx.trip.update).not.toHaveBeenCalled();
  });

  it("congela la seña con el porcentaje del viaje y abre el pago DEPOSIT", async () => {
    // precio 1500 para 30 m³, la carga usa 10 m³ → 500 de carga, y el viaje
    // pide 20% de seña: 100.
    tx.trip.findUnique.mockResolvedValue(baseTrip({ depositPercent: 20 }));

    const result = await tripsService.addCargoItem("t1", "c1", {
      description: "Maquinaria",
      pickupAddress: "Córdoba, Córdoba",
      volume: 10,
    });

    expect(tx.cargoItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          depositAmount: new Prisma.Decimal("100.00"),
        }),
      })
    );
    // el pago de la seña nace con la carga, en PENDING: hasta que la empresa
    // pague tiene 24hs de reserva.
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: {
        cargoItemId: "i1",
        amount: new Prisma.Decimal("100.00"),
        type: "DEPOSIT",
      },
    });
    expect(result.depositAmount).toBe(100);
    expect(result.depositPayment).toEqual(
      expect.objectContaining({ type: "DEPOSIT", amount: 100 })
    );
    expect(result.balancePayment).toBeNull();
  });

  it.each([
    ["sin cuenta", { mpUserId: null, mpAccessToken: null }],
    ["sin token", { mpUserId: "mp-u1", mpAccessToken: null }],
    ["token vacío", { mpUserId: "mp-u1", mpAccessToken: "" }],
    ["sin los campos", {}],
  ])(
    "409 MP_ACCOUNT_NOT_CONNECTED si el fletero no puede cobrar (%s)",
    async (_caso, mp) => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({ carrier: { id: "u1", isAvailableForRequests: true, ...mp } })
      );

      const err = await tripsService
        .addCargoItem("t1", "c1", {
          description: "Maquinaria",
          pickupAddress: "Córdoba, Córdoba",
          volume: 10,
        })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ statusCode: 409, code: "MP_ACCOUNT_NOT_CONNECTED" });
      expect(tx.cargoItem.create).not.toHaveBeenCalled();
      expect(tx.payment.create).not.toHaveBeenCalled();
    }
  );

  it("lee la cuenta de MP del fletero dentro de la transacción", async () => {
    tx.trip.findUnique.mockResolvedValue(baseTrip());

    await tripsService.addCargoItem("t1", "c1", {
      description: "Maquinaria",
      pickupAddress: "Córdoba, Córdoba",
      volume: 10,
    });

    expect(tx.trip.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          carrier: { select: { mpUserId: true, mpAccessToken: true } },
        }),
      })
    );
  });

  it("guarda el precio y la seña que da cargoPrice (lib/pricing.ts)", async () => {
    // 1000 por 3 m³ con 15 % de seña: 333,33 y 50,00, los dos redondeados
    const viaje = baseTrip({
      price: new Prisma.Decimal("1000.00"),
      capacityTotal: 3,
      depositPercent: 15,
    });
    tx.trip.findUnique.mockResolvedValue(viaje);
    const esperado = cargoPrice(viaje, 1);

    await tripsService.addCargoItem("t1", "c1", {
      description: "Maquinaria",
      pickupAddress: "Córdoba, Córdoba",
      volume: 1,
    });

    expect(tx.cargoItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priceShare: esperado.priceShare,
          depositAmount: esperado.depositAmount,
        }),
      })
    );
    expect(esperado.priceShare.toFixed(2)).toBe("333.33");
    expect(esperado.depositAmount.toFixed(2)).toBe("50.00");
  });

  it("respeta un porcentaje de seña distinto al 20%", async () => {
    tx.trip.findUnique.mockResolvedValue(baseTrip({ depositPercent: 50 }));

    const result = await tripsService.addCargoItem("t1", "c1", {
      description: "Maquinaria",
      pickupAddress: "Córdoba, Córdoba",
      volume: 10,
    });

    expect(result.depositAmount).toBe(250);
  });

  it("avisa al transportista qué se sumó y cuánto queda libre", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({
        origin: "Córdoba",
        destination: "Rosario",
        cargoItems: [{ volume: 12 }],
      })
    );

    await tripsService.addCargoItem("t1", "c1", {
      description: "Maquinaria",
      pickupAddress: "Córdoba, Córdoba",
      volume: 10,
    });

    const aviso = avisoA("u1");
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(aviso.type).toBe("CARGO_ADDED");
    expect(aviso.tripId).toBe("t1");
    expect(aviso.body).toContain("sumó maquinaria (10 m³)");
    // el detalle de capacidad libre va en el email, no en la campanita
    expect(aviso.email?.html).toContain("te quedan 8 m³ libres de 30 m³");
    expect(aviso.email?.subject).toBe("nueva carga en tu viaje Córdoba → Rosario");
  });

  it("crea la carga aunque el aviso falle", async () => {
    tx.trip.findUnique.mockResolvedValue(baseTrip());
    vi.mocked(notifyUsers).mockRejectedValueOnce(new Error("la base de avisos cayó"));

    const result = await tripsService.addCargoItem("t1", "c1", {
      description: "Maquinaria",
      pickupAddress: "Córdoba, Córdoba",
      volume: 10,
    });

    expect(result.volume).toBe(10);
    expect(tx.cargoItem.create).toHaveBeenCalled();
  });

  it("no avisa a nadie si la carga no entra", async () => {
    tx.trip.findUnique.mockResolvedValue(baseTrip({ cargoItems: [{ volume: 28 }] }));

    await expect(
      tripsService.addCargoItem("t1", "c1", {
        description: "Grande",
        pickupAddress: "Córdoba, Córdoba",
        volume: 5,
      })
    ).rejects.toBeInstanceOf(NotEnoughCapacityError);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("lanza NotEnoughCapacityError si el volumen no entra", async () => {
    tx.trip.findUnique.mockResolvedValue(baseTrip({ cargoItems: [{ volume: 28 }] }));

    await expect(
      tripsService.addCargoItem("t1", "c1", {
        description: "Grande",
        pickupAddress: "Córdoba, Córdoba",
        volume: 5,
      })
    ).rejects.toBeInstanceOf(NotEnoughCapacityError);
    expect(tx.cargoItem.create).not.toHaveBeenCalled();
  });

  it("marca el viaje como FULL cuando se completa", async () => {
    tx.trip.findUnique.mockResolvedValue(baseTrip({ cargoItems: [{ volume: 20 }] }));

    await tripsService.addCargoItem("t1", "c1", {
      description: "Completa",
      pickupAddress: "Córdoba, Córdoba",
      volume: 10,
    });

    expect(tx.trip.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "FULL" },
    });
  });

  it("lanza TripNotOpenError si el viaje no está OPEN", async () => {
    tx.trip.findUnique.mockResolvedValue(
      baseTrip({ status: "FULL", cargoItems: [{ volume: 20 }] })
    );

    await expect(
      tripsService.addCargoItem("t1", "c1", {
        description: "X",
        pickupAddress: "Córdoba, Córdoba",
        volume: 1,
      })
    ).rejects.toBeInstanceOf(TripNotOpenError);
    expect(tx.cargoItem.create).not.toHaveBeenCalled();
  });

  it("un viaje CANCELLED no acepta cargas (D6)", async () => {
    tx.trip.findUnique.mockResolvedValue(baseTrip({ status: "CANCELLED" }));

    await expect(
      tripsService.addCargoItem("t1", "c1", {
        description: "X",
        pickupAddress: "Córdoba, Córdoba",
        volume: 1,
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "TRIP_NOT_OPEN" });
    expect(tx.cargoItem.create).not.toHaveBeenCalled();
  });

  it("lanza TripNotFoundError si el viaje no existe", async () => {
    tx.trip.findUnique.mockResolvedValue(null);

    await expect(
      tripsService.addCargoItem("nope", "c1", {
        description: "X",
        pickupAddress: "Córdoba, Córdoba",
        volume: 1,
      })
    ).rejects.toBeInstanceOf(TripNotFoundError);
  });

  describe("disponibilidad por fecha", () => {
    const alta = () =>
      tripsService.addCargoItem("t1", "c1", {
        description: "Maquinaria",
        pickupAddress: "Córdoba, Córdoba",
        volume: 1,
      });

    it("permite la carga si el viaje es de mañana", async () => {
      tx.trip.findUnique.mockResolvedValue(baseTrip({ date: futureTripDate(1) }));

      await alta();

      expect(tx.cargoItem.create).toHaveBeenCalled();
    });

    it("rechaza la carga si el viaje es de hoy, aunque siga OPEN", async () => {
      // date = ahora: el viaje es de hoy (o de ayer, si el test corrió cerca de
      // la medianoche) en cualquier caso no admite carga nueva.
      tx.trip.findUnique.mockResolvedValue(baseTrip({ date: new Date(), status: "OPEN" }));

      await expect(alta()).rejects.toBeInstanceOf(TripDatePassedError);
      expect(tx.cargoItem.create).not.toHaveBeenCalled();
    });

    it("rechaza la carga si el viaje ya pasó", async () => {
      tx.trip.findUnique.mockResolvedValue(baseTrip({ date: futureTripDate(-2) }));

      await expect(alta()).rejects.toBeInstanceOf(TripDatePassedError);
      expect(tx.cargoItem.create).not.toHaveBeenCalled();
    });

    it("el error dice que el viaje está en curso y trae su code", async () => {
      tx.trip.findUnique.mockResolvedValue(baseTrip({ date: futureTripDate(-2) }));

      await expect(alta()).rejects.toMatchObject({
        statusCode: 409,
        code: "TRIP_DATE_PASSED",
        message: "este viaje ya está en curso y no acepta nuevas cargas",
      });
    });

    it("no cambia el estado del viaje: sigue OPEN, sólo no entra carga", async () => {
      tx.trip.findUnique.mockResolvedValue(baseTrip({ date: new Date(), status: "OPEN" }));

      await expect(alta()).rejects.toBeInstanceOf(TripDatePassedError);
      // ni FULL ni IN_TRANSIT: la transición sigue siendo del transportista.
      expect(tx.trip.update).not.toHaveBeenCalled();
    });

    it("mantiene el rechazo por estado cuando el viaje es FULL pero de fecha futura", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({ status: "FULL", date: futureTripDate(1), cargoItems: [{ volume: 20 }] })
      );

      await expect(alta()).rejects.toBeInstanceOf(TripNotOpenError);
    });
  });

  describe("validación de distancia parada ↔ trayecto", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
      );
      // mock para prisma.trip.findUnique (usado por getTripRouteGeometry y getTripRoute)
      const fullTrip = baseTrip({
        id: "t1",
        status: "OPEN",
        originLat: -31.4201,
        originLng: -64.1888,
        destLat: -32.9442,
        destLng: -60.6505,
        cargoItems: [],
      });
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        fullTrip
      );
      // mock para tx.trip.findUnique dentro de la transacción de addCargoItem
      tx.trip.findUnique.mockResolvedValue(fullTrip);
      tx.cargoItem.create.mockImplementation(({ data }: { data: unknown }) => ({
        id: "i1",
        ...(data as object),
      }));
      tx.payment.create.mockImplementation(({ data }: { data: unknown }) => ({
        id: "p1",
        ...(data as object),
      }));
      tx.user.findUnique.mockResolvedValue({
        name: "Transportes Flete",
        email: "flete@truckpool.app",
        emailNotifications: true,
        mpUserId: "mp-user-123",
        mpAccessToken: "access-token-123",
      });
      // mock del geocode para el pickup (por defecto cerca del trayecto)
      vi.mocked(geocode).mockResolvedValue({ lat: -31.42, lng: -64.18 });
    });

    it("pasa cuando el pickup está cerca del trayecto (distancia <= 8 km)", async () => {
      // geometría de ruta Córdoba → Rosario (simula OSRM)
      const routeGeometry: [number, number][] = [
        [-64.1888, -31.4201], // Córdoba
        [-63.5, -32.0], // punto intermedio
        [-60.6505, -32.9442], // Rosario
      ];
      vi.mocked(fetchRouteGeometry).mockResolvedValue(routeGeometry);

      const result = await tripsService.addCargoItem("t1", "c1", {
        description: "Maquinaria",
        pickupAddress: "Córdoba, Córdoba",
        volume: 10,
      });

      expect(result.volume).toBe(10);
    });

    it("guarda un trackingCode aleatorio con el formato nuevo (U9)", async () => {
      vi.mocked(fetchRouteGeometry).mockResolvedValue(null);

      await tripsService.addCargoItem("t1", "c1", {
        description: "Maquinaria",
        pickupAddress: "Córdoba, Córdoba",
        volume: 10,
      });

      const data = tx.cargoItem.create.mock.calls[0]?.[0]?.data as {
        trackingCode: string;
      };
      // ya no sale del id del viaje ni del orden de la carga (TP-{tripId}-C{n})
      expect(data.trackingCode).toMatch(TRACKING_CODE_PATTERN);
      expect(data.trackingCode).not.toMatch(/-C\d+$/);
    });

    it("falla con STOP_TOO_FAR_FROM_ROUTE cuando el pickup está lejos del trayecto (distancia > 8 km)", async () => {
      // geometría de ruta Córdoba → Rosario
      const routeGeometry: [number, number][] = [
        [-64.1888, -31.4201],
        [-63.5, -32.0],
        [-60.6505, -32.9442],
      ];
      vi.mocked(fetchRouteGeometry).mockResolvedValue(routeGeometry);
      // pickup en Buenos Aires (muy lejos de la ruta Córdoba-Rosario)
      vi.mocked(geocode).mockResolvedValue({ lat: -34.6037, lng: -58.3816 });

      await expect(
        tripsService.addCargoItem("t1", "c1", {
          description: "Maquinaria",
          pickupAddress: "Buenos Aires, CABA",
          volume: 10,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "STOP_TOO_FAR_FROM_ROUTE",
      });

      // no se crea el cargo ni el pago
      expect(tx.cargoItem.create).not.toHaveBeenCalled();
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it("pasa (sin bloquear) cuando fetchRouteGeometry devuelve null (OSRM caído)", async () => {
      vi.mocked(fetchRouteGeometry).mockResolvedValue(null);

      const result = await tripsService.addCargoItem("t1", "c1", {
        description: "Maquinaria",
        pickupAddress: "Buenos Aires, CABA",
        volume: 10,
      });

      expect(result.volume).toBe(10);
      // no lanza error aunque el pickup esté lejos, porque no hay geometría con qué comparar
    });

    it("pasa (sin bloquear) cuando fetchRouteGeometry devuelve geometría con menos de 2 puntos", async () => {
      vi.mocked(fetchRouteGeometry).mockResolvedValue([
        [-64.1888, -31.4201],
      ]); // solo 1 punto

      const result = await tripsService.addCargoItem("t1", "c1", {
        description: "Maquinaria",
        pickupAddress: "Buenos Aires, CABA",
        volume: 10,
      });

      expect(result.volume).toBe(10);
    });

    it("pasa cuando el pickup no tiene coordenadas (geocode falló)", async () => {
      vi.mocked(geocode).mockResolvedValue(null);

      const result = await tripsService.addCargoItem("t1", "c1", {
        description: "Maquinaria",
        pickupAddress: "Lugar sin geocodificar",
        volume: 10,
      });

      expect(result.volume).toBe(10);
    });
  });

  describe("reservas vencidas", () => {
    // 24 h antes de AHORA: una reserva creada antes vence; creada justo ahí, no
    const AHORA = new Date("2026-09-27T12:00:00Z");
    const CORTE = new Date("2026-09-26T12:00:00Z");
    const VIEJA = new Date("2026-09-26T11:59:59Z");

    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.clearAllMocks();
      (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
      );
      tx.cargoItem.update.mockResolvedValue({});
      tx.trip.update.mockResolvedValue({});
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      tx.refundRequest.create = vi.fn().mockResolvedValue({});
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    /** la búsqueda devuelve los viajes con alguna reserva vencida */
    function candidatos(...tripIds: string[]) {
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(tripIds.map((tripId) => ({ tripId })));
    }

    /** lo que la TX lee del viaje (con cada carga y sus pagos) */
    function viajeEnTx(...estados: Record<string, unknown>[]) {
      for (const estado of estados) {
        tx.trip.findUnique.mockResolvedValueOnce(baseTrip({ ...estado }));
      }
    }

    function vencida(overrides: Record<string, unknown> = {}) {
      return baseCargoItem({ createdAt: VIEJA, payments: [], ...overrides });
    }

    const canceladas = () =>
      tx.cargoItem.update.mock.calls.map(
        (call) => (call[0] as { where: { id: string } }).where.id
      );

    it("no hace nada si no hay reservas vencidas", async () => {
      candidatos();

      expect(await tripsService.releaseExpiredReservations(AHORA)).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("busca reservas vencidas sin seña aprobada ni por acreditarse, en viajes que no salieron", async () => {
      candidatos();

      await tripsService.releaseExpiredReservations(AHORA);

      expect(prisma.cargoItem.findMany).toHaveBeenCalledWith({
        where: {
          status: "PENDING",
          // 24 h exactas: la reserva se rompe recién pasado el plazo
          createdAt: { lt: CORTE },
          trip: { status: { in: ["OPEN", "FULL"] } },
          payments: {
            none: {
              type: "DEPOSIT",
              OR: [
                { status: "APPROVED" },
                { status: "PENDING", mpPaymentId: { not: null } },
              ],
            },
          },
        },
        select: { tripId: true },
        distinct: ["tripId"],
      });
    });

    it("libera la reserva que no pagó la seña en 24 h, dentro de una TX Serializable y sin reembolso", async () => {
      candidatos("t1");
      viajeEnTx({ cargoItems: [vencida()] });

      expect(await tripsService.releaseExpiredReservations(AHORA)).toBe(1);

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
      });
      expect(tx.cargoItem.update).toHaveBeenCalledWith({
        where: { id: "i1" },
        data: {
          status: "CANCELLED",
          cancelledAt: AHORA,
          // nunca se cobró nada: el costo es 0 (y no null, que en el mapper
          // significa "la carga sigue viva")
          cancellationFeeAmount: new Prisma.Decimal(0),
        },
      });
      expect(tx.refundRequest.create).not.toHaveBeenCalled();
      // la consecuencia de no pagar no se avisa
      expect(notifyUsers).not.toHaveBeenCalled();
      // todo pasa en la TX: nada se escribe por fuera
      expect(prisma.cargoItem.updateMany).not.toHaveBeenCalled();
      expect(prisma.trip.update).not.toHaveBeenCalled();
    });

    it("no libera una reserva con la seña aprobada ni con la seña por acreditarse", async () => {
      candidatos("t1");
      viajeEnTx({
        cargoItems: [
          vencida({
            id: "aprobada",
            payments: [basePayment({ cargoItemId: "aprobada" })],
          }),
          vencida({
            id: "por-acreditarse",
            payments: [
              basePayment({
                cargoItemId: "por-acreditarse",
                status: "PENDING",
                mpPaymentId: "mp-9",
              }),
            ],
          }),
        ],
      });

      expect(await tripsService.releaseExpiredReservations(AHORA)).toBe(0);
      expect(tx.cargoItem.update).not.toHaveBeenCalled();
    });

    it("libera la reserva con la seña rechazada o con la preference creada pero sin pago en MP", async () => {
      candidatos("t1");
      viajeEnTx({
        cargoItems: [
          vencida({
            id: "rechazada",
            payments: [basePayment({ cargoItemId: "rechazada", status: "REJECTED" })],
          }),
          vencida({
            id: "sin-pago",
            payments: [
              basePayment({
                cargoItemId: "sin-pago",
                status: "PENDING",
                mpPaymentId: null,
              }),
            ],
          }),
        ],
      });

      expect(await tripsService.releaseExpiredReservations(AHORA)).toBe(2);
      expect(canceladas()).toEqual(["rechazada", "sin-pago"]);
      expect(tx.refundRequest.create).not.toHaveBeenCalled();
    });

    it("no toca reservas que no vencieron ni cargas confirmadas", async () => {
      candidatos("t1");
      viajeEnTx({
        cargoItems: [
          vencida({ id: "justo-24h", createdAt: CORTE }),
          vencida({ id: "confirmada", status: "CONFIRMED" }),
          vencida({ id: "vieja" }),
        ],
      });

      expect(await tripsService.releaseExpiredReservations(AHORA)).toBe(1);
      expect(canceladas()).toEqual(["vieja"]);
    });

    it("no libera nada si al releer el viaje ya salió o se canceló", async () => {
      candidatos("t1", "t2");
      viajeEnTx(
        { id: "t1", status: "IN_TRANSIT", cargoItems: [vencida()] },
        { id: "t2", status: "CANCELLED", cargoItems: [vencida()] }
      );

      expect(await tripsService.releaseExpiredReservations(AHORA)).toBe(0);
      expect(tx.cargoItem.update).not.toHaveBeenCalled();
    });

    it("reabre dentro de la TX el viaje FULL que quedó con lugar libre", async () => {
      candidatos("t1");
      viajeEnTx({
        status: "FULL",
        capacityTotal: 30,
        cargoItems: [
          vencida({ id: "i1", volume: 10 }),
          vencida({ id: "i2", volume: 20, status: "CONFIRMED" }),
        ],
      });

      await tripsService.releaseExpiredReservations(AHORA);

      expect(tx.trip.update).toHaveBeenCalledWith({
        where: { id: "t1" },
        data: { status: "OPEN" },
      });
      expect(prisma.trip.update).not.toHaveBeenCalled();
    });

    it("deja FULL el viaje si las reservas vencidas no liberan lugar", async () => {
      candidatos("t1");
      viajeEnTx({
        status: "FULL",
        capacityTotal: 30,
        cargoItems: [
          // la vencida se libera, pero lo confirmado ya ocupa todo
          vencida({ id: "i1", volume: 10 }),
          vencida({ id: "i2", volume: 30, status: "CONFIRMED" }),
        ],
      });

      expect(await tripsService.releaseExpiredReservations(AHORA)).toBe(1);
      expect(tx.trip.update).not.toHaveBeenCalled();
    });

    it("un viaje OPEN sigue OPEN (no se reescribe el estado)", async () => {
      candidatos("t1");
      viajeEnTx({ cargoItems: [vencida()] });

      await tripsService.releaseExpiredReservations(AHORA);

      expect(tx.trip.update).not.toHaveBeenCalled();
    });

    it("si la seña se aprobó en el medio, reintenta la TX y la reserva se mantiene", async () => {
      candidatos("t1");
      viajeEnTx(
        {
          cargoItems: [
            vencida({
              payments: [basePayment({ status: "PENDING", mpPaymentId: null })],
            }),
          ],
        },
        // al reintentar, el webhook ya la aprobó
        { cargoItems: [vencida({ payments: [basePayment()] })] }
      );
      // el CAS sobre la seña no encuentra el estado leído
      tx.payment.updateMany.mockResolvedValueOnce({ count: 0 });

      expect(await tripsService.releaseExpiredReservations(AHORA)).toBe(0);

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "pay1", status: "PENDING" },
        data: { updatedAt: AHORA },
      });
      expect(tx.cargoItem.update).not.toHaveBeenCalled();
    });

    it("con un addCargoItem concurrente reintenta y decide el estado con lo que hay ahora", async () => {
      candidatos("t1");
      const conflicto = new Prisma.PrismaClientKnownRequestError("conflicto", {
        code: "P2034",
        clientVersion: "test",
      });
      (prisma.$transaction as unknown as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(conflicto)
        .mockImplementation((fn: unknown) => (fn as (t: unknown) => unknown)(tx));
      // ya con la carga nueva que llenó el lugar que liberaba la vencida
      viajeEnTx({
        status: "FULL",
        capacityTotal: 30,
        cargoItems: [
          vencida({ id: "i1", volume: 10 }),
          vencida({ id: "i2", volume: 20, status: "CONFIRMED" }),
          baseCargoItem({ id: "nueva", volume: 10, createdAt: AHORA, payments: [] }),
        ],
      });

      expect(await tripsService.releaseExpiredReservations(AHORA)).toBe(1);

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(canceladas()).toEqual(["i1"]);
      // 20 confirmados + 10 de la nueva = 30: sigue FULL
      expect(tx.trip.update).not.toHaveBeenCalled();
    });

    it("un viaje que falla no corta la corrida y el log no lleva el mensaje", async () => {
      candidatos("t1", "t2");
      tx.trip.findUnique
        .mockRejectedValueOnce(new Error("detalle de la base con datos"))
        .mockResolvedValueOnce(
          baseTrip({ id: "t2", cargoItems: [vencida({ id: "i2" })] })
        );

      expect(await tripsService.releaseExpiredReservations(AHORA)).toBe(1);

      expect(canceladas()).toEqual(["i2"]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain("datos");
    });

    it("listar viajes ya no libera reservas: lo hace el scheduler", async () => {
      (prisma.trip.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await tripsService.listOpenTrips();

      expect(prisma.cargoItem.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("mirar un viaje tampoco libera reservas", async () => {
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseTrip({ carrier: { name: "Flete" }, reviews: [] })
      );

      await tripsService.getTripById("t1", null);

      expect(prisma.cargoItem.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("getTripById y la disponibilidad", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    });

    async function detalleDe(overrides: Record<string, unknown>) {
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseTrip({ carrier: { name: "Flete" }, reviews: [], ...overrides })
      );
      return tripsService.getTripById("t1", null);
    }

    it("el detalle de un viaje de mañana llega con acceptsCargo", async () => {
      const trip = await detalleDe({ date: futureTripDate(1) });

      expect(trip.acceptsCargo).toBe(true);
    });

    it("el detalle de un viaje de hoy llega con el estado real y sin carga", async () => {
      // el detalle es lo que lee la pantalla del viaje: sin acceptsCargo el
      // formulario de sumar carga se escondería siempre (o nunca).
      const trip = await detalleDe({ date: new Date(), status: "OPEN" });

      expect(trip.status).toBe("OPEN");
      expect(trip.acceptsCargo).toBe(false);
    });

    it("un viaje de fecha futura que ya está IN_TRANSIT tampoco acepta carga", async () => {
      const trip = await detalleDe({ date: futureTripDate(2), status: "IN_TRANSIT" });

      expect(trip.acceptsCargo).toBe(false);
    });
  });

  describe("createTrip", () => {
    beforeEach(() => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        verificationStatus: "VERIFIED",
        mpUserId: "mp-user-123",
        mpAccessToken: "access-token-123",
      } as never);
    });

    it("crea el viaje con precio Decimal y estado OPEN", async () => {
      (prisma.trip.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseTrip()
      );

      const result = await tripsService.createTrip("u1", {
        origin: "Córdoba",
        destination: "Rosario",
        date: new Date("2026-10-01T10:00:00.000Z"),
        departureTime: "08:00",
        truckType: "Semi",
        capacityTotal: 30,
        price: 1500,
        depositPercent: 20,
        features: [],
      });

      expect(prisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            carrierId: "u1",
            origin: "Córdoba",
            price: expect.any(Prisma.Decimal),
          }),
        })
      );
      expect(result.status).toBe("OPEN");
      expect(result.capacityUsed).toBe(0);
    });

    it("persiste los features y los devuelve en el resumen", async () => {
      (prisma.trip.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseTrip({ features: ["seguro", "expreso"] })
      );

      const result = await tripsService.createTrip("u1", {
        origin: "Córdoba",
        destination: "Rosario",
        date: new Date("2026-10-01T10:00:00.000Z"),
        departureTime: "08:00",
        truckType: "Semi",
        capacityTotal: 30,
        price: 1500,
        depositPercent: 20,
        features: ["seguro", "expreso"],
      });

      expect(prisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            features: ["seguro", "expreso"],
          }),
        })
      );
      expect(result.features).toEqual(["seguro", "expreso"]);
    });
  });

  describe("updateTripStatus", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (fn: unknown) => (fn as (t: unknown) => unknown)(tx)
      );
      // el update devuelve el viaje que se leyó, con el estado nuevo: los avisos
      // usan los datos (origen/destino) que leió el servicio.
      tx.trip.update.mockImplementation(async ({ data }: { data: unknown }) => {
        const found = (await tx.trip.findUnique.mock.results.at(-1)?.value) as
          Record<string, unknown> | undefined;
        return { ...(found ?? baseTrip()), ...(data as object), carrier: baseCarrier() };
      });
      tx.payment.upsert.mockResolvedValue({});
      // sin cargas para notificar salvo que el test diga otra cosa
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);
    });

    /** carga confirmada con su seña abonada, la que genera saldo al salir */
    function confirmedWithDeposit(overrides: Record<string, unknown> = {}) {
      return baseCargoItem({
        status: "CONFIRMED",
        company: {
          id: "c1",
          name: "Empresa Uno",
          email: "uno@empresa.com",
          emailNotifications: true,
        },
        payments: [
          basePayment({ type: "DEPOSIT", amount: new Prisma.Decimal("100.00") }),
        ],
        ...overrides,
      });
    }

    it("avanza FULL → IN_TRANSIT", async () => {
      tx.trip.findUnique.mockResolvedValue(baseTrip({ status: "FULL" }));

      const result = await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      expect(tx.trip.update).toHaveBeenCalledWith({
        where: { id: "t1" },
        data: { status: "IN_TRANSIT" },
        include: { cargoItems: true, carrier: { select: { name: true } } },
      });
      expect(result.status).toBe("IN_TRANSIT");
    });

    it("crea el pago BALANCE de cada carga confirmada al salir el viaje", async () => {
      // 500 de carga − 100 de seña = 400 de saldo
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({ status: "FULL", cargoItems: [confirmedWithDeposit()] })
      );

      await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      expect(tx.payment.upsert).toHaveBeenCalledWith({
        where: { cargoItemId_type: { cargoItemId: "i1", type: "BALANCE" } },
        create: { cargoItemId: "i1", amount: 400, type: "BALANCE" },
        update: {},
      });
    });

    it("no crea saldo para una carga que quedó reservada sin confirmar", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "FULL",
          cargoItems: [
            baseCargoItem({
              company: {
                id: "c1",
                name: "Uno",
                email: "u@e.com",
                emailNotifications: true,
              },
              payments: [],
            }),
          ],
        })
      );

      await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      expect(tx.payment.upsert).not.toHaveBeenCalled();
    });

    it("no crea saldo cuando la seña ya cubría el total", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "FULL",
          cargoItems: [
            confirmedWithDeposit({ depositAmount: new Prisma.Decimal("500.00") }),
          ],
        })
      );

      await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      expect(tx.payment.upsert).not.toHaveBeenCalled();
    });

    it("no reinicia un saldo pendiente que ya existía", async () => {
      // la transición es atómica: si el saldo ya está PENDING es que otro intento
      // anterior creó el pago. el upsert con update vacío lo deja como está (la
      // empresa puede tener el link de este mismo monto) y el aviso se reenvía
      // porque los avisos salen después del commit.
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "FULL",
          cargoItems: [
            confirmedWithDeposit({
              payments: [
                basePayment({ type: "DEPOSIT" }),
                basePayment({
                  id: "pay2",
                  type: "BALANCE",
                  status: "PENDING",
                  amount: new Prisma.Decimal("400.00"),
                }),
              ],
            }),
          ],
        })
      );

      await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      expect(tx.payment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: {} })
      );
      // el aviso se vuelve a mandar: la empresa puede no haberlo visto
      expect(notifyUsers).toHaveBeenCalledTimes(1);
      expect(avisoA("c1").type).toBe("BALANCE_DUE");
    });

    it("no crea ni anuncia un saldo que ya está pagado", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "FULL",
          cargoItems: [
            confirmedWithDeposit({
              payments: [
                basePayment({ type: "DEPOSIT" }),
                basePayment({ id: "pay2", type: "BALANCE", status: "APPROVED" }),
              ],
            }),
          ],
        })
      );

      await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      expect(tx.payment.upsert).not.toHaveBeenCalled();
      expect(
        vi
          .mocked(notifyUsers)
          .mock.calls.filter(([, data]) => data.type === "BALANCE_DUE")
      ).toHaveLength(0);
    });

    it("avisa a la empresa que tiene saldo pendiente", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "FULL",
          origin: "Córdoba",
          destination: "Rosario",
          cargoItems: [confirmedWithDeposit()],
        })
      );

      await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      const aviso = avisoA("c1");
      expect(aviso.type).toBe("BALANCE_DUE");
      expect(aviso.tripId).toBe("t1");
      // la campanita lleva el saldo (lo accionable); el desglose va en el email
      expect(aviso.title).toContain("falta pagar el saldo de tu carga");
      expect(aviso.body).toContain("quedan $400 de saldo de $500");
      expect(aviso.email?.html).toContain("solo falta el saldo de $400,00");
    });

    it("agrupa en un solo email el saldo de varias cargas de la misma empresa", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "FULL",
          origin: "Córdoba",
          destination: "Rosario",
          cargoItems: [
            confirmedWithDeposit(),
            confirmedWithDeposit({
              id: "i2",
              description: "Vigas",
              priceShare: new Prisma.Decimal("300.00"),
              depositAmount: new Prisma.Decimal("60.00"),
            }),
          ],
        })
      );

      await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      // un aviso, con la suma: 400+240 de saldo sobre 500+300 de viaje
      const avisos = vi
        .mocked(notifyUsers)
        .mock.calls.filter(([, data]) => data.type === "BALANCE_DUE");
      expect(avisos).toHaveLength(1);
      const aviso = avisoA("c1");
      expect(aviso.body).toContain("quedan $640 de saldo de $800");
      expect(aviso.email?.html).toContain("los saldos de $640,00");
      expect(aviso.email?.html).toContain("tus cargas (maquinaria, vigas)");
    });

    it("avanza IN_TRANSIT → COMPLETED", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "IN_TRANSIT",
          cargoItems: [
            confirmedWithDeposit({
              payments: [
                basePayment({ type: "DEPOSIT" }),
                basePayment({ id: "pay2", type: "BALANCE", status: "APPROVED" }),
              ],
            }),
          ],
        })
      );

      const result = await tripsService.updateTripStatus("t1", "u1", "COMPLETED");
      expect(result.status).toBe("COMPLETED");
    });

    it("no completa el viaje con saldos sin pagar (409 BALANCE_PENDING)", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "IN_TRANSIT",
          cargoItems: [
            confirmedWithDeposit({
              payments: [
                basePayment({ type: "DEPOSIT" }),
                basePayment({ id: "pay2", type: "BALANCE", status: "PENDING" }),
              ],
            }),
            confirmedWithDeposit({
              id: "i2",
              company: {
                id: "c2",
                name: "Dos",
                email: "d@e.com",
                emailNotifications: true,
              },
            }),
          ],
        })
      );

      await expect(tripsService.updateTripStatus("t1", "u1", "COMPLETED")).rejects.toMatchObject({
        statusCode: 409,
        code: "BALANCE_PENDING",
      });
      expect(tx.trip.update).not.toHaveBeenCalled();
    });

    it("un saldo con contracargo bloquea el COMPLETED (409 BALANCE_CHARGED_BACK)", async () => {
      // MP revirtió el saldo: no es un saldo "por pagar" (la empresa no puede
      // volver a pagarlo), lo resuelve un admin
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "IN_TRANSIT",
          cargoItems: [
            confirmedWithDeposit({
              payments: [
                basePayment({ type: "DEPOSIT" }),
                basePayment({ id: "pay2", type: "BALANCE", status: "CHARGED_BACK" }),
              ],
            }),
          ],
        })
      );

      await expect(tripsService.updateTripStatus("t1", "u1", "COMPLETED")).rejects.toMatchObject({
        statusCode: 409,
        code: "BALANCE_CHARGED_BACK",
      });
      expect(tx.trip.update).not.toHaveBeenCalled();
    });

    it("completa igual si lo que queda es una carga retirada", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "IN_TRANSIT",
          cargoItems: [
            baseCargoItem({
              status: "CANCELLED",
              company: {
                id: "c1",
                name: "Uno",
                email: "u@e.com",
                emailNotifications: true,
              },
            }),
          ],
        })
      );

      const result = await tripsService.updateTripStatus("t1", "u1", "COMPLETED");
      expect(result.status).toBe("COMPLETED");
    });

    it("lanza InvalidTransitionError para transiciones inválidas", async () => {
      tx.trip.findUnique.mockResolvedValue(baseTrip({ status: "OPEN" }));

      await expect(tripsService.updateTripStatus("t1", "u1", "COMPLETED")).rejects.toBeInstanceOf(
        InvalidTransitionError
      );
    });

    it("lanza FORBIDDEN si no es el transportista dueño", async () => {
      tx.trip.findUnique.mockResolvedValue(baseTrip({ carrierId: "otro" }));

      await expect(tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT")).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
      expect(tx.trip.update).not.toHaveBeenCalled();
    });

    it("avisa a IN_TRANSIT a cada empresa con carga, una vez por empresa", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "FULL",
          origin: "Córdoba",
          destination: "Rosario",
          carrier: baseCarrier(),
        })
      );
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([
        { description: "Maquinaria", companyId: "c1" },
        { description: "Acero", companyId: "c1" },
        { description: "Vidrio", companyId: "c2" },
      ]);

      await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      // 2 avisos, uno por empresa: la de 2 cargas no recibe dos
      const avisos = vi
        .mocked(notifyUsers)
        .mock.calls.filter(([, data]) => data.type === "TRIP_STATUS_CHANGED");
      expect(avisos).toHaveLength(2);
      expect(avisos.map(([ids]) => ids)).toEqual([["c1"], ["c2"]]);

      const aviso = avisoA("c1");
      expect(aviso.tripId).toBe("t1");
      expect(aviso.title).toBe("tu viaje va en camino: Córdoba → Rosario");
      expect(aviso.body).toContain("salió, donde va tu carga maquinaria");
      // el aviso nombra la carga; el email trae la ruta y el transportista
      expect(aviso.email?.subject).toBe("tu viaje va en camino: Córdoba → Rosario");
      expect(aviso.email?.html).toContain("Transportes Flete");
    });

    it("avisa a COMPLETED a las empresas con carga", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({
          status: "IN_TRANSIT",
          origin: "Córdoba",
          destination: "Rosario",
          carrier: baseCarrier(),
        })
      );
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([{ description: "Maquinaria", companyId: "c1" }]);

      await tripsService.updateTripStatus("t1", "u1", "COMPLETED");

      const aviso = avisoA("c1");
      expect(aviso.type).toBe("TRIP_STATUS_CHANGED");
      expect(aviso.title).toBe("tu viaje se completó: Córdoba → Rosario");
      expect(aviso.body).toContain("llegó a destino");
      expect(aviso.email?.subject).toBe("tu viaje se completó: Córdoba → Rosario");
    });

    it("no avisa a nadie si el viaje no tiene cargas", async () => {
      tx.trip.findUnique.mockResolvedValue(baseTrip({ status: "FULL" }));

      await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      expect(notifyUsers).not.toHaveBeenCalled();
    });

    it("cambia el estado aunque el aviso a las empresas falle", async () => {
      tx.trip.findUnique.mockResolvedValue(baseTrip({ status: "FULL" }));
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([{ description: "Maquinaria", companyId: "c1" }]);
      vi.mocked(notifyUsers).mockRejectedValueOnce(new Error("la base de avisos cayó"));

      const result = await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");
      expect(result.status).toBe("IN_TRANSIT");
    });

    it("crea el saldo y cambia el estado en la misma transacción", async () => {
      tx.trip.findUnique.mockResolvedValue(
        baseTrip({ status: "FULL", cargoItems: [confirmedWithDeposit()] })
      );

      await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

      // si el cobro del saldo fallara, el viaje no debería quedar en camino.
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object)
      );
    });

    // D3 (= a): al salir el viaje, lo que no se confirmó no viaja. Las cargas
    // PENDING se cancelan en la misma TX; la seña cobrada vuelve entera por el
    // outbox (la cancelación no es de la empresa, no hay penalidad).
    describe("IN_TRANSIT cancela las cargas PENDING (D3)", () => {
      const empresa = (id: string) => ({
        id,
        name: `Empresa ${id}`,
        email: `${id}@empresa.com`,
        emailNotifications: true,
      });

      /** pendiente con la seña acreditada (el fletero no llegó a confirmarla) */
      const pendienteConSeña = () =>
        baseCargoItem({
          id: "i2",
          companyId: "c2",
          description: "Acero",
          company: empresa("c2"),
          payments: [
            basePayment({
              id: "pay2",
              cargoItemId: "i2",
              amount: new Prisma.Decimal("100.00"),
              mpPaymentId: "mp-2",
            }),
          ],
        });

      /** pendiente sin pago: reservó y nunca pagó la seña */
      const pendienteSinSeña = () =>
        baseCargoItem({
          id: "i3",
          companyId: "c3",
          description: "Vidrio",
          company: empresa("c3"),
          payments: [],
        });

      const viajeConLasTres = () =>
        baseTrip({
          status: "FULL",
          origin: "Córdoba",
          destination: "Rosario",
          cargoItems: [confirmedWithDeposit(), pendienteConSeña(), pendienteSinSeña()],
        });

      beforeEach(() => {
        tx.trip.findUnique.mockResolvedValue(viajeConLasTres());
        tx.cargoItem.update.mockImplementation(
          async ({ where, data }: { where: { id: string }; data: object }) => ({
            id: where.id,
            ...data,
          })
        );
        tx.payment.updateMany.mockResolvedValue({ count: 1 });
        tx.refundRequest.create = vi.fn().mockResolvedValue({});
      });

      /** las cargas que quedaron CANCELLED, con lo que se asentó */
      const canceladas = () =>
        tx.cargoItem.update.mock.calls.map((call) => {
          const arg = call[0] as { where: { id: string }; data: Record<string, unknown> };
          return {
            id: arg.where.id,
            status: arg.data.status,
            fee: Number(arg.data.cancellationFeeAmount),
          };
        });

      it("1 CONFIRMED + 1 PENDING con seña + 1 sin seña: saldo solo para la confirmada, 100 % a la segunda, ninguna queda PENDING", async () => {
        await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

        // el saldo, solo para la confirmada
        expect(tx.payment.upsert).toHaveBeenCalledTimes(1);
        expect(tx.payment.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { cargoItemId_type: { cargoItemId: "i1", type: "BALANCE" } },
          })
        );
        // las dos pendientes, canceladas sin penalidad
        expect(canceladas()).toEqual([
          { id: "i2", status: "CANCELLED", fee: 0 },
          { id: "i3", status: "CANCELLED", fee: 0 },
        ]);
        // la seña cobrada vuelve entera por el outbox; sin seña no hay nada
        expect(tx.refundRequest.create).toHaveBeenCalledTimes(1);
        expect(tx.refundRequest.create).toHaveBeenCalledWith({
          data: {
            cargoItemId: "i2",
            targetAmount: new Prisma.Decimal("100.00"),
            status: "PENDING",
          },
        });
        // todo en la misma TX que el cambio de estado
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.trip.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: "IN_TRANSIT" } })
        );
      });

      it("después de la TX procesa la devolución (best-effort)", async () => {
        await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

        expect(prisma.refundRequest.findUnique).toHaveBeenCalledWith({
          where: { cargoItemId: "i2" },
        });
        expect(prisma.refundRequest.findUnique).not.toHaveBeenCalledWith({
          where: { cargoItemId: "i3" },
        });
      });

      it("seña por acreditarse: se cancela sin devolución y fija la fila de la seña (CAS)", async () => {
        // si MP la aprueba después, el webhook ve la carga CANCELLED con fee 0 y
        // la devuelve entera (refundIfCancelled)
        tx.trip.findUnique.mockResolvedValue(
          baseTrip({
            status: "FULL",
            cargoItems: [
              baseCargoItem({
                company: empresa("c1"),
                payments: [basePayment({ status: "PENDING", mpPaymentId: null })],
              }),
            ],
          })
        );

        await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

        expect(tx.payment.updateMany).toHaveBeenCalledWith({
          where: { id: "pay1", status: "PENDING" },
          data: { updatedAt: expect.any(Date) },
        });
        expect(canceladas()).toEqual([{ id: "i1", status: "CANCELLED", fee: 0 }]);
        expect(tx.refundRequest.create).not.toHaveBeenCalled();
      });

      it("si el webhook aprobó la seña en el medio, reintenta y la devuelve entera", async () => {
        const conSeñaPendiente = baseTrip({
          status: "FULL",
          cargoItems: [
            baseCargoItem({
              company: empresa("c1"),
              payments: [
                basePayment({ status: "PENDING", amount: new Prisma.Decimal("100.00") }),
              ],
            }),
          ],
        });
        const conSeñaAprobada = baseTrip({
          status: "FULL",
          cargoItems: [
            baseCargoItem({
              company: empresa("c1"),
              payments: [basePayment({ amount: new Prisma.Decimal("100.00") })],
            }),
          ],
        });
        tx.trip.findUnique
          .mockResolvedValueOnce(conSeñaPendiente)
          .mockResolvedValue(conSeñaAprobada);
        // el CAS sobre la seña leída PENDING no encuentra la fila: ya está APPROVED
        tx.payment.updateMany
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValue({ count: 1 });

        await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(tx.refundRequest.create).toHaveBeenCalledTimes(1);
        expect(tx.refundRequest.create).toHaveBeenCalledWith({
          data: {
            cargoItemId: "i1",
            targetAmount: new Prisma.Decimal("100.00"),
            status: "PENDING",
          },
        });
      });

      it("reintenta ante un conflicto de serialización (P2034)", async () => {
        const conflicto = new Prisma.PrismaClientKnownRequestError("conflicto", {
          code: "P2034",
          clientVersion: "test",
        });
        (prisma.$transaction as unknown as ReturnType<typeof vi.fn>)
          .mockRejectedValueOnce(conflicto)
          .mockImplementation((fn: unknown) => (fn as (t: unknown) => unknown)(tx));

        const result = await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(result.status).toBe("IN_TRANSIT");
      });

      it("si la seña sigue moviéndose en cada intento: 409 PAYMENT_IN_FLIGHT, sin avisos", async () => {
        tx.payment.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT")
        ).rejects.toMatchObject({ statusCode: 409, code: "PAYMENT_IN_FLIGHT" });
        expect(notifyUsers).not.toHaveBeenCalled();
      });

      it("«va en camino» solo a las cargas activas; a las canceladas, CARGO_CANCELLED con la devolución", async () => {
        await tripsService.updateTripStatus("t1", "u1", "IN_TRANSIT");

        // el aviso de estado se arma solo con las cargas que viajan
        expect(prisma.cargoItem.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { tripId: "t1", status: "CONFIRMED" } })
        );

        const cancelaciones = vi
          .mocked(notifyUsers)
          .mock.calls.filter(([, data]) => data.type === "CARGO_CANCELLED");
        expect(cancelaciones.map(([ids]) => ids)).toEqual([["c2"], ["c3"]]);

        const conSeña = avisoA("c2");
        expect(conSeña.tripId).toBe("t1");
        expect(conSeña.title).toBe("tu carga se canceló: Córdoba → Rosario");
        expect(conSeña.body).toContain("acero");
        expect(conSeña.body).toContain("te devolvemos la seña entera ($100)");

        const sinSeña = avisoA("c3");
        expect(sinSeña.body).toContain("vidrio");
        expect(sinSeña.body).not.toContain("$");
      });

      it("COMPLETED no cancela nada", async () => {
        tx.trip.findUnique.mockResolvedValue(
          baseTrip({
            status: "IN_TRANSIT",
            cargoItems: [
              confirmedWithDeposit({
                payments: [
                  basePayment({ type: "DEPOSIT" }),
                  basePayment({ id: "pay2", type: "BALANCE", status: "APPROVED" }),
                ],
              }),
            ],
          })
        );

        await tripsService.updateTripStatus("t1", "u1", "COMPLETED");

        expect(tx.cargoItem.update).not.toHaveBeenCalled();
        expect(tx.refundRequest.create).not.toHaveBeenCalled();
      });
    });

    // D6 (= a): el fletero cancela un viaje que todavía no salió. Las cargas
    // activas se cancelan con la seña cobrada devuelta entera (cancelCargoForTrip,
    // el mismo camino que D3). La auto-cancelación (b) es del scheduler (Tanda 2).
    describe("CANCELLED: el fletero cancela el viaje (D6)", () => {
      const empresa = (id: string) => ({
        id,
        name: `Empresa ${id}`,
        email: `${id}@empresa.com`,
        emailNotifications: true,
      });

      const seña = (id: string, cargoItemId: string, overrides = {}) =>
        basePayment({
          id,
          cargoItemId,
          amount: new Prisma.Decimal("100.00"),
          mpPaymentId: `mp-${id}`,
          ...overrides,
        });

      /** confirmada con seña, pendiente con seña y pendiente sin pagar */
      const cargas = () => [
        baseCargoItem({
          id: "i1",
          status: "CONFIRMED",
          companyId: "c1",
          description: "Maquinaria",
          company: empresa("c1"),
          payments: [seña("pay1", "i1")],
        }),
        baseCargoItem({
          id: "i2",
          companyId: "c2",
          description: "Acero",
          company: empresa("c2"),
          payments: [seña("pay2", "i2")],
        }),
        baseCargoItem({
          id: "i3",
          companyId: "c3",
          description: "Vidrio",
          company: empresa("c3"),
          payments: [],
        }),
        // la que la empresa ya había retirado no se toca de nuevo
        baseCargoItem({
          id: "i4",
          status: "CANCELLED",
          companyId: "c4",
          company: empresa("c4"),
          payments: [],
        }),
      ];

      const viaje = (status: string) =>
        baseTrip({
          status,
          origin: "Córdoba",
          destination: "Rosario",
          cargoItems: cargas(),
        });

      beforeEach(() => {
        tx.cargoItem.update.mockImplementation(
          async ({ where, data }: { where: { id: string }; data: object }) => ({
            id: where.id,
            ...data,
          })
        );
        tx.payment.updateMany.mockResolvedValue({ count: 1 });
        tx.refundRequest.create = vi.fn().mockResolvedValue({});
      });

      const canceladas = () =>
        tx.cargoItem.update.mock.calls.map((call) => {
          const arg = call[0] as { where: { id: string }; data: Record<string, unknown> };
          return {
            id: arg.where.id,
            status: arg.data.status,
            fee: Number(arg.data.cancellationFeeAmount),
          };
        });

      it.each([["OPEN"], ["FULL"]])(
        "desde %s cancela las cargas activas y devuelve entera cada seña cobrada",
        async (desde) => {
          tx.trip.findUnique.mockResolvedValue(viaje(desde));

          const result = await tripsService.updateTripStatus("t1", "u1", "CANCELLED");

          expect(result.status).toBe("CANCELLED");
          expect(tx.trip.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: "CANCELLED" } })
          );
          // confirmadas y pendientes, sin penalidad; la ya retirada no se toca
          expect(canceladas()).toEqual([
            { id: "i1", status: "CANCELLED", fee: 0 },
            { id: "i2", status: "CANCELLED", fee: 0 },
            { id: "i3", status: "CANCELLED", fee: 0 },
          ]);
          expect(tx.refundRequest.create.mock.calls.map(([arg]) => arg)).toEqual([
            {
              data: {
                cargoItemId: "i1",
                targetAmount: new Prisma.Decimal("100.00"),
                status: "PENDING",
              },
            },
            {
              data: {
                cargoItemId: "i2",
                targetAmount: new Prisma.Decimal("100.00"),
                status: "PENDING",
              },
            },
          ]);
          // un viaje cancelado no cobra saldos
          expect(tx.payment.upsert).not.toHaveBeenCalled();
          expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        }
      );

      it.each([["IN_TRANSIT"], ["COMPLETED"], ["CANCELLED"]])(
        "desde %s no se cancela (409 INVALID_STATUS_TRANSITION)",
        async (desde) => {
          tx.trip.findUnique.mockResolvedValue(viaje(desde));

          await expect(
            tripsService.updateTripStatus("t1", "u1", "CANCELLED")
          ).rejects.toMatchObject({ statusCode: 409, code: "INVALID_STATUS_TRANSITION" });
          expect(tx.trip.update).not.toHaveBeenCalled();
          expect(tx.cargoItem.update).not.toHaveBeenCalled();
          expect(tx.refundRequest.create).not.toHaveBeenCalled();
        }
      );

      it("solo el transportista del viaje lo cancela (403)", async () => {
        tx.trip.findUnique.mockResolvedValue(viaje("OPEN"));

        await expect(
          tripsService.updateTripStatus("t1", "otro-fletero", "CANCELLED")
        ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
        expect(tx.trip.update).not.toHaveBeenCalled();
        expect(tx.cargoItem.update).not.toHaveBeenCalled();
      });

      it("después de la TX procesa cada devolución (best-effort)", async () => {
        tx.trip.findUnique.mockResolvedValue(viaje("OPEN"));

        await tripsService.updateTripStatus("t1", "u1", "CANCELLED");

        for (const id of ["i1", "i2"]) {
          expect(prisma.refundRequest.findUnique).toHaveBeenCalledWith({
            where: { cargoItemId: id },
          });
        }
        expect(prisma.refundRequest.findUnique).not.toHaveBeenCalledWith({
          where: { cargoItemId: "i3" },
        });
      });

      it("avisa a cada empresa con carga activa qué se le devuelve; no manda «va en camino»", async () => {
        tx.trip.findUnique.mockResolvedValue(viaje("OPEN"));

        await tripsService.updateTripStatus("t1", "u1", "CANCELLED");

        const tipos = vi.mocked(notifyUsers).mock.calls.map(([, data]) => data.type);
        expect(tipos).not.toContain("TRIP_STATUS_CHANGED");
        const cancelaciones = vi
          .mocked(notifyUsers)
          .mock.calls.filter(([, data]) => data.type === "CARGO_CANCELLED");
        expect(cancelaciones.map(([ids]) => ids)).toEqual([["c1"], ["c2"], ["c3"]]);

        const conSeña = avisoA("c1");
        expect(conSeña.tripId).toBe("t1");
        expect(conSeña.title).toBe("se canceló el viaje: Córdoba → Rosario");
        expect(conSeña.body).toContain("canceló el viaje");
        expect(conSeña.body).toContain("maquinaria");
        expect(conSeña.body).toContain("te devolvemos la seña entera ($100)");

        const sinSeña = avisoA("c3");
        expect(sinSeña.body).toContain("vidrio");
        expect(sinSeña.body).not.toContain("$");
      });
    });

    describe("auto-cancelación: el viaje no salió 24 h después de la salida (D6)", () => {
      // 12/11 09:00 ART
      const AHORA = new Date("2026-11-12T12:00:00.000Z");

      let errorSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        // los viajes que lee la TX se encolan por test: un valor que un test no
        // consumió (porque no llegó a la TX) no puede pasar al siguiente
        tx.trip.findUnique.mockReset();
        tx.cargoItem.update.mockResolvedValue({});
        tx.payment.updateMany.mockReset().mockResolvedValue({ count: 1 });
        tx.refundRequest.create = vi.fn().mockResolvedValue({});
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      });

      afterEach(() => {
        tx.trip.findUnique.mockReset();
        tx.payment.updateMany.mockReset().mockResolvedValue({ count: 1 });
      });

      const empresa = (id: string) => ({
        id,
        name: `Empresa ${id}`,
        email: `${id}@empresa.com`,
        emailNotifications: true,
      });

      /** confirmada con seña, pendiente con seña y pendiente sin pagar */
      const cargas = () => [
        baseCargoItem({
          id: "i1",
          status: "CONFIRMED",
          companyId: "c1",
          description: "Maquinaria",
          company: empresa("c1"),
          payments: [basePayment({ id: "pay1", cargoItemId: "i1", mpPaymentId: "mp-1" })],
        }),
        baseCargoItem({
          id: "i2",
          companyId: "c2",
          description: "Acero",
          company: empresa("c2"),
          payments: [basePayment({ id: "pay2", cargoItemId: "i2", mpPaymentId: "mp-2" })],
        }),
        baseCargoItem({
          id: "i3",
          companyId: "c3",
          description: "Vidrio",
          company: empresa("c3"),
          payments: [],
        }),
      ];

      /** la búsqueda devuelve estos viajes; la TX lee el mismo viaje completo */
      type Viaje = ReturnType<typeof baseTrip> & { departureTime: string | null };

      function viajes(...trips: Viaje[]) {
        (prisma.trip.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          trips.map((t) => ({ id: t.id, date: t.date, departureTime: t.departureTime }))
        );
        for (const t of trips) tx.trip.findUnique.mockResolvedValueOnce(t);
      }

      function viaje(overrides: Record<string, unknown> = {}) {
        return baseTrip({
          origin: "Córdoba",
          destination: "Rosario",
          ...salidaEn(-24, AHORA.getTime()),
          cargoItems: cargas(),
          ...overrides,
        }) as Viaje;
      }

      const avisos = (type: string) =>
        vi.mocked(notifyUsers).mock.calls.filter(([, data]) => data.type === type);

      it("busca los viajes OPEN/FULL cuya fecha ya pasó, los más viejos primero", async () => {
        viajes();

        expect(await tripsService.autoCancelUndepartedTrips(AHORA)).toBe(0);

        expect(prisma.trip.findMany).toHaveBeenCalledWith({
          // el plazo vence 24 h después de la salida, y la salida nunca es más
          // de un día antes de `date`: con `date` en el futuro no hay nada que ver
          where: { status: { in: ["OPEN", "FULL"] }, date: { lte: AHORA } },
          select: { id: true, date: true, departureTime: true },
          orderBy: { date: "asc" },
          take: 100,
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it.each([["OPEN"], ["FULL"]])(
        "cancela el viaje %s a las 24 h exactas de la salida y devuelve entera cada seña cobrada",
        async (status) => {
          viajes(viaje({ status }));

          expect(await tripsService.autoCancelUndepartedTrips(AHORA)).toBe(1);

          expect(tx.trip.update).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { id: "t1" },
              data: { status: "CANCELLED" },
            })
          );
          expect(tx.cargoItem.update.mock.calls.map(([arg]) => arg.where.id)).toEqual([
            "i1",
            "i2",
            "i3",
          ]);
          expect(tx.refundRequest.create.mock.calls.map(([arg]) => arg.data)).toEqual([
            {
              cargoItemId: "i1",
              targetAmount: new Prisma.Decimal("100.00"),
              status: "PENDING",
            },
            {
              cargoItemId: "i2",
              targetAmount: new Prisma.Decimal("100.00"),
              status: "PENDING",
            },
          ]);
          // y después de la TX las procesa por el outbox
          for (const id of ["i1", "i2"]) {
            expect(prisma.refundRequest.findUnique).toHaveBeenCalledWith({
              where: { cargoItemId: id },
            });
          }
        }
      );

      it("a 23:59 h de la salida todavía no lo cancela", async () => {
        viajes(viaje(salidaEn(-24 + 1 / 60, AHORA.getTime())));

        expect(await tripsService.autoCancelUndepartedTrips(AHORA)).toBe(0);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it("un viaje viejo sin hora de salida cuenta desde las 23:59 ART de su día", async () => {
        // 10/11 (mediodía del navegador): salida 10/11 23:59 ART = 11/11 02:59Z
        const sinHora = () =>
          viaje({ date: new Date("2026-11-10T15:00:00.000Z"), departureTime: null });

        viajes(sinHora());
        expect(
          await tripsService.autoCancelUndepartedTrips(
            new Date("2026-11-12T02:58:00.000Z")
          )
        ).toBe(0);

        viajes(sinHora());
        expect(
          await tripsService.autoCancelUndepartedTrips(
            new Date("2026-11-12T02:59:00.000Z")
          )
        ).toBe(1);
      });

      it("avisa a cada empresa que el viaje no salió y qué se le devuelve", async () => {
        viajes(viaje());

        await tripsService.autoCancelUndepartedTrips(AHORA);

        const cancelaciones = avisos("CARGO_CANCELLED");
        expect(cancelaciones.map(([ids]) => ids)).toEqual([["c1"], ["c2"], ["c3"]]);
        const [, conSeña] = cancelaciones[0]!;
        expect(conSeña.title).toBe("se canceló el viaje: Córdoba → Rosario");
        expect(conSeña.body).toContain("no salió");
        expect(conSeña.body).toContain("maquinaria");
        expect(conSeña.body).toContain("te devolvemos la seña entera ($100)");
        expect(conSeña.body).not.toContain("canceló el viaje");
        const [, sinSeña] = cancelaciones[2]!;
        expect(sinSeña.body).not.toContain("$");
      });

      it("avisa al fletero solo in-app que se le canceló el viaje", async () => {
        viajes(viaje());

        await tripsService.autoCancelUndepartedTrips(AHORA);

        const alFletero = avisos("TRIP_STATUS_CHANGED");
        expect(alFletero).toHaveLength(1);
        const [ids, data] = alFletero[0]!;
        expect(ids).toEqual(["u1"]);
        expect(data).toMatchObject({
          title: "se canceló tu viaje: Córdoba → Rosario",
          tripId: "t1",
          email: false,
        });
        expect(data.body).toContain("24 h");
        expect(data.body).toContain("3 cargas");
      });

      it("también cancela un viaje sin cargas", async () => {
        viajes(viaje({ cargoItems: [] }));

        expect(await tripsService.autoCancelUndepartedTrips(AHORA)).toBe(1);

        expect(tx.trip.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: "CANCELLED" } })
        );
        expect(tx.refundRequest.create).not.toHaveBeenCalled();
        expect(avisos("CARGO_CANCELLED")).toHaveLength(0);
        const [, data] = avisos("TRIP_STATUS_CHANGED")[0]!;
        expect(data.body).toContain("no tenía cargas");
      });

      it.each([["IN_TRANSIT"], ["COMPLETED"], ["CANCELLED"]])(
        "si al releer el viaje está %s, no lo toca ni avisa",
        async (status) => {
          viajes(viaje({ status }));

          expect(await tripsService.autoCancelUndepartedTrips(AHORA)).toBe(0);

          expect(tx.trip.update).not.toHaveBeenCalled();
          expect(tx.cargoItem.update).not.toHaveBeenCalled();
          expect(notifyUsers).not.toHaveBeenCalled();
        }
      );

      it("relee el plazo dentro de la TX: si la salida cambió, no lo cancela", async () => {
        const original = viaje();
        (prisma.trip.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
          { id: "t1", date: original.date, departureTime: original.departureTime },
        ]);
        tx.trip.findUnique.mockResolvedValueOnce(viaje(salidaEn(-2, AHORA.getTime())));

        expect(await tripsService.autoCancelUndepartedTrips(AHORA)).toBe(0);
        expect(tx.trip.update).not.toHaveBeenCalled();
      });

      it("no exige que lo pida el fletero: lo cancela el sistema", async () => {
        viajes(viaje({ carrierId: "otro-fletero" }));

        expect(await tripsService.autoCancelUndepartedTrips(AHORA)).toBe(1);
        const [ids] = avisos("TRIP_STATUS_CHANGED")[0]!;
        expect(ids).toEqual(["otro-fletero"]);
      });

      it("si una seña se aprueba en el medio reintenta y la devuelve entera", async () => {
        const conSeñaPorAcreditarse = () =>
          viaje({
            cargoItems: [
              baseCargoItem({
                id: "i1",
                company: empresa("c1"),
                payments: [basePayment({ status: "PENDING", mpPaymentId: "mp-1" })],
              }),
            ],
          });
        viajes(conSeñaPorAcreditarse());
        tx.trip.findUnique.mockResolvedValueOnce(
          viaje({
            cargoItems: [
              baseCargoItem({
                id: "i1",
                company: empresa("c1"),
                payments: [basePayment()],
              }),
            ],
          })
        );
        tx.payment.updateMany.mockResolvedValueOnce({ count: 0 });

        expect(await tripsService.autoCancelUndepartedTrips(AHORA)).toBe(1);

        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(tx.refundRequest.create).toHaveBeenCalledTimes(1);
      });

      it("un viaje que falla no corta la corrida y el log no lleva el mensaje", async () => {
        const roto = viaje({ id: "t-roto" });
        const sano = viaje({ id: "t2", cargoItems: [] });
        (prisma.trip.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          [roto, sano].map((t) => ({
            id: t.id,
            date: t.date,
            departureTime: t.departureTime,
          }))
        );
        tx.trip.findUnique
          .mockRejectedValueOnce(new Error("detalle de la base con datos"))
          .mockResolvedValueOnce(sano);

        expect(await tripsService.autoCancelUndepartedTrips(AHORA)).toBe(1);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain("datos");
      });

      it("la cancelación manual del fletero sigue avisando que la canceló él", async () => {
        tx.trip.findUnique.mockResolvedValue(viaje({ date: futureTripDate(3) }));

        await tripsService.updateTripStatus("t1", "u1", "CANCELLED");

        const [, data] = avisos("CARGO_CANCELLED")[0]!;
        expect(data.body).toContain("canceló el viaje");
        expect(avisos("TRIP_STATUS_CHANGED")).toHaveLength(0);
      });
    });
  });

  describe("confirmCargoItem", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("el transportista dueño puede confirmar una carga", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(basePaidCargoItem());
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrierId: "u1",
      });
      (prisma.cargoItem.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        basePaidCargoItem({ status: "CONFIRMED" })
      );

      const result = await tripsService.confirmCargoItem("t1", "i1", "u1");

      expect(prisma.cargoItem.update).toHaveBeenCalledWith({
        where: { id: "i1", status: "PENDING" },
        data: { status: "CONFIRMED" },
        include: { payments: true },
      });
      expect(result.status).toBe("CONFIRMED");
    });

    it("avisa a la empresa dueña de la carga que se confirmó", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        basePaidCargoItem({
          company: {
            name: "Empresa Uno",
            email: "uno@empresa.com",
            emailNotifications: true,
          },
          trip: { origin: "Córdoba", destination: "Rosario", carrier: { name: "Flete" } },
        })
      );
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrierId: "u1",
      });
      (prisma.cargoItem.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        basePaidCargoItem({ status: "CONFIRMED" })
      );

      await tripsService.confirmCargoItem("t1", "i1", "u1");

      const aviso = avisoA("c1");
      expect(notifyUsers).toHaveBeenCalledTimes(1);
      expect(aviso.type).toBe("CARGO_CONFIRMED");
      expect(aviso.tripId).toBe("t1");
      expect(aviso.body).toContain("confirmamos maquinaria (10 m³)");
      expect(aviso.email?.subject).toBe("tu carga está confirmada: Córdoba → Rosario");
    });

    it("una carga retirada no se confirma: 409 CARGO_ITEM_CANCELLED", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(basePaidCargoItem({ status: "CANCELLED" }));
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrierId: "u1",
      });

      await expect(tripsService.confirmCargoItem("t1", "i1", "u1")).rejects.toMatchObject({
        statusCode: 409,
        code: "CARGO_ITEM_CANCELLED",
      });
      expect(prisma.cargoItem.update).not.toHaveBeenCalled();
      expect(notifyUsers).not.toHaveBeenCalled();
    });

    it("si la empresa la retiró entre la lectura y la confirmación: 409, no la revive", async () => {
      // el retiro commiteó después de que leímos la carga PENDING
      (prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(basePaidCargoItem())
        .mockResolvedValueOnce(basePaidCargoItem({ status: "CANCELLED" }));
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrierId: "u1",
      });
      (prisma.cargoItem.update as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Record to update not found", {
          code: "P2025",
          clientVersion: "test",
        })
      );

      await expect(tripsService.confirmCargoItem("t1", "i1", "u1")).rejects.toMatchObject({
        statusCode: 409,
        code: "CARGO_ITEM_CANCELLED",
      });
      // CAS: la confirmación solo pisa una carga que sigue PENDING
      expect(prisma.cargoItem.update).toHaveBeenCalledWith({
        where: { id: "i1", status: "PENDING" },
        data: { status: "CONFIRMED" },
        include: { payments: true },
      });
      expect(notifyUsers).not.toHaveBeenCalled();
    });

    it("confirma la carga aunque el aviso falle", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(basePaidCargoItem());
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrierId: "u1",
      });
      (prisma.cargoItem.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        basePaidCargoItem({ status: "CONFIRMED" })
      );
      vi.mocked(notifyUsers).mockRejectedValueOnce(new Error("la base de avisos cayó"));

      const result = await tripsService.confirmCargoItem("t1", "i1", "u1");
      expect(result.status).toBe("CONFIRMED");
    });

    it("no avisa a nadie si la carga ya estaba confirmada", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(basePaidCargoItem({ status: "CONFIRMED" }));

      const result = await tripsService.confirmCargoItem("t1", "i1", "u1");

      expect(result.status).toBe("CONFIRMED");
      expect(notifyUsers).not.toHaveBeenCalled();
    });

    it("la empresa dueña de la carga puede confirmarla", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(basePaidCargoItem({ companyId: "c1" }));
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrierId: "u1",
      });
      (prisma.cargoItem.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        basePaidCargoItem({ status: "CONFIRMED" })
      );

      const result = await tripsService.confirmCargoItem("t1", "i1", "c1");
      expect(result.status).toBe("CONFIRMED");
    });

    it("lanza FORBIDDEN para un tercero", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(basePaidCargoItem({ companyId: "c1" }));
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrierId: "u1",
      });

      await expect(tripsService.confirmCargoItem("t1", "i1", "x9")).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
      expect(prisma.cargoItem.update).not.toHaveBeenCalled();
    });

    it("lanza CargoItemNotFoundError si la carga no pertenece al viaje", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(basePaidCargoItem({ tripId: "otro-viaje" }));

      await expect(tripsService.confirmCargoItem("t1", "i1", "u1")).rejects.toBeInstanceOf(
        CargoItemNotFoundError
      );
    });

    it("lanza PAYMENT_REQUIRED (409) si la seña no está aprobada", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        baseCargoItem({ payments: [basePayment({ status: "PENDING" })] })
      );
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrierId: "u1",
      });

      await expect(tripsService.confirmCargoItem("t1", "i1", "u1")).rejects.toMatchObject({
        statusCode: 409,
        code: "PAYMENT_REQUIRED",
      });
      expect(prisma.cargoItem.update).not.toHaveBeenCalled();
    });

    it("lanza PAYMENT_REQUIRED (409) si la carga no tiene pago", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(baseCargoItem({ payments: [] }));
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrierId: "u1",
      });

      await expect(tripsService.confirmCargoItem("t1", "i1", "c1")).rejects.toMatchObject({
        statusCode: 409,
        code: "PAYMENT_REQUIRED",
      });
      expect(prisma.cargoItem.update).not.toHaveBeenCalled();
    });

    it("no acepta un saldo aprobado como si fuera la seña", async () => {
      // el saldo ni existe hasta que el viaje sale, así que un pago BALANCE
      // aprobado no confirma una carga pendiente.
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        baseCargoItem({ payments: [basePayment({ type: "BALANCE" })] })
      );
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrierId: "u1",
      });

      await expect(tripsService.confirmCargoItem("t1", "i1", "c1")).rejects.toMatchObject({
        statusCode: 409,
        code: "PAYMENT_REQUIRED",
      });
      expect(prisma.cargoItem.update).not.toHaveBeenCalled();
    });

    it("es idempotente si la carga ya está CONFIRMED", async () => {
      (
        prisma.cargoItem.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(basePaidCargoItem({ status: "CONFIRMED" }));

      const result = await tripsService.confirmCargoItem("t1", "i1", "u1");
      expect(result.status).toBe("CONFIRMED");
      expect(prisma.cargoItem.update).not.toHaveBeenCalled();
    });
  });

  describe("AppError", () => {
    it("expone statusCode y code", () => {
      const err = new AppError("nope", 403, "FORBIDDEN");
      expect(err).toBeInstanceOf(Error);
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
    });
  });

  describe("createReview", () => {
    const completedTrip = (cargoCompanyIds: string[], carrierId = "u1") => ({
      status: "COMPLETED",
      carrierId,
      cargoItems: cargoCompanyIds.map((companyId) => ({ companyId })),
    });

    const companyReview = {
      id: "r1",
      tripId: "t1",
      fromUserId: "u2",
      toUserId: "u1",
      rating: 5,
      comment: "puntual",
      createdAt: new Date(),
      fromUser: { name: "Comercial Norte" },
      toUser: { name: "Transportes Flete" },
    };

    it("no deja calificar al fletero del viaje (403)", async () => {
      await expect(
        tripsService.createReview("t1", "u1", "CARRIER", { rating: 5 })
      ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
      // el rol se corta antes de tocar la base: ni siquiera se busca el viaje
      expect(prisma.trip.findUnique).not.toHaveBeenCalled();
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it("no deja calificar a un admin (403)", async () => {
      await expect(
        tripsService.createReview("t1", "u0", "ADMIN", { rating: 5 })
      ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it("no deja calificar antes de que el viaje esté COMPLETED", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        status: "IN_TRANSIT",
        carrierId: "u1",
        cargoItems: [{ companyId: "u2" }],
      } as never);

      await expect(
        tripsService.createReview("t1", "u2", "COMPANY", { rating: 5 })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "TRIP_NOT_COMPLETED",
      });
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it("no deja calificar dos veces la misma dirección del mismo viaje", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(completedTrip(["u2"]) as never);
      vi.mocked(prisma.review.findUnique).mockResolvedValue(companyReview as never);

      await expect(
        tripsService.createReview("t1", "u2", "COMPANY", { rating: 5 })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "ALREADY_REVIEWED",
      });
      expect(prisma.review.create).not.toHaveBeenCalled();
      expect(prisma.review.findUnique).toHaveBeenCalledWith({
        where: {
          tripId_fromUserId_toUserId: { tripId: "t1", fromUserId: "u2", toUserId: "u1" },
        },
      });
    });

    it("no deja calificar a una empresa sin carga en el viaje (403)", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(completedTrip(["u2"]) as never);

      await expect(
        tripsService.createReview("t1", "u9", "COMPANY", { rating: 1 })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it("la empresa califica al fletero del viaje, sin pedirle el destinatario", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(completedTrip(["u2"]) as never);
      vi.mocked(prisma.review.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.review.create).mockResolvedValue(companyReview as never);

      const review = await tripsService.createReview("t1", "u2", "COMPANY", {
        rating: 5,
        comment: "puntual",
      });

      expect(prisma.review.create).toHaveBeenLastCalledWith({
        data: {
          tripId: "t1",
          fromUserId: "u2",
          toUserId: "u1",
          rating: 5,
          comment: "puntual",
        },
        // el nombre de la empresa ya no se pide: no sale en la respuesta (ítem 10)
        include: { toUser: { select: { name: true } } },
      });
      expect(review).toMatchObject({ toUserId: "u1", toName: "Transportes Flete" });
      expect(review).not.toHaveProperty("fromUserId");
      expect(review).not.toHaveProperty("fromName");
    });

    it("cada empresa del viaje califica al fletero aunque haya varias", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(
        completedTrip(["u2", "u3"]) as never
      );
      vi.mocked(prisma.review.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.review.create).mockResolvedValue(companyReview as never);

      await tripsService.createReview("t1", "u3", "COMPANY", { rating: 3 });
      expect(prisma.review.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ fromUserId: "u3", toUserId: "u1" }),
        })
      );
    });

    it("lanza 404 si el viaje no existe", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);
      await expect(
        tripsService.createReview("nope", "u2", "COMPANY", { rating: 5 })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "TRIP_NOT_FOUND",
      });
    });
  });

  describe("createTrip con verificación de identidad", () => {
    const data = {
      origin: "A",
      destination: "B",
      date: new Date(),
      departureTime: "08:00",
      truckType: "Semi",
      capacityTotal: 10,
      price: 1000,
      depositPercent: 20,
      features: [] as [],
    };

    beforeEach(() => {
      vi.mocked(prisma.trip.create).mockResolvedValue(baseTrip() as never);
    });

    it.each(["UNVERIFIED", "PENDING", "REJECTED"] as const)(
      "un transportista %s no puede publicar (403 CARRIER_NOT_VERIFIED)",
      async (status) => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
          verificationStatus: status,
        } as never);

        await expect(tripsService.createTrip("u1", data)).rejects.toMatchObject({
          statusCode: 403,
          code: "CARRIER_NOT_VERIFIED",
        });
        expect(prisma.trip.create).not.toHaveBeenCalled();
      }
    );

    it("un transportista VERIFIED sí puede publicar", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        verificationStatus: "VERIFIED",
        mpUserId: "mp-user-123",
        mpAccessToken: "access-token-123",
      } as never);

      const trip = await tripsService.createTrip("u1", data);
      expect(prisma.trip.create).toHaveBeenCalled();
      expect(trip.id).toBe("t1");
    });
  });

  describe("mensajería del viaje", () => {
    const carrier = { id: "u1", name: "Transportes Flete" };
    const companyUno = { id: "c1", name: "Empresa Uno" };
    const companyDos = { id: "c2", name: "Empresa Dos" };

    function mockTripWithCompanies(
      companies: { id: string; name: string }[],
      tripCarrier = carrier,
      // empresas que retiraron todas sus cargas (D9)
      formerCompanies: { id: string; name: string }[] = []
    ) {
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrier: tripCarrier,
        cargoItems: [
          ...companies.map((company) => ({ status: "CONFIRMED", company })),
          ...formerCompanies.map((company) => ({ status: "CANCELLED", company })),
        ],
      });
    }

    function baseMessage(overrides: Record<string, unknown> = {}) {
      return {
        id: "m1",
        tripId: "t1",
        fromUserId: "c1",
        toUserId: "u1",
        body: "hola, ¿a qué hora podemos descargar?",
        createdAt: new Date("2026-09-26T12:00:00.000Z"),
        readAt: null,
        fromUser: companyUno,
        toUser: carrier,
        ...overrides,
      };
    }

    beforeEach(() => {
      vi.clearAllMocks();
      (prisma.message.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        []
      );
      (prisma.message.create as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({
          id: "m1",
          createdAt: new Date("2026-09-26T12:00:00.000Z"),
          readAt: null,
          fromUser: data.fromUserId === "u1" ? carrier : companyUno,
          toUser: data.toUserId === "u1" ? carrier : companyUno,
          ...data,
        })
      );
      (
        prisma.message.updateMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        count: 2,
      });
    });

    describe("listTripMessages", () => {
      it("el transportista ve los mensajes del viaje, ordenados por fecha", async () => {
        mockTripWithCompanies([companyUno]);
        (
          prisma.message.findMany as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue([baseMessage()]);

        const result = await tripsService.listTripMessages("t1", "u1");

        // U8: el fletero lee sus conversaciones, no las que no lo incluyen
        expect(prisma.message.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { tripId: "t1", OR: [{ fromUserId: "u1" }, { toUserId: "u1" }] },
            orderBy: { createdAt: "asc" },
          })
        );
        expect(result.messages[0]).toMatchObject({
          id: "m1",
          body: "hola, ¿a qué hora podemos descargar?",
          fromName: "Empresa Uno",
          toName: "Transportes Flete",
          readAt: null,
        });
        expect(result.participants).toEqual({
          carrier,
          companies: [companyUno],
        });
      });

      it("U8: la empresa lee solo su conversación con el fletero", async () => {
        mockTripWithCompanies([companyUno, companyDos]);
        const result = await tripsService.listTripMessages("t1", "c2");

        expect(prisma.message.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              tripId: "t1",
              OR: [
                { fromUserId: "c2", toUserId: "u1" },
                { fromUserId: "u1", toUserId: "c2" },
              ],
            },
          })
        );
        expect(result.messages).toEqual([]);
        // tampoco se entera de qué otras empresas cargan en el viaje
        expect(result.participants).toEqual({ carrier, companies: [] });
      });

      it("D9: la empresa que retiró su carga sigue leyendo su conversación", async () => {
        mockTripWithCompanies([companyUno], carrier, [companyDos]);
        await tripsService.listTripMessages("t1", "c2");

        expect(prisma.message.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              tripId: "t1",
              OR: [
                { fromUserId: "c2", toUserId: "u1" },
                { fromUserId: "u1", toUserId: "c2" },
              ],
            },
          })
        );
      });

      it("D9: el selector del fletero incluye a la que retiró su carga", async () => {
        mockTripWithCompanies([companyUno], carrier, [companyDos]);
        const result = await tripsService.listTripMessages("t1", "u1");
        expect(result.participants.companies).toEqual([companyUno, companyDos]);
      });

      it("un usuario que no participa recibe 403", async () => {
        mockTripWithCompanies([companyUno]);
        await expect(tripsService.listTripMessages("t1", "c9")).rejects.toMatchObject({
          statusCode: 403,
          code: "FORBIDDEN",
        });
        expect(prisma.message.findMany).not.toHaveBeenCalled();
      });

      it("una empresa sin carga en el viaje recibe 403", async () => {
        mockTripWithCompanies([companyUno]);
        await expect(tripsService.listTripMessages("t1", "c2")).rejects.toMatchObject({
          statusCode: 403,
          code: "FORBIDDEN",
        });
      });

      it("si el viaje no existe da 404", async () => {
        (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
          null
        );
        await expect(tripsService.listTripMessages("nope", "u1")).rejects.toBeInstanceOf(
          TripNotFoundError
        );
      });
    });

    describe("createTripMessage", () => {
      it("la empresa le escribe al transportista", async () => {
        mockTripWithCompanies([companyUno]);

        const message = await tripsService.createTripMessage("t1", "c1", {
          body: "  ¿a qué hora podés llegar?  ",
          toUserId: "u1",
        });

        expect(prisma.message.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              tripId: "t1",
              fromUserId: "c1",
              toUserId: "u1",
              body: "¿a qué hora podés llegar?",
            },
          })
        );
        expect(message).toMatchObject({
          id: "m1",
          fromUserId: "c1",
          toUserId: "u1",
          readAt: null,
        });
      });

      it("el transportista le escribe a una de las empresas", async () => {
        mockTripWithCompanies([companyUno, companyDos]);

        const message = await tripsService.createTripMessage("t1", "u1", {
          body: "salgo mañana temprano",
          toUserId: "c2",
        });

        expect(message).toMatchObject({ fromUserId: "u1", toUserId: "c2" });
      });

      it("no se puede mandar a alguien que no participa del viaje", async () => {
        mockTripWithCompanies([companyUno]);

        await expect(
          tripsService.createTripMessage("t1", "u1", { body: "hola", toUserId: "c9" })
        ).rejects.toMatchObject({ statusCode: 403, code: "NOT_A_PARTICIPANT" });
        expect(prisma.message.create).not.toHaveBeenCalled();
      });

      it("U8: una empresa no le puede escribir a otra empresa del viaje", async () => {
        mockTripWithCompanies([companyUno, companyDos]);

        await expect(
          tripsService.createTripMessage("t1", "c1", { body: "hola", toUserId: "c2" })
        ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
        expect(prisma.message.create).not.toHaveBeenCalled();
      });

      it("D9: la empresa que retiró su carga le escribe al fletero", async () => {
        mockTripWithCompanies([companyUno], carrier, [companyDos]);

        const message = await tripsService.createTripMessage("t1", "c2", {
          body: "¿cuándo vuelve la seña?",
          toUserId: "u1",
        });
        expect(message).toMatchObject({ fromUserId: "c2", toUserId: "u1" });
      });

      it("D9: la empresa que retiró su carga no le escribe a otra empresa", async () => {
        mockTripWithCompanies([companyUno], carrier, [companyDos]);

        await expect(
          tripsService.createTripMessage("t1", "c2", { body: "hola", toUserId: "c1" })
        ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
        expect(prisma.message.create).not.toHaveBeenCalled();
      });

      it("D9: el fletero le contesta a la empresa que retiró su carga", async () => {
        mockTripWithCompanies([companyUno], carrier, [companyDos]);

        const message = await tripsService.createTripMessage("t1", "u1", {
          body: "la seña ya se devolvió",
          toUserId: "c2",
        });
        expect(message).toMatchObject({ fromUserId: "u1", toUserId: "c2" });
      });

      it("la empresa tampoco se puede escribir a sí misma", async () => {
        mockTripWithCompanies([companyUno]);
        await expect(
          tripsService.createTripMessage("t1", "c1", { body: "hola", toUserId: "c1" })
        ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_TARGET" });
      });

      it("no te podés mandar un mensaje a vos mismo", async () => {
        mockTripWithCompanies([companyUno]);
        await expect(
          tripsService.createTripMessage("t1", "u1", { body: "hola", toUserId: "u1" })
        ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_TARGET" });
      });

      it("quien no participa no puede escribir", async () => {
        mockTripWithCompanies([companyUno]);
        await expect(
          tripsService.createTripMessage("t1", "c9", { body: "hola", toUserId: "u1" })
        ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
      });
    });

    describe("markTripMessagesRead", () => {
      it("marca solo los mensajes dirigidos al usuario logueado", async () => {
        mockTripWithCompanies([companyUno]);

        const result = await tripsService.markTripMessagesRead("t1", "c1");

        expect(prisma.message.updateMany).toHaveBeenCalledWith({
          where: { tripId: "t1", toUserId: "c1", readAt: null },
          data: { readAt: expect.any(Date) },
        });
        expect(result).toEqual({ updated: 2 });
      });

      it("el transportista no marca como leídos los mensajes de la empresa", async () => {
        mockTripWithCompanies([companyUno]);
        await tripsService.markTripMessagesRead("t1", "u1");
        expect(prisma.message.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ toUserId: "u1" }) })
        );
      });

      it("un usuario que no participa no puede marcar leídos", async () => {
        mockTripWithCompanies([companyUno]);
        await expect(tripsService.markTripMessagesRead("t1", "c9")).rejects.toMatchObject({
          statusCode: 403,
          code: "FORBIDDEN",
        });
        expect(prisma.message.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("geocodificación de viajes", () => {
    beforeEach(() => {
      vi.mocked(prisma.trip.create).mockClear();
      vi.mocked(geocode).mockReset().mockResolvedValue(null);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        verificationStatus: "VERIFIED",
        mpUserId: "mp-user-123",
        mpAccessToken: "access-token-123",
      } as never);
    });

    // Rosario→Córdoba son ~374 km en línea recta. Con el tipo "Semi" el
    // sugerido da $186.500 y el rango válido va de $158.500 a $214.400, así que
    // el precio del fixture tiene que estar adentro o el test estaría probando otra cosa.
    const validTrip = {
      origin: "Rosario",
      destination: "Córdoba",
      date: new Date("2026-11-01T10:00:00.000Z"),
      departureTime: "08:00",
      truckType: "Semi",
      capacityTotal: 20,
      price: 186_500,
      depositPercent: 20,
      features: [],
    };

    it("guarda las coordenadas de origen y destino", async () => {
      vi.mocked(geocode).mockImplementation(async (address: string) =>
        address === "Rosario"
          ? { lat: -32.9442, lng: -60.6505 }
          : { lat: -31.4201, lng: -64.1888 }
      );
      vi.mocked(prisma.trip.create).mockResolvedValue(baseTrip({ id: "t1" }) as never);

      await tripsService.createTrip("u1", validTrip);

      expect(geocode).toHaveBeenCalledWith("Rosario");
      expect(geocode).toHaveBeenCalledWith("Córdoba");
      expect(prisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ departureTime: "08:00" }),
        })
      );
      expect(prisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            originLat: -32.9442,
            originLng: -60.6505,
            destLat: -31.4201,
            destLng: -64.1888,
          }),
        })
      );
    });

    it("crea el viaje igual si el geocode falla, con las coords en null", async () => {
      vi.mocked(geocode).mockResolvedValue(null);
      vi.mocked(prisma.trip.create).mockResolvedValue(baseTrip({ id: "t1" }) as never);

      const trip = await tripsService.createTrip("u1", validTrip);

      expect(trip.id).toBe("t1");
      expect(prisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            originLat: null,
            originLng: null,
            destLat: null,
            destLng: null,
          }),
        })
      );
    });

    it("acepta el precio sugerido exacto", async () => {
      vi.mocked(geocode).mockImplementation(async (address: string) =>
        address === "Rosario"
          ? { lat: -32.9442, lng: -60.6505 }
          : { lat: -31.4201, lng: -64.1888 }
      );
      vi.mocked(prisma.trip.create).mockResolvedValue(baseTrip({ id: "t1" }) as never);

      // 374 km de Semi: 9.000 + 380 × 374 × 1.25 = 186.500
      const trip = await tripsService.createTrip("u1", validTrip);

      expect(trip.id).toBe("t1");
      expect(prisma.trip.create).toHaveBeenCalled();
    });

    it("acepta el precio en los dos extremos del rango", async () => {
      vi.mocked(geocode).mockImplementation(async (address: string) =>
        address === "Rosario"
          ? { lat: -32.9442, lng: -60.6505 }
          : { lat: -31.4201, lng: -64.1888 }
      );
      vi.mocked(prisma.trip.create).mockResolvedValue(baseTrip({ id: "t1" }) as never);

      // -15% y +15% del sugerido, redondeados a centenas
      for (const price of [158_500, 214_400]) {
        vi.mocked(prisma.trip.create).mockClear();
        await tripsService.createTrip("u1", { ...validTrip, price });
        expect(prisma.trip.create).toHaveBeenCalled();
      }
    });

    it("rechaza un precio fuera del rango con el rango válido en el mensaje", async () => {
      vi.mocked(geocode).mockImplementation(async (address: string) =>
        address === "Rosario"
          ? { lat: -32.9442, lng: -60.6505 }
          : { lat: -31.4201, lng: -64.1888 }
      );

      // la mitad de lo sugerido: un fletero que se cuelga con el número
      await expect(
        tripsService.createTrip("u1", { ...validTrip, price: 90_000 })
      ).rejects.toMatchObject({ statusCode: 400, code: "PRICE_OUT_OF_RANGE" });

      // y el mensaje dice qué sí vale, para que el fletero se arregle solo
      await expect(tripsService.createTrip("u1", { ...validTrip, price: 90_000 })).rejects.toThrow(
        /\$158\.500/
      );

      expect(prisma.trip.create).not.toHaveBeenCalled();
    });

    it("rechaza un precio inflado por encima del rango", async () => {
      vi.mocked(geocode).mockImplementation(async (address: string) =>
        address === "Rosario"
          ? { lat: -32.9442, lng: -60.6505 }
          : { lat: -31.4201, lng: -64.1888 }
      );

      await expect(
        tripsService.createTrip("u1", { ...validTrip, price: 900_000 })
      ).rejects.toMatchObject({ code: "PRICE_OUT_OF_RANGE" });
      expect(prisma.trip.create).not.toHaveBeenCalled();
    });

    it("no bloquea la publicación si el geocode falla", async () => {
      // sin distancia no hay rango que validar: el precio entra como venga,
      // aunque sea 1, porque frenar el viaje por un geocode caído sería peor
      vi.mocked(geocode).mockResolvedValue(null);
      vi.mocked(prisma.trip.create).mockResolvedValue(baseTrip({ id: "t1" }) as never);

      const trip = await tripsService.createTrip("u1", { ...validTrip, price: 1 });

      expect(trip.id).toBe("t1");
      expect(prisma.trip.create).toHaveBeenCalled();
    });

    it("tampoco bloquea si geocodea una punta y la otra no", async () => {
      vi.mocked(geocode).mockImplementation(async (address: string) =>
        address === "Rosario" ? { lat: -32.9442, lng: -60.6505 } : null
      );
      vi.mocked(prisma.trip.create).mockResolvedValue(baseTrip({ id: "t1" }) as never);

      await tripsService.createTrip("u1", { ...validTrip, price: 5_000 });

      expect(prisma.trip.create).toHaveBeenCalled();
    });

    it("guarda solo el origen si el destino no se pudo resolver", async () => {
      vi.mocked(geocode).mockImplementation(async (address: string) =>
        address === "Rosario" ? { lat: -32.9442, lng: -60.6505 } : null
      );
      vi.mocked(prisma.trip.create).mockResolvedValue(baseTrip({ id: "t1" }) as never);

      await tripsService.createTrip("u1", validTrip);

      const data = vi.mocked(prisma.trip.create).mock.calls[0]?.[0].data;
      expect(data).toMatchObject({
        originLat: -32.9442,
        destLat: null,
        destLng: null,
      });
    });
  });

  describe("búsqueda por proximidad de ruta", () => {
    // Córdoba y Mendoza están a ~580 km; cualquier radio razonable las separa.
    const cordoba = { lat: -31.4201, lng: -64.1888 };
    const mendoza = { lat: -32.8895, lng: -68.8458 };

    function tripAt(
      id: string,
      coords: { origin: [number, number] | null; dest: [number, number] | null }
    ) {
      return baseTrip({
        id,
        origin: id,
        destination: id,
        originLat: coords.origin?.[0] ?? null,
        originLng: coords.origin?.[1] ?? null,
        destLat: coords.dest?.[0] ?? null,
        destLng: coords.dest?.[1] ?? null,
      });
    }

    beforeEach(() => {
      vi.mocked(prisma.trip.findMany).mockResolvedValue([
        tripAt("cerca-1", {
          origin: [cordoba.lat, cordoba.lng],
          dest: [mendoza.lat, mendoza.lng],
        }),
        tripAt("cerca-2", {
          origin: [cordoba.lat + 0.05, cordoba.lng],
          dest: [mendoza.lat, mendoza.lng],
        }),
        tripAt("lejos-1", {
          origin: [mendoza.lat, mendoza.lng],
          dest: [cordoba.lat, cordoba.lng],
        }),
        // viajes viejos sin geocodificar: sin coordenadas no pueden matchear un
        // filtro por radio, por lejos que esté el radio
        tripAt("sin-coords", { origin: null, dest: null }),
        tripAt("sin-coords-dest", { origin: [cordoba.lat, cordoba.lng], dest: null }),
      ] as never);
    });

    it("devuelve solo los viajes dentro del radio del origen", async () => {
      const trips = await tripsService.listOpenTrips({
        nearOrigin: { ...cordoba, radiusKm: 20 },
      });
      // "sin-coords-dest" entra: su origen sí está cerca de Córdoba. Lo que no
      // se puede afirmar (su destino) no importa para un filtro por salida.
      expect(trips.map((t) => t.id)).toEqual(["cerca-1", "cerca-2", "sin-coords-dest"]);
    });

    it("devuelve solo los viajes dentro del radio del destino", async () => {
      // cerca-1 y cerca-2 llegan a Mendoza; lejos-1 llega a Córdoba, así que
      // queda afuera aunque su origen esté en la zona.
      const trips = await tripsService.listOpenTrips({
        nearDestination: { ...mendoza, radiusKm: 20 },
      });
      expect(trips.map((t) => t.id)).toEqual(["cerca-1", "cerca-2"]);
    });

    it("exige que coincidan origen y destino si vienen los dos", async () => {
      const trips = await tripsService.listOpenTrips({
        nearOrigin: { ...cordoba, radiusKm: 20 },
        nearDestination: { ...mendoza, radiusKm: 20 },
      });
      expect(trips.map((t) => t.id)).toEqual(["cerca-1", "cerca-2"]);
    });

    it("excluye los viajes sin coordenadas geocodificadas", async () => {
      // radio de 4000km: entra todo menos "sin-coords", que no tiene
      // coordenadas. Es el null (no la distancia) lo que lo saca.
      const trips = await tripsService.listOpenTrips({ nearOrigin: { ...cordoba, radiusKm: 4000 } });
      expect(trips.map((t) => t.id)).toEqual([
        "cerca-1",
        "cerca-2",
        "lejos-1",
        "sin-coords-dest",
      ]);
    });

    it("exige el destino geocodificado si el filtro es por llegada", async () => {
      const trips = await tripsService.listOpenTrips({
        nearDestination: { ...mendoza, radiusKm: 4000 },
      });
      // "sin-coords-dest" tiene el origen cerca de Córdoba pero el destino sin
      // coordenadas: no se puede afirmar que llegue cerca de Mendoza.
      expect(trips.map((t) => t.id)).toEqual(["cerca-1", "cerca-2", "lejos-1"]);
    });

    it("devuelve los viajes originales si no hay filtro de radio", async () => {
      const trips = await tripsService.listOpenTrips({});
      expect(trips).toHaveLength(5);
      expect(trips.map((t) => t.id)).toContain("sin-coords");
    });
  });

  describe("tracking GPS del viaje", () => {
    function baseLocation(overrides: Record<string, unknown> = {}) {
      return {
        id: "loc1",
        tripId: "t1",
        lat: -32.9468,
        lng: -60.6393,
        recordedAt: new Date("2026-09-26T12:00:00.000Z"),
        ...overrides,
      };
    }

    // el viaje en tránsito del transportista u1, con una empresa (u2) con carga
    function tripInTransit(overrides: Record<string, unknown> = {}) {
      return {
        ...baseTrip({ status: "IN_TRANSIT", carrierId: "u1" }),
        carrier: { id: "u1", name: "Transportes Flete" },
        cargoItems: [{ company: { id: "u2", name: "Granos del Litoral" } }],
        ...overrides,
      };
    }

    beforeEach(() => {
      vi.mocked(prisma.tripLocation.create).mockReset();
      vi.mocked(prisma.tripLocation.findFirst).mockReset();
      vi.mocked(prisma.tripLocation.findMany).mockReset();
      vi.mocked(prisma.trip.findUnique).mockReset();
    });

    it("el transportista del viaje publica su posición", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
      vi.mocked(prisma.tripLocation.create).mockResolvedValue(baseLocation() as never);

      const result = await tripsService.recordTripLocation("t1", "u1", {
        lat: -32.9468,
        lng: -60.6393,
      });

      expect(prisma.tripLocation.create).toHaveBeenCalledWith({
        data: { tripId: "t1", lat: -32.9468, lng: -60.6393 },
      });
      expect(result).toEqual({
        id: "loc1",
        lat: -32.9468,
        lng: -60.6393,
        recordedAt: new Date("2026-09-26T12:00:00.000Z"),
      });
    });

    it("otro transportista no puede publicar la posición de un viaje que no es suyo", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);

      await expect(
        tripsService.recordTripLocation("t1", "u5", { lat: -32.9468, lng: -60.6393 })
      ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
      expect(prisma.tripLocation.create).not.toHaveBeenCalled();
    });

    it.each(["OPEN", "FULL", "COMPLETED"])(
      "no deja publicar la ubicación si el viaje está %s",
      async (status) => {
        vi.mocked(prisma.trip.findUnique).mockResolvedValue(
          tripInTransit({ status }) as never
        );

        await expect(
          tripsService.recordTripLocation("t1", "u1", { lat: -32.9468, lng: -60.6393 })
        ).rejects.toBeInstanceOf(TripNotInTransitError);
        expect(prisma.tripLocation.create).not.toHaveBeenCalled();
      }
    );

    it("falla con 404 si el viaje no existe", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);
      await expect(
        tripsService.recordTripLocation("no-existe", "u1", { lat: -32.9468, lng: -60.6393 })
      ).rejects.toBeInstanceOf(TripNotFoundError);
    });

    it("el transportista del viaje lee la última posición", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
      vi.mocked(prisma.tripLocation.findFirst).mockResolvedValue(baseLocation() as never);

      const result = await tripsService.getTripLocation("t1", "u1", { history: false });

      expect(result.location).toMatchObject({ lat: -32.9468, lng: -60.6393 });
      // sin historial no leemos la tabla entera
      expect(prisma.tripLocation.findMany).not.toHaveBeenCalled();
    });

    it("sin historial pide la posición más reciente, no la primera (02#14)", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
      vi.mocked(prisma.tripLocation.findFirst).mockResolvedValue(baseLocation() as never);

      await tripsService.getTripLocation("t1", "u2", { history: false });

      // mismo desempate por id que el historial, al revés
      expect(prisma.tripLocation.findFirst).toHaveBeenCalledWith({
        where: { tripId: "t1" },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      });
    });

    it("la empresa con carga en el viaje también lee la última posición", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
      vi.mocked(prisma.tripLocation.findFirst).mockResolvedValue(baseLocation() as never);

      const result = await tripsService.getTripLocation("t1", "u2", { history: false });
      expect(result.location).toMatchObject({ id: "loc1" });
    });

    it("un usuario que no tiene nada que ver con el viaje no puede leer la ubicación", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);

      await expect(tripsService.getTripLocation("t1", "u9", { history: false })).rejects.toMatchObject(
        {
          statusCode: 403,
          code: "FORBIDDEN",
        }
      );
      expect(prisma.tripLocation.findFirst).not.toHaveBeenCalled();
    });

    it("U8: la empresa que retiró su carga (CANCELLED) ya no ve el camión", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(
        tripInTransit({
          cargoItems: [
            { status: "CANCELLED", company: { id: "u2", name: "Granos del Litoral" } },
          ],
        }) as never
      );

      await expect(
        tripsService.getTripLocation("t1", "u2", { history: true })
      ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
      expect(prisma.tripLocation.findMany).not.toHaveBeenCalled();
      expect(prisma.tripLocation.findFirst).not.toHaveBeenCalled();
    });

    it("U8: con una carga retirada y otra viva sigue siendo participante", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(
        tripInTransit({
          cargoItems: [
            { status: "CANCELLED", company: { id: "u2", name: "Granos del Litoral" } },
            { status: "CONFIRMED", company: { id: "u2", name: "Granos del Litoral" } },
          ],
        }) as never
      );
      vi.mocked(prisma.tripLocation.findFirst).mockResolvedValue(baseLocation() as never);

      const result = await tripsService.getTripLocation("t1", "u2", { history: false });
      expect(result.location).toMatchObject({ id: "loc1" });
    });

    it("devuelve null cuando el viaje todavía no tiene posiciones", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
      vi.mocked(prisma.tripLocation.findFirst).mockResolvedValue(null);

      const result = await tripsService.getTripLocation("t1", "u2", { history: false });
      expect(result).toEqual({ location: null });
    });

    it("con history devuelve el recorrido completo de la ruta", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
      vi.mocked(prisma.tripLocation.findMany).mockResolvedValue([
        baseLocation({ id: "loc1", lat: -32.9, lng: -60.6, recordedAt: new Date(1) }),
        baseLocation({ id: "loc2", lat: -33.1, lng: -61.2, recordedAt: new Date(2) }),
        baseLocation({ id: "loc3", lat: -33.4, lng: -61.9, recordedAt: new Date(3) }),
      ] as never);

      const result = await tripsService.getTripLocation("t1", "u2", { history: true });

      expect(result.track).toHaveLength(3);
      expect(result.track?.map((p) => p.id)).toEqual(["loc1", "loc2", "loc3"]);
      // la última posición del recorrido es la última del track
      expect(result.location?.id).toBe("loc3");
      expect(prisma.tripLocation.findFirst).not.toHaveBeenCalled();
    });

    it("con history y sin posiciones devuelve track vacío y location null", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(tripInTransit() as never);
      vi.mocked(prisma.tripLocation.findMany).mockResolvedValue([]);

      const result = await tripsService.getTripLocation("t1", "u1", { history: true });
      expect(result).toEqual({ location: null, track: [] });
    });
  });

  describe("hora de salida del viaje", () => {
    beforeEach(() => {
      vi.mocked(geocode).mockReset().mockResolvedValue(null);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        verificationStatus: "VERIFIED",
        mpUserId: "mp-user-123",
        mpAccessToken: "access-token-123",
      } as never);
    });

    const base = {
      origin: "Rosario",
      destination: "Córdoba",
      date: new Date("2026-11-01T10:00:00.000Z"),
      departureTime: "08:00",
      truckType: "Semi",
      capacityTotal: 20,
      price: 1000,
      depositPercent: 20,
      features: [],
    };

    it("guarda la hora y la devuelve en el resumen", async () => {
      vi.mocked(prisma.trip.create).mockResolvedValue(
        baseTrip({ id: "t1", departureTime: "05:45" }) as never
      );

      const trip = await tripsService.createTrip("u1", { ...base, departureTime: "05:45" });

      expect(prisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ departureTime: "05:45" }),
        })
      );
      expect(trip.departureTime).toBe("05:45");
    });

    // un viaje nuevo sin hora lo rechaza el schema (tests/app.test.ts, U11); los
    // viejos sin hora siguen saliendo con null
    it("un viaje viejo sin hora sale con null en el resumen", async () => {
      vi.mocked(prisma.trip.findMany).mockResolvedValue([
        baseTrip({ id: "t1", departureTime: null }),
      ] as never);

      const [trip] = await tripsService.listOpenTrips();

      expect(trip?.departureTime).toBeNull();
    });

    it("la lista de viajes también la trae", async () => {
      vi.mocked(prisma.trip.findMany).mockResolvedValue([
        baseTrip({ id: "t1", departureTime: "05:45" }),
        baseTrip({ id: "t2", departureTime: null }),
      ] as never);

      const trips = await tripsService.listOpenTrips();

      expect(trips.map((t) => [t.id, t.departureTime])).toEqual([
        ["t1", "05:45"],
        ["t2", null],
      ]);
    });
  });
});

describe("processRefundRequest (outbox processor)", () => {
  // el pago vive en la cuenta MP del transportista: el reembolso sale con SU
  // token (descifrado), nunca con el de la plataforma
  const OUTBOX_TOKEN_PLAIN = "APP_USR-token-del-carrier";
  const OUTBOX_CARRIER = {
    mpUserId: "mp-user-123",
    mpAccessToken: encryptSecret(OUTBOX_TOKEN_PLAIN),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.refundRequest.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it("si no hay RefundRequest, no hace nada", async () => {
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(null);

    await processRefundRequest("i1");

    expect(prisma.refundRequest.findUnique).toHaveBeenCalledWith({
      where: { cargoItemId: "i1" },
    });
    expect(prisma.refundRequest.updateMany).not.toHaveBeenCalled();
  });

  it("si la RefundRequest no es PENDING, no hace nada", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      status: "COMPLETED",
    });

    await processRefundRequest("i1");

    expect(prisma.refundRequest.updateMany).not.toHaveBeenCalled();
  });

  it("si no hay pago DEPOSIT aprobado con mpPaymentId, marca COMPLETED sin llamar a MP", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("100.00"),
      status: "PENDING",
      attempts: 0,
    });
    // @ts-expect-error mock incomplete Payment for test
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "PENDING", // no está aprobado
      mpPaymentId: null,
    });

    await processRefundRequest("i1");

    expect(refundPayment).not.toHaveBeenCalled();
    // cierre con CAS sobre PROCESSING (el worker pudo retomarla en el medio)
    expect(prisma.refundRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "rr1", status: "PROCESSING" },
      data: { status: "COMPLETED", carrierDisconnectedAt: null },
    });
  });

  it("procesa reembolso total: llama a MP, actualiza Payment a REFUNDED y RefundRequest a COMPLETED", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("100.00"),
      status: "PENDING",
      attempts: 0,
    });
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
      cargoItem: { trip: { carrier: OUTBOX_CARRIER } },
    } as never);
    vi.mocked(refundPayment).mockResolvedValue(100);

    await processRefundRequest("i1");

    // el reclamo es un CAS: solo uno de dos processors concurrentes lo gana
    expect(prisma.refundRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "rr1", status: "PENDING", attempts: 0 },
      data: { status: "PROCESSING" },
    });
    expect(refundPayment).toHaveBeenCalledWith("mp-77", 100, OUTBOX_TOKEN_PLAIN, {
      idempotencyKey: "refund-rr1-0",
    });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { status: "REFUNDED", refundedAmount: 100 },
    });
    // cierre con CAS sobre PROCESSING (el worker pudo retomarla en el medio)
    expect(prisma.refundRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "rr1", status: "PROCESSING" },
      data: { status: "COMPLETED", carrierDisconnectedAt: null },
    });
  });

  it("procesa reembolso parcial (24-48hs): deja Payment APPROVED con refundedAmount", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("50.00"),
      status: "PENDING",
      attempts: 0,
    });
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
      cargoItem: { trip: { carrier: OUTBOX_CARRIER } },
    } as never);
    vi.mocked(refundPayment).mockResolvedValue(50);

    await processRefundRequest("i1");

    expect(refundPayment).toHaveBeenCalledWith("mp-77", 50, OUTBOX_TOKEN_PLAIN, {
      idempotencyKey: "refund-rr1-0",
    });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { refundedAmount: 50 },
    });
    expect(prisma.payment.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REFUNDED" }) })
    );
    // cierre con CAS sobre PROCESSING (el worker pudo retomarla en el medio)
    expect(prisma.refundRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "rr1", status: "PROCESSING" },
      data: { status: "COMPLETED", carrierDisconnectedAt: null },
    });
  });

  it("si refundPayment falla (red/MP), incrementa attempts, guarda error, vuelve a PENDING", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("100.00"),
      status: "PENDING",
      attempts: 0,
    });
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
      cargoItem: { trip: { carrier: OUTBOX_CARRIER } },
    } as never);
    vi.mocked(refundPayment).mockRejectedValue(
      new Error("network timeout")
    );

    await processRefundRequest("i1");

    expect(refundPayment).toHaveBeenCalledWith("mp-77", 100, OUTBOX_TOKEN_PLAIN, {
      idempotencyKey: "refund-rr1-0",
    });
    // el cierre es un CAS sobre PROCESSING; lastError guarda el código, no el
    // mensaje (un error que no es de MP: su nombre)
    expect(prisma.refundRequest.updateMany).toHaveBeenLastCalledWith({
      where: { id: "rr1", status: "PROCESSING" },
      data: expect.objectContaining({
        status: "PENDING",
        attempts: 1,
        lastError: "Error",
      }),
    });
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it("si refundPayment falla con AppError de MP, lo mismo: PENDING para reintento", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("100.00"),
      status: "PENDING",
      attempts: 0,
    });
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
      cargoItem: { trip: { carrier: OUTBOX_CARRIER } },
    } as never);
    vi.mocked(refundPayment).mockRejectedValue(
      new AppError("MP rechazó el reembolso", 502, "MP_ERROR")
    );

    await processRefundRequest("i1");

    // el cierre es un CAS sobre PROCESSING; lastError guarda el código, no el mensaje
    expect(prisma.refundRequest.updateMany).toHaveBeenLastCalledWith({
      where: { id: "rr1", status: "PROCESSING" },
      data: expect.objectContaining({
        status: "PENDING",
        attempts: 1,
        lastError: "MP_ERROR",
      }),
    });
  });

  it("idempotencia: si MP ya devolvió el total, refundPayment devuelve el monto y no duplica", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("100.00"),
      status: "PENDING",
      attempts: 0,
    });
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
      cargoItem: { trip: { carrier: OUTBOX_CARRIER } },
    } as never);
    // refundPayment (ya idempotente por Fase 2.1) devuelve lo que MP ya procesó
    vi.mocked(refundPayment).mockResolvedValue(100);

    await processRefundRequest("i1");

    expect(refundPayment).toHaveBeenCalledWith("mp-77", 100, OUTBOX_TOKEN_PLAIN, {
      idempotencyKey: "refund-rr1-0",
    });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { status: "REFUNDED", refundedAmount: 100 },
    });
    // cierre con CAS sobre PROCESSING (el worker pudo retomarla en el medio)
    expect(prisma.refundRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "rr1", status: "PROCESSING" },
      data: { status: "COMPLETED", carrierDisconnectedAt: null },
    });
  });

  /** RefundRequest PENDING + seña aprobada en la cuenta del transportista */
  const outboxPendiente = (attempts: number) => {
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("100.00"),
      status: "PENDING",
      attempts,
    } as never);
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
      cargoItem: { trip: { carrier: OUTBOX_CARRIER } },
    } as never);
  };

  it("si otro processor ganó el reclamo, no llama a MP ni toca nada", async () => {
    outboxPendiente(0);
    vi.mocked(prisma.refundRequest.updateMany).mockResolvedValue({ count: 0 } as never);

    const outcome = await processRefundRequest("i1");

    expect(outcome).toEqual({ kind: "none" });
    expect(refundPayment).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
    // solo el reclamo que perdió: ningún cierre
    expect(prisma.refundRequest.updateMany).toHaveBeenCalledTimes(1);
  });

  it("dos processors a la vez: refundPayment una sola vez", async () => {
    outboxPendiente(0);
    vi.mocked(prisma.refundRequest.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    vi.mocked(prisma.payment.update).mockResolvedValue({ status: "REFUNDED" } as never);
    vi.mocked(refundPayment).mockResolvedValue(100);

    await Promise.all([processRefundRequest("i1"), processRefundRequest("i1")]);

    expect(refundPayment).toHaveBeenCalledTimes(1);
  });

  it("cada intento usa su propia clave: un error que MP guardó no traba el reintento", async () => {
    // si MP cacheara la respuesta de error bajo la clave, repetir la misma
    // clave devolvería ese error para siempre. El doble reembolso entre intentos
    // lo evitan el reclamo por CAS y la consulta previa de refundPayment.
    outboxPendiente(2);
    vi.mocked(prisma.payment.update).mockResolvedValue({ status: "REFUNDED" } as never);
    vi.mocked(refundPayment).mockResolvedValue(100);

    await processRefundRequest("i1");

    expect(prisma.refundRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "rr1", status: "PENDING", attempts: 2 },
      data: { status: "PROCESSING" },
    });
    expect(refundPayment).toHaveBeenCalledWith("mp-77", 100, OUTBOX_TOKEN_PLAIN, {
      idempotencyKey: "refund-rr1-2",
    });
  });

  it("informa el estado del pago cuando completa", async () => {
    outboxPendiente(0);
    vi.mocked(prisma.payment.update).mockResolvedValue({ status: "REFUNDED" } as never);
    vi.mocked(refundPayment).mockResolvedValue(100);

    expect(await processRefundRequest("i1")).toEqual({
      kind: "completed",
      paymentStatus: "REFUNDED",
    });
  });

  it("informa la falla cuando la request vuelve a PENDING", async () => {
    outboxPendiente(0);
    vi.mocked(refundPayment).mockRejectedValue(
      new AppError("MP rechazó el reembolso", 502, "MP_ERROR")
    );

    expect(await processRefundRequest("i1")).toEqual({ kind: "failed" });
  });
});

// D2 = b: se pueden reordenar las paradas con el viaje en camino, avisando a
// las empresas cuya parada cambió de lugar.
describe("reorderTripStops (D2)", () => {
  /** tres paradas sin coordenadas: el orden es el manual y después el de creación */
  const paradas = [
    { id: "A", companyId: "c1", pickupAddress: "Pilar 100" },
    { id: "B", companyId: "c2", pickupAddress: "Escobar 200" },
    { id: "C", companyId: "c3", pickupAddress: "Zárate 300" },
  ].map((p) =>
    baseCargoItem({
      ...p,
      status: "CONFIRMED",
      stopOrder: null,
      company: { id: p.companyId, name: `Empresa ${p.companyId}` },
    })
  );

  function viaje(status: string) {
    const trip = baseTrip({
      status,
      origin: "CABA",
      destination: "Rosario",
      carrier: { id: "u1", name: "Flete" },
      cargoItems: paradas,
    });
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(trip as never);
    vi.mocked(prisma.cargoItem.findMany).mockResolvedValue(paradas as never);
    tx.cargoItem.findMany.mockResolvedValue(paradas);
    return trip;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: unknown) =>
        typeof fn === "function" ? (fn as (t: unknown) => unknown)(tx) : Promise.all(fn as [])
    );
    tx.cargoItem.update.mockResolvedValue({});
  });

  afterEach(() => {
    tx.cargoItem.findMany.mockResolvedValue([]);
  });

  // B pasa a la 1, A a la 2; C sigue 3.ª
  const intercambio = [
    { cargoItemId: "A", order: 2 },
    { cargoItemId: "B", order: 1 },
  ];

  it("en tránsito avisa solo a las empresas cuya parada cambió de lugar", async () => {
    viaje("IN_TRANSIT");

    await tripsService.reorderTripStops("t1", "u1", intercambio);

    const avisados = vi.mocked(notifyUsers).mock.calls.map(([ids]) => ids).flat();
    expect(avisados.sort()).toEqual(["c1", "c2"]);
    const aC1 = vi.mocked(notifyUsers).mock.calls.find(([ids]) => ids.includes("c1"))?.[1];
    expect(aC1?.type).toBe("STOPS_REORDERED");
    expect(aC1?.tripId).toBe("t1");
    expect(aC1?.body).toContain("Pilar 100");
    expect(aC1?.body).toContain("parada 2 de 3");
    expect(tx.cargoItem.update).toHaveBeenCalledWith({
      where: { id: "A" },
      data: { stopOrder: 2 },
    });
  });

  it("si el orden no cambia, no avisa a nadie", async () => {
    viaje("IN_TRANSIT");

    await tripsService.reorderTripStops("t1", "u1", [
      { cargoItemId: "A", order: 1 },
      { cargoItemId: "B", order: 2 },
    ]);

    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("antes de salir reordena sin avisar", async () => {
    viaje("OPEN");

    await tripsService.reorderTripStops("t1", "u1", intercambio);

    expect(tx.cargoItem.update).toHaveBeenCalledTimes(2);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "CANCELLED"])(
    "un viaje %s no se reordena: 409 INVALID_STATUS_TRANSITION",
    async (status) => {
      viaje(status);

      await expect(
        tripsService.reorderTripStops("t1", "u1", intercambio)
      ).rejects.toMatchObject({ statusCode: 409, code: "INVALID_STATUS_TRANSITION" });
      expect(tx.cargoItem.update).not.toHaveBeenCalled();
      expect(notifyUsers).not.toHaveBeenCalled();
    }
  );

  it("400 INVALID_CARGO_ITEMS si una carga no es del viaje", async () => {
    viaje("IN_TRANSIT");

    await expect(
      tripsService.reorderTripStops("t1", "u1", [{ cargoItemId: "Z", order: 1 }])
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_CARGO_ITEMS" });
    expect(tx.cargoItem.update).not.toHaveBeenCalled();
  });

  it("403 si no es el fletero del viaje", async () => {
    viaje("IN_TRANSIT");

    await expect(
      tripsService.reorderTripStops("t1", "otro", intercambio)
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  it("reordena aunque el aviso falle", async () => {
    viaje("IN_TRANSIT");
    vi.mocked(notifyUsers).mockRejectedValue(new Error("la base de avisos cayó"));

    await expect(
      tripsService.reorderTripStops("t1", "u1", intercambio)
    ).resolves.toBeDefined();
    expect(tx.cargoItem.update).toHaveBeenCalledTimes(2);
    vi.mocked(notifyUsers).mockResolvedValue(1);
  });
});

// U8: las paradas son para el fletero y las empresas con carga viva. Quien
// retiró su carga (CANCELLED) deja de ver por dónde pasa el camión.
describe("getTripStops: acceso", () => {
  function viajeCon(
    cargoItems: { status: string; company: { id: string; name: string } }[]
  ) {
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(
      baseTrip({
        carrier: { id: "u1", name: "Flete" },
        cargoItems,
      }) as never
    );
  }

  beforeEach(() => {
    vi.mocked(prisma.trip.findUnique).mockReset();
  });

  it("la empresa con su única carga CANCELLED recibe 403", async () => {
    viajeCon([{ status: "CANCELLED", company: { id: "c1", name: "Empresa Uno" } }]);

    await expect(tripsService.getTripStops("t1", "c1")).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });
    // no llega a leer las paradas
    expect(prisma.trip.findUnique).toHaveBeenCalledTimes(1);
  });

  it("la empresa con una carga viva las ve", async () => {
    viajeCon([
      { status: "CANCELLED", company: { id: "c1", name: "Empresa Uno" } },
      { status: "PENDING", company: { id: "c1", name: "Empresa Uno" } },
    ]);

    await expect(tripsService.getTripStops("t1", "c1")).resolves.toBeInstanceOf(Array);
  });

  it("el fletero del viaje las ve aunque no quede ninguna carga viva", async () => {
    viajeCon([{ status: "CANCELLED", company: { id: "c1", name: "Empresa Uno" } }]);

    // solo verifica que no hay 403: el mock devuelve las cargas sin aplicar el
    // `where: { status: { not: "CANCELLED" } }` de la consulta, así que no puede
    // comprobar que la lista llegue vacía.
    await expect(tripsService.getTripStops("t1", "u1")).resolves.toBeInstanceOf(Array);
  });
});

// U19: cada empresa ve su parada completa y las ajenas solo como "otra parada",
// con el orden y el volumen. El fletero ve todas.
describe("getTripStops por rol (U19)", () => {
  function parada(o: {
    id: string;
    companyId: string;
    description: string;
    pickupAddress: string;
    trackingCode: string;
    volume: number;
    stopOrder: number;
  }) {
    return {
      id: o.id,
      companyId: o.companyId,
      company: { id: o.companyId, name: `Empresa ${o.companyId}` },
      status: "CONFIRMED",
      description: o.description,
      pickupAddress: o.pickupAddress,
      pickupLat: -32.95,
      pickupLng: -60.65,
      trackingCode: o.trackingCode,
      volume: o.volume,
      stopOrder: o.stopOrder,
    };
  }

  beforeEach(() => {
    vi.mocked(prisma.trip.findUnique).mockReset();
    // el mismo objeto sirve para resolveParticipants y para la consulta de paradas
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(
      baseTrip({
        carrier: { id: "u1", name: "Flete" },
        originLat: null,
        originLng: null,
        destLat: null,
        destLng: null,
        cargoItems: [
          parada({
            id: "ci-norte",
            companyId: "c-norte",
            description: "Cajas de cerámicos",
            pickupAddress: "Bv. Oroño 1200, Rosario",
            trackingCode: "TP-NORTE-C1",
            volume: 5,
            stopOrder: 2,
          }),
          parada({
            id: "ci-acero",
            companyId: "c-acero",
            description: "Bobinas de acero",
            pickupAddress: "Av. Pellegrini 900, Rosario",
            trackingCode: "TP-ACERO-C2",
            volume: 4,
            stopOrder: 1,
          }),
        ],
      }) as never
    );
  });

  const CLAVES_COMPLETA = [
    "cargoItemId",
    "description",
    "kind",
    "pickupAddress",
    "pickupLat",
    "pickupLng",
    "status",
    "stopOrder",
    "trackingCode",
    "volume",
  ];

  it("la empresa ve su parada completa y la ajena solo con orden y volumen", async () => {
    const stops = await tripsService.getTripStops("t1", "c-norte");

    expect(stops).toHaveLength(2);
    // el orden del recorrido se mantiene: la ajena es la 1.ª
    expect(stops[0]).toEqual({ kind: "OTHER", stopOrder: 1, volume: 4 });
    expect(Object.keys(stops[1]!).sort()).toEqual(CLAVES_COMPLETA);
    expect(stops[1]).toMatchObject({
      kind: "FULL",
      cargoItemId: "ci-norte",
      pickupAddress: "Bv. Oroño 1200, Rosario",
      trackingCode: "TP-NORTE-C1",
      stopOrder: 2,
    });

    const json = JSON.stringify(stops);
    for (const ajeno of ["ci-acero", "c-acero", "Bobinas", "Pellegrini", "TP-ACERO"]) {
      expect(json).not.toContain(ajeno);
    }
  });

  it("el fletero ve todas las paradas completas", async () => {
    const stops = await tripsService.getTripStops("t1", "u1");

    expect(stops.map((s) => s.kind)).toEqual(["FULL", "FULL"]);
    for (const stop of stops) expect(Object.keys(stop).sort()).toEqual(CLAVES_COMPLETA);
    expect(stops.map((s) => s.stopOrder)).toEqual([1, 2]);
  });
});
