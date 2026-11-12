import { describe, it, expect } from "vitest";
import {
  createTripSchema,
  listTripsQuerySchema,
} from "../modules/trips/trips.schemas.js";
import { createTripRequestSchema } from "../modules/users/users.schemas.js";

// Las fechas que manda el client: un "YYYY-MM-DD" (input type=date) es un día
// calendario argentino y se guarda al mediodía ART. z.coerce.date lo leía como
// medianoche UTC, que en Argentina es el día anterior a las 21:00: una
// solicitud para mañana quedaba para hoy. Una fecha con hora entra tal cual.

const MEDIODIA_ART_13 = new Date("2026-11-13T15:00:00.000Z");

const tripRequest = {
  carrierId: "u1",
  origin: "Córdoba",
  destination: "Rosario",
  estimatedVolume: 10,
};

const trip = {
  origin: "Córdoba",
  destination: "Rosario",
  departureTime: "08:00",
  truckType: "Semi",
  capacityTotal: 30,
  price: 250_000,
};

describe("fechas sin hora como día en Argentina", () => {
  it("solicitud de viaje: desiredDate YYYY-MM-DD → mediodía ART de ese día", () => {
    const parsed = createTripRequestSchema.parse({
      ...tripRequest,
      desiredDate: "2026-11-13",
    });
    expect(parsed.desiredDate).toEqual(MEDIODIA_ART_13);
  });

  it("publicar un viaje: date YYYY-MM-DD → mediodía ART de ese día", () => {
    const parsed = createTripSchema.parse({ ...trip, date: "2026-11-13" });
    expect(parsed.date).toEqual(MEDIODIA_ART_13);
  });

  it("listado: dateFrom y dateTo YYYY-MM-DD → mediodía ART de cada día", () => {
    const parsed = listTripsQuerySchema.parse({
      dateFrom: "2026-11-13",
      dateTo: "2026-11-20",
    });
    expect(parsed.dateFrom).toEqual(MEDIODIA_ART_13);
    expect(parsed.dateTo).toEqual(new Date("2026-11-20T15:00:00.000Z"));
  });

  it("una fecha con hora entra tal cual (así publica el client hoy)", () => {
    const iso = "2026-11-13T15:00:00.000Z";
    expect(createTripSchema.parse({ ...trip, date: iso }).date).toEqual(new Date(iso));
    const otra = "2026-11-13T10:30:00.000Z";
    expect(
      createTripRequestSchema.parse({ ...tripRequest, desiredDate: otra }).desiredDate
    ).toEqual(new Date(otra));
  });

  it.each(["2026-02-30", "no-es-fecha"])("rechaza %j", (value) => {
    expect(
      createTripRequestSchema.safeParse({ ...tripRequest, desiredDate: value }).success
    ).toBe(false);
    expect(createTripSchema.safeParse({ ...trip, date: value }).success).toBe(false);
    expect(listTripsQuerySchema.safeParse({ dateFrom: value }).success).toBe(false);
  });

  it("los filtros vacíos siguen siendo opcionales", () => {
    const parsed = listTripsQuerySchema.parse({ dateFrom: "", dateTo: undefined });
    expect(parsed.dateFrom).toBeUndefined();
    expect(parsed.dateTo).toBeUndefined();
  });
});
