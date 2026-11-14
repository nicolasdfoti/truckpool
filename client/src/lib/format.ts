/** "7" o "2,5": los m³ como se leen en castellano */
export function formatM3(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
}

/** "$ 3.000" o "$ 80,50": pesos sin decimales cuando son redondos */
export function formatPesos(n: number): string {
  const whole = Number.isInteger(n);
  return `$ ${n.toLocaleString("es-AR", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * El precio de un viaje llevado a m³: es la misma cuenta que hace el server
 * para prorratear (`cargoPrice`), así que no promete otro número.
 */
export function pricePerM3(trip: { price: number; capacityTotal: number }): number {
  if (trip.capacityTotal <= 0) return 0;
  return Math.round((trip.price / trip.capacityTotal) * 100) / 100;
}

/**
 * "dom 22 nov": el día de un viaje para listados. Usa la misma conversión que
 * `formatTripDate`, así los dos formatos nunca muestran días distintos.
 */
export function formatTripDay(date: string): string {
  return new Date(date)
    .toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })
    .replace(/\./g, "")
    .replace(",", "");
}
