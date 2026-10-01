/**
 * El día calendario de un viaje se decide en hora Argentina, no en UTC.
 *
 * Por qué importa: un viaje publicado para "hoy" se guarda como el instante de
 * las 12:00 del navegador del transportista, o sea ~15:00Z. Comparado contra la
 * medianoche UTC, ese viaje seguiría "disponible" durante ~12 horas de más, y
 * además el resultado dependería de la hora del servidor. El negocio es simple:
 * un viaje disponible es el que tiene su día calendario más adelante que hoy en
 * Argentina (mañana, pasado mañana, ...).
 *
 * Sin librería de fechas: alcanza con leer las partes del instante en la zona
 * con Intl y volver a armar el instante de la medianoche local.
 */
export const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires";

type CalendarParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function calendarParts(instant: Date, timeZone: string): CalendarParts {
  // hourCycle h23 y no hour12:false porque en algunos ICU la medianoche en
  // formato de 12 horas sale como "24" y esa hora no existe.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/** "YYYY-MM-DD" del día que cae dentro de timeZone. */
export function calendarDayKey(instant: Date, timeZone: string = ARGENTINA_TIME_ZONE): string {
  const { year, month, day } = calendarParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Minutos que hay que sumar a la hora local para llegar al instante UTC. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = calendarParts(instant, timeZone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // sin los milisegundos el offset sale en minutos enteros
  return (localAsUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000;
}

/** Instante UTC de las 00:00 del día indicado dentro de timeZone. */
function startOfDayInstant(day: CalendarParts, timeZone: string): Date {
  const naive = Date.UTC(day.year, day.month - 1, day.day, 0, 0, 0);
  // el offset se calcula sobre un instante tentativa y se corrige: con dos
  // pasadas alcanza incluso en zonas con cambio de horario, porque el segundo
  // offset ya se mide sobre el instante casi correcto.
  let instant = new Date(naive);
  for (let i = 0; i < 2; i++) {
    instant = new Date(naive - offsetMinutes(instant, timeZone) * 60_000);
  }
  return instant;
}

function nextCalendarDay(day: CalendarParts): CalendarParts {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

/**
 * Último milisegundo del día de hoy en Argentina. Es el corte de disponibilidad:
 * `Trip.date > corte` equivale a "el día calendario del viaje es posterior a hoy
 * en Argentina". Es un instante, así que sirve tanto para el `where` de Prisma
 * como para comparar en memoria sin duplicar la regla.
 */
export function endOfArgentinaDay(now: Date = new Date()): Date {
  const today = calendarParts(now, ARGENTINA_TIME_ZONE);
  const tomorrowStart = startOfDayInstant(nextCalendarDay(today), ARGENTINA_TIME_ZONE);
  return new Date(tomorrowStart.getTime() - 1);
}

/**
 * Regla de negocio de la disponibilidad: un viaje todavía puede recibir cargas
 * mientras su fecha caiga en un día posterior al de hoy (Argentina). Mañana sí,
 * hoy no, ayer tampoco.
 *
 * Ojo con el nombre: dice si la *fecha* habilita, no si el viaje acepta carga.
 * El estado guardado sigue siendo el que decide lo demás (ver
 * toTripSummary, que combina las dos condiciones).
 */
export function isTripDateAvailable(tripDate: Date | string, now: Date = new Date()): boolean {
  return new Date(tripDate).getTime() > endOfArgentinaDay(now).getTime();
}
