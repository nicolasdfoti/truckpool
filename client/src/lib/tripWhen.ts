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
