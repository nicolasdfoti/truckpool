/**
 * Precio sugerido para un viaje: tarifa base + costo por km según el tipo de
 * vehículo.
 *
 * La idea es que el fletero no arranque a inventar un número desde cero (la
 * mayoría se sube o se cuelga mucho) y que la empresa vea precios que se
 * pueden comparar entre viajes. El fletero manda el precio: la sugerencia y su
 * rango de ±15% son una referencia, y fuera del rango el client solo avisa
 * (D5 = b). El server no rechaza ningún precio por estar lejos del sugerido.
 *
 * ---------------------------------------------------------------------------
 * CÓMO SALIERON LOS NÚMEROS (agosto 2026, valores de referencia, no una lista
 * oficial: en Argentina el flete está desregulado y no hay precio único).
 *
 * Referencia de costo, por km, para un camión en ruta (CCT 40/89, gasoil
 * ~$2.100/l):
 *   - combustible: un semirremolque vacío ya gasta ~29 L/100 km, y cada tonelada
 *     de carga suma ~0,25 L/100 km;
 *   - chofer: ~$1.506.000 por mes con cargas sociales, unas 15.000 km al mes;
 *   - peajes: el ICT de FADEEAC subió 44% interanual en 2026.
 *
 * Ese es el costo de un viaje DEDICADO. TruckPool no vende eso: vende el
 * espacio libre de un camión que ya está yendo a ese destino, así que la tarifa
 * que corresponde es el costo MARGINAL de sumar carga (unos $115/km de gasoil
 * extra para un semirremolque, más peaje y mano de obra marginales) con un
 * margen chico. De ahí que estas cifras sean varias veces más bajas que una
 * tarifa de flete dedicado: un camión completo de 30 t se cobra del orden de
 * los $8.000/km, y acá un semirremolque va ~$380/km porque el fletero no corre
 * en vacío.
 *
 * Para cambiar precios no hay que tocar lógica: se edita RATE_TABLE (y, si
 * cambia la tolerancia, PRICE_TOLERANCE).
 * ---------------------------------------------------------------------------
 */
import { Prisma } from "@prisma/client";

export type Rate = {
  /** piso del viaje: salir a la calle, esperar la carga, papeles */
  baseFee: number;
  /** costo por kilómetro recorrido */
  perKm: number;
};

const CHASIS: Rate = { baseFee: 3000, perKm: 180 };
const CAMION: Rate = { baseFee: 5000, perKm: 260 };
const TRAILER: Rate = { baseFee: 9000, perKm: 380 };

/**
 * Las claves son los tipos de vehículo que ofrece el cliente. "Semi" y
 * "Tráiler" son lo mismo (semirremolque) y comparten tarifa, pero llegan
 * strings distintos del select, así que los dos tienen fila propia.
 */
export const RATE_TABLE: Record<string, Rate> = {
  Chasis: CHASIS,
  Camión: CAMION,
  Tráiler: TRAILER,
  Semi: TRAILER,
};

/**
 * El ancho del rango de referencia alrededor de la sugerencia. Fuera de él el
 * client avisa, pero no bloquea (D5 = b).
 */
export const PRICE_TOLERANCE = 0.15;

/**
 * La distancia que calcula `haversineKm` es en línea recta, y por caminos una
 * ruta es bastante más larga: Rosario→Córdoba son 374 km en línea recta y
 * cerca de 700 por rutas. Cobrar por km recto daba un precio que rondaba la
 * mitad de lo que el fletero necesita, así que el precio se calcula sobre la
 * distancia de ruta estimada.
 *
 * OJO: esto NO cambia la `distanceKm` que se muestra y que usa la búsqueda por
 * proximidad, esa sigue siendo la real en línea recta. Si se quiere precio
 * sobre línea recta, poner 1.
 */
export const ROAD_DISTANCE_FACTOR = 1.25;

/**
 * Para un tipo de vehículo que no está en la tabla (el campo es texto libre y
 * un cliente viejo o un import pueden mandar cualquier cosa) se usa la tarifa
 * del camión, que es la del medio. La alternativa era bloquear la publicación
 * de un viaje por un tipo mal escrito.
 */
const FALLBACK_RATE: Rate = CAMION;

/**
 * Con más distancia que esto (en línea recta, la `distanceKm` que se muestra)
 * no se sugiere precio: ningún viaje dentro de Argentina se acerca, así que lo
 * más probable es que el geocode haya resuelto mal una punta ("Córdoba" en
 * España daba 10.412 km y un sugerido que pisaba el precio real).
 */
export const SUGGESTION_MAX_DISTANCE_KM = 5_000;

function roundToHundreds(value: number): number {
  return Math.round(value / 100) * 100;
}

function normalizeKey(truckType: string): string {
  return truckType.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// sin acentos ni mayúsculas, "Camión"/"camion"/"CAMIÓN" caen en la misma fila
const NORMALIZED_TABLE: Record<string, Rate> = Object.fromEntries(
  Object.entries(RATE_TABLE).map(([key, rate]) => [normalizeKey(key), rate])
);

export function rateFor(truckType: string): Rate {
  return NORMALIZED_TABLE[normalizeKey(truckType)] ?? FALLBACK_RATE;
}

/**
 * Precio sugerido para una distancia. Se redondea a centenas porque un
 * fletero no cotiza $47.283: los números redondos se comparan y se recuerdan.
 */
export function calculateSuggestedPrice(truckType: string, distanceKm: number): number {
  const { baseFee, perKm } = rateFor(truckType);
  const km = Math.max(0, distanceKm * ROAD_DISTANCE_FACTOR);
  return roundToHundreds(baseFee + perKm * km);
}

export type PriceRange = {
  distanceKm: number;
  suggestedPrice: number;
  minPrice: number;
  maxPrice: number;
};

/**
 * La sugerencia y su rango de referencia. El piso se redondea para abajo y el
 * techo para arriba, así el rango que ve en pantalla nunca es más angosto que
 * el ±15% real. `null` con más de `SUGGESTION_MAX_DISTANCE_KM`: no hay
 * sugerencia.
 */
export function priceRangeFor(truckType: string, distanceKm: number): PriceRange | null {
  if (distanceKm > SUGGESTION_MAX_DISTANCE_KM) return null;
  const suggestedPrice = calculateSuggestedPrice(truckType, distanceKm);
  return {
    distanceKm,
    suggestedPrice,
    minPrice: Math.floor((suggestedPrice * (1 - PRICE_TOLERANCE)) / 100) * 100,
    maxPrice: Math.ceil((suggestedPrice * (1 + PRICE_TOLERANCE)) / 100) * 100,
  };
}

export type CargoPrice = {
  /** lo que paga la empresa por su carga: su parte del precio del viaje */
  priceShare: Prisma.Decimal;
  /** la seña, que se congela al reservar */
  depositAmount: Prisma.Decimal;
  /** lo que queda para pagar al salir: priceShare − seña */
  balanceAmount: Prisma.Decimal;
};

/**
 * Cuánto cuesta una carga de `volume` m³ en un viaje: el precio del camión
 * prorrateado por volumen, y la seña como porcentaje de esa parte (no del
 * viaje entero). Es la única fórmula: la usan la reserva (`addCargoItem`) y la
 * cotización que ve la empresa antes de reservar, así no pueden diferir.
 * Todo en Decimal y a centavos, como `Decimal(12,2)` en la base.
 */
export function cargoPrice(
  trip: {
    price: Prisma.Decimal | number | string;
    capacityTotal: number;
    depositPercent: number;
  },
  volume: number
): CargoPrice {
  const priceShare = new Prisma.Decimal(trip.price)
    .mul(volume)
    .div(trip.capacityTotal)
    .toDecimalPlaces(2);
  const depositAmount = priceShare.mul(trip.depositPercent).div(100).toDecimalPlaces(2);
  return { priceShare, depositAmount, balanceAmount: priceShare.minus(depositAmount) };
}
