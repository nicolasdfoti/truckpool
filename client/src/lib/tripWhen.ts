/**
 * Fecha y hora de un viaje. La hora va suelta (`departureTime` "HH:mm") porque
 * el día es el `date` del viaje y la hora es la que prometió el fletero: sumarla
 * al Date convertiría todo a la zona horaria del navegador.
 */
export function formatTripDate(date: string): string {
  return new Date(date).toLocaleDateString("es-AR");
}

/** "12/10 · 06:30", o solo la fecha si el viaje no tiene hora de salida. */
export function formatTripWhen(date: string, departureTime: string | null): string {
  const day = formatTripDate(date);
  return departureTime ? `${day} · ${departureTime}` : day;
}

const AR_TIME_ZONE = "America/Argentina/Buenos_Aires";

/**
 * Un instante que manda el server (ISO), en hora de Argentina: "mar 4/11 23:52".
 * Los plazos (vencimiento de la reserva) se cuentan en ART, así que se muestran
 * en ART aunque el navegador esté en otra zona.
 */
export function formatInstant(iso: string): string {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: AR_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday").replace(".", "");
  return `${weekday} ${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}

/** el día calendario en Argentina, "2026-11-13" (comparable como texto) */
function argentinaDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * QW18: la fecha ya llegó (hoy o antes, en Argentina). Es la misma regla que el
 * server (`isTripDateAvailable`): un viaje para hoy ya no recibe cargas, así que
 * una solicitud con esa fecha no se puede aceptar.
 */
export function isDateReached(iso: string, now: Date = new Date()): boolean {
  return argentinaDay(new Date(iso)) <= argentinaDay(now);
}
