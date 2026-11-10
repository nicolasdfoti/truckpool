import { describe, it, expect } from "vitest";
import {
  DEFAULT_DEPARTURE_TIME,
  departureInstant,
  hoursUntilDeparture,
  quoteCancellation,
} from "../lib/cancellation.js";

// U11: la ventana de retiro se mide contra la salida que ve la empresa (día del
// viaje + hora de salida, en hora argentina), no contra el instante guardado en
// `date` (el mediodía del navegador del fletero, ~15:00Z).
describe("departureInstant", () => {
  it("arma la salida con el día del viaje y la hora, en hora argentina", () => {
    const salida = departureInstant(new Date("2026-11-11T15:00:00.000Z"), "18:00");
    expect(salida.toISOString()).toBe("2026-11-11T21:00:00.000Z");
  });

  it("una salida temprano cae en el mismo día, antes del mediodía guardado", () => {
    const salida = departureInstant(new Date("2026-11-11T15:00:00.000Z"), "06:00");
    expect(salida.toISOString()).toBe("2026-11-11T09:00:00.000Z");
  });

  it("el día es el de Argentina aunque en UTC ya sea el siguiente", () => {
    // 02:30Z del 12/11 son las 23:30 del 11/11 en Argentina
    const salida = departureInstant(new Date("2026-11-12T02:30:00.000Z"), "18:00");
    expect(salida.toISOString()).toBe("2026-11-11T21:00:00.000Z");
  });

  it("un viaje viejo sin hora sale a las 23:59 de Argentina de su día", () => {
    expect(DEFAULT_DEPARTURE_TIME).toBe("23:59");
    const salida = departureInstant(new Date("2026-11-11T15:00:00.000Z"), null);
    expect(salida.toISOString()).toBe("2026-11-12T02:59:00.000Z");
  });

  it("acepta la fecha como texto ISO (es lo que manda el quote)", () => {
    const salida = departureInstant("2026-11-11T15:00:00.000Z", "18:00");
    expect(salida.toISOString()).toBe("2026-11-11T21:00:00.000Z");
  });
});

describe("hoursUntilDeparture", () => {
  it("cuenta las horas hasta la salida, no hasta el mediodía guardado", () => {
    const trip = { date: new Date("2026-11-11T15:00:00.000Z"), departureTime: "18:00" };
    const ahora = new Date("2026-11-09T09:00:00.000Z");
    expect(hoursUntilDeparture(trip, ahora)).toBe(60);
  });

  it("sin hora cuenta hasta las 23:59 de Argentina", () => {
    const trip = { date: new Date("2026-11-11T15:00:00.000Z"), departureTime: null };
    const ahora = new Date("2026-11-10T02:59:00.000Z");
    expect(hoursUntilDeparture(trip, ahora)).toBe(48);
  });
});

// después de la salida ya no se retira: si el fletero no sale, D6 cancela el
// viaje y devuelve la seña entera. Retirar tarde haría perderla.
describe("quoteCancellation en la salida", () => {
  const MIN = 1 / 60;

  it("un minuto antes de la salida se puede retirar, sin devolución", () => {
    expect(quoteCancellation(100, MIN)).toEqual({
      window: "NO_REFUND",
      cancellable: true,
      refundAmount: 0,
      feeAmount: 100,
    });
  });

  it("en la salida exacta ya no se puede retirar", () => {
    expect(quoteCancellation(100, 0)).toEqual({
      window: "CLOSED",
      cancellable: false,
      refundAmount: 0,
      feeAmount: 0,
    });
  });

  it("un minuto después de la salida ya no se puede retirar", () => {
    expect(quoteCancellation(100, -MIN)).toMatchObject({
      window: "CLOSED",
      cancellable: false,
    });
  });

  it("antes de la salida el quote dice que se puede retirar", () => {
    expect(quoteCancellation(100, 60)).toMatchObject({
      window: "FULL_REFUND",
      cancellable: true,
    });
  });
});
