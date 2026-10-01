import { describe, it, expect } from "vitest";
import {
  ARGENTINA_TIME_ZONE,
  calendarDayKey,
  endOfArgentinaDay,
  isTripDateAvailable,
} from "../lib/dates.js";

/**
 * Todos los `now` son fijos: la disponibilidad depende del día calendario, así
 * que los tests no pueden depender de la hora en que corren.
 */
const AR = (iso: string) => new Date(iso);

/** 2026-09-30 es el "hoy" de referencia de todos los casos. */
const HOY_9AM_ART = AR("2026-09-30T12:00:00.000Z"); // 09:00 del 30/09 en AR
const HOY_2359_ART = AR("2026-09-30T23:59:00.000Z"); // 20:59 del 30/09 en AR
const AYER_2359_ART = AR("2026-09-29T23:59:00.000Z"); // 20:59 del 29/09 en AR
const MANANA_MEDIANOCHE_ART = AR("2026-10-01T03:00:00.000Z"); // 00:00 del 01/10 en AR

/** Instante con el que se guarda un viaje publicado para un día dado (~12:00 AR). */
const viajeDe = (dia: string) => AR(`${dia}T15:00:00.000Z`);

describe("calendarDayKey", () => {
  it("devuelve el día local, no el día UTC", () => {
    // Argentina es UTC-3, así que el día local cambia a las 03:00Z
    expect(calendarDayKey(AR("2026-09-30T02:59:59.999Z"))).toBe("2026-09-29");
    expect(calendarDayKey(AR("2026-09-30T03:00:00.000Z"))).toBe("2026-09-30");
    // 01:00Z todavía es la noche del 29/09 en Argentina
    expect(calendarDayKey(AR("2026-09-30T01:00:00.000Z"))).toBe("2026-09-29");
  });

  it("acepta cualquier zona, no sólo Argentina", () => {
    expect(calendarDayKey(AR("2026-09-30T01:00:00.000Z"), "UTC")).toBe("2026-09-30");
    expect(calendarDayKey(AR("2026-09-30T01:00:00.000Z"), ARGENTINA_TIME_ZONE)).toBe(
      "2026-09-29"
    );
  });
});

describe("endOfArgentinaDay", () => {
  it("cae un milisegundo antes de la medianoche argentina del día siguiente", () => {
    // el 30/09 arranca a las 00:00 AR = 03:00Z; el corte es 02:59:59.999Z
    expect(endOfArgentinaDay(HOY_9AM_ART).toISOString()).toBe("2026-10-01T02:59:59.999Z");
    // a las 20:59 de ese mismo día el corte todavía es el mismo
    expect(endOfArgentinaDay(HOY_2359_ART).toISOString()).toBe("2026-10-01T02:59:59.999Z");
  });

  it("no depende de la hora: mientras sea el mismo día local, el corte es el mismo", () => {
    expect(endOfArgentinaDay(HOY_9AM_ART).getTime()).toBe(
      endOfArgentinaDay(HOY_2359_ART).getTime()
    );
  });

  it("cambia al cruzar la medianoche argentina, no la UTC", () => {
    // 00:30 del 30/09 en AR todavía usa el corte del 30/09
    const antes = endOfArgentinaDay(AR("2026-09-30T00:30:00.000Z"));
    expect(antes.toISOString()).toBe("2026-09-30T02:59:59.999Z");
    // 03:30Z ya es 00:30 del 30/09 en AR: mismo día local, mismo corte
    const despues = endOfArgentinaDay(AR("2026-09-30T03:30:00.000Z"));
    expect(despues.toISOString()).toBe("2026-10-01T02:59:59.999Z");
  });
});

describe("isTripDateAvailable", () => {
  it("mañana está disponible", () => {
    expect(isTripDateAvailable(viajeDe("2026-10-01"), HOY_9AM_ART)).toBe(true);
  });

  it("hoy no está disponible aunque el instante sea posterior a la medianoche UTC", () => {
    // el viaje de hoy se guarda a las 12:00 AR = 15:00Z. Con un cálculo en UTC
    // esto pasaría como disponible hasta las 21:00, que es el bug que evita
    // trabajar con el día local.
    const viajeDeHoy = viajeDe("2026-09-30");
    expect(viajeDeHoy.getTime()).toBeGreaterThan(HOY_9AM_ART.getTime());
    expect(isTripDateAvailable(viajeDeHoy, HOY_9AM_ART)).toBe(false);
  });

  it("hoy no está disponible ni bien entrada la noche", () => {
    expect(isTripDateAvailable(viajeDe("2026-09-30"), HOY_2359_ART)).toBe(false);
  });

  it("ayer no está disponible", () => {
    expect(isTripDateAvailable(viajeDe("2026-09-29"), AYER_2359_ART)).toBe(false);
  });

  it("el viaje deja de estar disponible al empezar su propio día, no a su hora de salida", () => {
    // un viaje con fecha de mañana se cierra cuando empieza el día de mañana,
    // aunque el camión salga a las 12:00. La regla es de día calendario.
    expect(isTripDateAvailable(viajeDe("2026-10-01"), HOY_9AM_ART)).toBe(true);
    expect(isTripDateAvailable(viajeDe("2026-10-01"), MANANA_MEDIANOCHE_ART)).toBe(false);
  });

  it("el instante exacto del corte es el último no disponible", () => {
    expect(isTripDateAvailable(endOfArgentinaDay(HOY_9AM_ART), HOY_9AM_ART)).toBe(false);
  });

  it("acepta la fecha como string ISO, como la manda el cliente", () => {
    expect(isTripDateAvailable("2026-10-01T15:00:00.000Z", HOY_9AM_ART)).toBe(true);
    expect(isTripDateAvailable("2026-09-30T15:00:00.000Z", HOY_9AM_ART)).toBe(false);
  });
});
