/**
 * La salida de un viaje a X horas de ahora, como la guarda un viaje: el
 * instante (`date`) y la hora de salida de ese instante en hora argentina
 * (`departureTime`). La ventana de retiro se mide contra día + hora (U11), así
 * que un fixture con solo `date` cae en las 23:59 ART de ese día.
 *
 * La hora se trunca al minuto: con el reloj congelado en un minuto redondo la
 * salida queda exacta; con el reloj real queda hasta 59 s antes.
 */
export function salidaEn(hours: number, now: number = Date.now()) {
  const date = new Date(now + hours * 3_600_000);
  const departureTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return { date, departureTime };
}
