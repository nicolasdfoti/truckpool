import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import * as tripsService from "../modules/trips/trips.service.js";
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
  },
  payment: {
    update: vi.fn(),
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
    carrier: { id: "u1", isAvailableForRequests: true },
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
      where: { status: "OPEN", date: { gt: CORTE_ARGENTINA } },
      include: { cargoItems: true, carrier: { select: { name: true } } },
      orderBy: { date: "asc" },
    });
  });

  it("filtra por origin con contains e insensible", async () => {
    await tripsService.listOpenTrips({ origin: "ros" }, AHORA);

    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "OPEN",
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
          origin: { contains: "Córdoba", mode: "insensitive" },
          features: { hasEvery: ["seguro", "expreso"] },
          date: { gt: CORTE_ARGENTINA },
        },
      })
    );
  });

  it("traduce dateFrom/dateTo a un rango UTC del día completo y conserva el corte", async () => {
    await tripsService.listOpenTrips(
      {
        dateFrom: new Date("2026-10-01T00:00:00.000Z"),
        dateTo: new Date("2026-10-31T00:00:00.000Z"),
      },
      AHORA
    );

    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "OPEN",
          date: {
            gt: CORTE_ARGENTINA,
            gte: new Date("2026-10-01T00:00:00.000Z"),
            lte: new Date("2026-10-31T23:59:59.999Z"),
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
      const result = await tripsService.listOpenTrips({}, AHORA);

      expect(result.map((trip) => trip.acceptsCargo)).toEqual([true]);
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
    email: data.email?.({ name: "Destinatario", email: "d@e.com" }),
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

  it("no deja retirar una carga ya confirmada", async () => {
    tx.cargoItem.findUnique.mockResolvedValue(
      baseCargoItem({ status: "CONFIRMED", payments: [], company: { name: "Acero SA" } })
    );

    await expect(tripsService.cancelCargoItem("t1", "i1", "c1")).rejects.toBeInstanceOf(
      CargoItemNotCancellableError
    );
    expect(tx.cargoItem.update).not.toHaveBeenCalled();
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
      baseTrip({ carrier: baseCarrier(), date: tripDateIn(36) })
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
      baseTrip({ carrier: baseCarrier(), date: tripDateIn(10) })
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
      baseTrip({ carrier: baseCarrier(), date: tripDateIn(48) })
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
      baseTrip({ carrier: baseCarrier(), date: tripDateIn(24) })
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
        date: new Date("2026-10-03T00:00:00.000Z"),
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

  it("ignora un pago BALANCE: el saldo no se devuelve en un retiro", async () => {
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

    await tripsService.cancelCargoItem("t1", "i1", "c1");

    // sin seña cobrada no hay devolución, aunque haya un saldo aprobado (que en
    // la práctica no puede existir con la carga PENDING).
    expect(refundPayment).not.toHaveBeenCalled();
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
    beforeEach(() => {
      vi.clearAllMocks();
      (
        prisma.cargoItem.updateMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        count: 1,
      });
      (prisma.trip.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : undefined)
      );
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** una carga vencida (la búsqueda ya no trae el snapshot del viaje) */
    function expiredItem(overrides: Record<string, unknown> = {}) {
      return { id: "i1", tripId: "t1", ...overrides };
    }

    /**
     * El liberador relee el viaje después de cancelar para calcular la capacidad
     * con el estado real (y no con un snapshot que pudo quedar viejo si una seña
     * se acreditó en el medio).
     */
    function mockTripState(state: {
      status: "OPEN" | "FULL";
      capacityTotal: number;
      cargoItems: { id: string; volume: number; status: string }[];
    }) {
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        state
      );
    }

    it("no hace nada si no hay reservas vencidas", async () => {
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);

      const released = await tripsService.releaseExpiredReservations();

      expect(released).toBe(0);
      expect(prisma.cargoItem.updateMany).not.toHaveBeenCalled();
    });

    it("libera la carga que no pagó la seña dentro de las 24hs", async () => {
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([expiredItem()]);

      const released = await tripsService.releaseExpiredReservations();

      expect(released).toBe(1);
      expect(prisma.cargoItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "PENDING",
            // 24hs exactas: la reserva se rompe recién pasado el plazo
            createdAt: { lt: new Date("2026-09-26T12:00:00Z") },
            trip: { status: { in: ["OPEN", "FULL"] } },
            payments: { none: { type: "DEPOSIT", status: "APPROVED" } },
          }),
        })
      );
      // el update revalida: si la seña entró entre la búsqueda y ahora, la
      // reserva se mantiene (el filtro solo del findMany no alcanza).
      expect(prisma.cargoItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["i1"] },
          status: "PENDING",
          trip: { status: { in: ["OPEN", "FULL"] } },
          payments: { none: { type: "DEPOSIT", status: "APPROVED" } },
        },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date("2026-09-27T12:00:00Z"),
          // nunca se cobró nada, así que el costo de cancelacion es 0 (y no
          // null, que en el mapper significa "la carga sigue viva").
          cancellationFeeAmount: new Prisma.Decimal(0),
        },
      });
    });

    it("no libera la carga si la seña se acreditó entre la búsqueda y el update", async () => {
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([expiredItem()]);
      // el updateMany no encuentra la fila: el pago la rescató
      (
        prisma.cargoItem.updateMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        count: 0,
      });
      mockTripState({
        status: "OPEN",
        capacityTotal: 30,
        cargoItems: [{ id: "i1", volume: 10, status: "PENDING" }],
      });

      expect(await tripsService.releaseExpiredReservations()).toBe(0);
    });

    it("reabre el viaje FULL que quedó con lugar libre", async () => {
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([expiredItem()]);
      // estado real ya liberated
      mockTripState({
        status: "FULL",
        capacityTotal: 30,
        cargoItems: [
          { id: "i1", volume: 10, status: "CANCELLED" },
          { id: "i2", volume: 20, status: "CONFIRMED" },
        ],
      });

      await tripsService.releaseExpiredReservations();

      // 30 - 10 (la vencida) = 20, y quedaban 20 ocupados: vuelve a haber lugar.
      expect(prisma.trip.update).toHaveBeenCalledWith({
        where: { id: "t1" },
        data: { status: "OPEN" },
      });
    });

    it("deja el viaje FULL si las reservas vencidas no liberan lugar", async () => {
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([expiredItem()]);
      mockTripState({
        status: "FULL",
        capacityTotal: 30,
        cargoItems: [
          { id: "i1", volume: 10, status: "CANCELLED" },
          { id: "i2", volume: 30, status: "CONFIRMED" },
        ],
      });

      await tripsService.releaseExpiredReservations();

      expect(prisma.trip.update).not.toHaveBeenCalled();
    });

    it("libera todas las reservas vencidas de un mismo viaje de una vez", async () => {
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([expiredItem(), expiredItem({ id: "i2" })]);
      (
        prisma.cargoItem.updateMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        count: 2,
      });
      mockTripState({
        status: "OPEN",
        capacityTotal: 30,
        cargoItems: [
          { id: "i1", volume: 10, status: "CANCELLED" },
          { id: "i2", volume: 10, status: "CANCELLED" },
        ],
      });

      const released = await tripsService.releaseExpiredReservations();

      expect(released).toBe(2);
      expect(prisma.cargoItem.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.cargoItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ["i1", "i2"] } }),
        })
      );
    });

    it("listar viajes libera primero las reservas vencidas", async () => {
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([expiredItem()]);
      (prisma.trip.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await tripsService.listOpenTrips();

      expect(prisma.cargoItem.updateMany).toHaveBeenCalled();
    });

    it("mirar un viaje también libera las reservas vencidas", async () => {
      (
        prisma.cargoItem.findMany as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([expiredItem()]);
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseTrip({ carrier: { name: "Flete" }, reviews: [] })
      );

      await tripsService.getTripById("t1");

      expect(prisma.cargoItem.updateMany).toHaveBeenCalled();
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
      return tripsService.getTripById("t1");
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
        where: { id: "i1" },
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

    const baseReview = {
      id: "r1",
      tripId: "t1",
      fromUserId: "u1",
      toUserId: "u2",
      rating: 5,
      comment: "puntual",
      createdAt: new Date(),
      fromUser: { name: "Transportes Flete" },
      toUser: { name: "Comercial Norte" },
    };

    it("no deja calificar antes de que el viaje esté COMPLETED", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        status: "IN_TRANSIT",
        carrierId: "u1",
        cargoItems: [{ companyId: "u2" }],
      } as never);

      await expect(tripsService.createReview("t1", "u1", { rating: 5 })).rejects.toMatchObject({
        statusCode: 409,
        code: "TRIP_NOT_COMPLETED",
      });
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it("no deja calificar dos veces la misma dirección del mismo viaje", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(completedTrip(["u2"]) as never);
      vi.mocked(prisma.review.findUnique).mockResolvedValue(baseReview as never);

      await expect(tripsService.createReview("t1", "u1", { rating: 5 })).rejects.toMatchObject({
        statusCode: 409,
        code: "ALREADY_REVIEWED",
      });
      expect(prisma.review.create).not.toHaveBeenCalled();
      expect(prisma.review.findUnique).toHaveBeenCalledWith({
        where: {
          tripId_fromUserId_toUserId: { tripId: "t1", fromUserId: "u1", toUserId: "u2" },
        },
      });
    });

    it("no deja calificar a alguien que no participó del viaje", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(completedTrip(["u2"]) as never);

      await expect(tripsService.createReview("t1", "u9", { rating: 1 })).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it("no deja calificar a un tercero que no es la contraparte del viaje", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(completedTrip(["u2"]) as never);

      await expect(
        tripsService.createReview("t1", "u1", { rating: 5, toUserId: "u7" })
      ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    });

    it("el fletero califica a la empresa y la empresa al fletero sin pasar toUserId", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(completedTrip(["u2"]) as never);
      vi.mocked(prisma.review.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.review.create).mockResolvedValue(baseReview as never);

      const fromCarrier = await tripsService.createReview("t1", "u1", {
        rating: 5,
        comment: "puntual",
      });
      expect(prisma.review.create).toHaveBeenLastCalledWith({
        data: {
          tripId: "t1",
          fromUserId: "u1",
          toUserId: "u2",
          rating: 5,
          comment: "puntual",
        },
        include: {
          fromUser: { select: { name: true } },
          toUser: { select: { name: true } },
        },
      });
      expect(fromCarrier).toMatchObject({
        fromUserId: "u1",
        toUserId: "u2",
        fromName: "Transportes Flete",
      });

      vi.mocked(prisma.review.create).mockResolvedValue({
        ...baseReview,
        id: "r2",
        fromUserId: "u2",
        toUserId: "u1",
      } as never);

      const fromCompany = await tripsService.createReview("t1", "u2", { rating: 4 });
      expect(prisma.review.create).toHaveBeenLastCalledWith({
        data: {
          tripId: "t1",
          fromUserId: "u2",
          toUserId: "u1",
          rating: 4,
          comment: null,
        },
        include: {
          fromUser: { select: { name: true } },
          toUser: { select: { name: true } },
        },
      });
      expect(fromCompany).toMatchObject({ fromUserId: "u2", toUserId: "u1" });
    });

    it("el fletero debe indicar toUserId cuando el viaje tiene varias empresas", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(
        completedTrip(["u2", "u3"]) as never
      );

      await expect(tripsService.createReview("t1", "u1", { rating: 5 })).rejects.toMatchObject({
        statusCode: 400,
        code: "REVIEW_TARGET_REQUIRED",
      });

      vi.mocked(prisma.review.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.review.create).mockResolvedValue({
        ...baseReview,
        toUserId: "u3",
      } as never);

      const review = await tripsService.createReview("t1", "u1", { rating: 5, toUserId: "u3" });
      expect(review.toUserId).toBe("u3");
    });

    it("lanza 404 si el viaje no existe", async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);
      await expect(tripsService.createReview("nope", "u1", { rating: 5 })).rejects.toMatchObject({
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
      tripCarrier = carrier
    ) {
      (prisma.trip.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        carrier: tripCarrier,
        cargoItems: companies.map((company) => ({ company })),
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

        expect(prisma.message.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { tripId: "t1" },
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

      it("una empresa con carga también puede verlos", async () => {
        mockTripWithCompanies([companyUno, companyDos]);
        const result = await tripsService.listTripMessages("t1", "c2");
        expect(result.messages).toEqual([]);
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
          data: expect.objectContaining({ departureTime: null }),
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

    it("no inventa hora si el fletero no la carga", async () => {
      vi.mocked(prisma.trip.create).mockResolvedValue(
        baseTrip({ id: "t1", departureTime: null }) as never
      );

      const trip = await tripsService.createTrip("u1", base);

      expect(trip.departureTime).toBeNull();
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("si no hay RefundRequest, no hace nada", async () => {
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue(null);

    await tripsService.processRefundRequest("i1");

    expect(prisma.refundRequest.findUnique).toHaveBeenCalledWith({
      where: { cargoItemId: "i1" },
    });
    expect(prisma.refundRequest.update).not.toHaveBeenCalled();
  });

  it("si la RefundRequest no es PENDING, no hace nada", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      status: "COMPLETED",
    });

    await tripsService.processRefundRequest("i1");

    expect(prisma.refundRequest.update).not.toHaveBeenCalled();
  });

  it("si no hay pago DEPOSIT aprobado con mpPaymentId, marca COMPLETED sin llamar a MP", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("100.00"),
      status: "PENDING",
    });
    // @ts-expect-error mock incomplete Payment for test
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "PENDING", // no está aprobado
      mpPaymentId: null,
    });

    await tripsService.processRefundRequest("i1");

    expect(refundPayment).not.toHaveBeenCalled();
    expect(prisma.refundRequest.update).toHaveBeenCalledWith({
      where: { id: "rr1" },
      data: { status: "COMPLETED" },
    });
  });

  it("procesa reembolso total: llama a MP, actualiza Payment a REFUNDED y RefundRequest a COMPLETED", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("100.00"),
      status: "PENDING",
    });
    // @ts-expect-error mock incomplete Payment for test
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
    });
    vi.mocked(refundPayment).mockResolvedValue(100);

    await tripsService.processRefundRequest("i1");

    expect(prisma.refundRequest.update).toHaveBeenCalledWith({
      where: { id: "rr1" },
      data: { status: "PROCESSING" },
    });
    expect(refundPayment).toHaveBeenCalledWith("mp-77", 100);
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { status: "REFUNDED", refundedAmount: 100 },
    });
    expect(prisma.refundRequest.update).toHaveBeenCalledWith({
      where: { id: "rr1" },
      data: { status: "COMPLETED" },
    });
  });

  it("procesa reembolso parcial (24-48hs): deja Payment APPROVED con refundedAmount", async () => {
    // @ts-expect-error mock incomplete RefundRequest for test
    vi.mocked(prisma.refundRequest.findUnique).mockResolvedValue({
      id: "rr1",
      cargoItemId: "i1",
      targetAmount: new Prisma.Decimal("50.00"),
      status: "PENDING",
    });
    // @ts-expect-error mock incomplete Payment for test
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
    });
    vi.mocked(refundPayment).mockResolvedValue(50);

    await tripsService.processRefundRequest("i1");

    expect(refundPayment).toHaveBeenCalledWith("mp-77", 50);
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { refundedAmount: 50 },
    });
    expect(prisma.payment.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REFUNDED" }) })
    );
    expect(prisma.refundRequest.update).toHaveBeenCalledWith({
      where: { id: "rr1" },
      data: { status: "COMPLETED" },
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
    // @ts-expect-error mock incomplete Payment for test
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
    });
    vi.mocked(refundPayment).mockRejectedValue(
      new Error("network timeout")
    );

    await tripsService.processRefundRequest("i1");

    expect(refundPayment).toHaveBeenCalledWith("mp-77", 100);
    // El processor llama update dos veces: 1) PROCESSING, 2) PENDING con error
    // Verificamos la ÚLTIMA llamada (estado final)
    expect(prisma.refundRequest.update).toHaveBeenLastCalledWith({
      where: { id: "rr1" },
      data: expect.objectContaining({
        status: "PENDING",
        attempts: { increment: 1 },
        lastError: "network timeout",
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
    });
    // @ts-expect-error mock incomplete Payment for test
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
    });
    vi.mocked(refundPayment).mockRejectedValue(
      new AppError("MP rechazó el reembolso", 502, "MP_ERROR")
    );

    await tripsService.processRefundRequest("i1");

    // El processor llama update dos veces: 1) PROCESSING, 2) PENDING con error
    // Verificamos la ÚLTIMA llamada (estado final)
    expect(prisma.refundRequest.update).toHaveBeenLastCalledWith({
      where: { id: "rr1" },
      data: expect.objectContaining({
        status: "PENDING",
        attempts: { increment: 1 },
        lastError: "MP rechazó el reembolso",
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
    });
    // @ts-expect-error mock incomplete Payment for test
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      cargoItemId: "i1",
      type: "DEPOSIT",
      status: "APPROVED",
      amount: new Prisma.Decimal("100.00"),
      mpPaymentId: "mp-77",
    });
    // refundPayment (ya idempotente por Fase 2.1) devuelve lo que MP ya procesó
    vi.mocked(refundPayment).mockResolvedValue(100);

    await tripsService.processRefundRequest("i1");

    expect(refundPayment).toHaveBeenCalledWith("mp-77", 100);
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { status: "REFUNDED", refundedAmount: 100 },
    });
    expect(prisma.refundRequest.update).toHaveBeenCalledWith({
      where: { id: "rr1" },
      data: { status: "COMPLETED" },
    });
  });
});

