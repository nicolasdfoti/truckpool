import { z } from "zod";

export const TRIP_FEATURES = [
  "refrigeracion",
  "seguro",
  "carga_fragil",
  "expreso",
  "carga_y_descarga",
] as const;

export type TripFeature = (typeof TRIP_FEATURES)[number];

export type ProximityFilter = {
  lat: number;
  lng: number;
  radiusKm: number;
};

export const createCargoItemSchema = z.object({
  description: z.string().trim().min(1, "la descripción es obligatoria"),
  volume: z
    .number({ message: "volume debe ser un número" })
    .positive("volume debe ser mayor a 0")
    .finite("volume debe ser un número válido"),
  pickupAddress: z.string().trim().min(1, "la dirección de retiro es obligatoria"),
});

export type CreateCargoItemInput = z.infer<typeof createCargoItemSchema>;

/**
 * Hora de salida en formato 24h "HH:mm". Opcional a propósito: es un dato que
 * muchos fleteros no quieren prometer, y el viaje se publica igual sin él. Se
 * valida con regex y no con `Date`: "25:00" tiene que ser un error de cliente,
 * no una fecha que JS normaliza en silencio.
 */
const DEPARTURE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const departureTimeSchema = z
  .string()
  .trim()
  .regex(DEPARTURE_TIME, "la hora tiene que tener formato HH:mm")
  .optional()
  .nullable();

export const createTripSchema = z.object({
  origin: z.string().trim().min(1, "el origen es obligatorio"),
  destination: z.string().trim().min(1, "el destino es obligatorio"),
  // punto exacto de salida (depósito, galpón). Opcional: si no viene se usa el origin general.
  departureAddress: z.string().trim().optional().nullable(),
  date: z.coerce.date({ message: "la fecha es inválida" }),
  departureTime: departureTimeSchema,
  truckType: z.string().trim().min(1, "el tipo de vehículo es obligatorio"),
  capacityTotal: z
    .number({ message: "capacityTotal debe ser un número" })
    .positive("capacityTotal debe ser mayor a 0")
    .finite("capacityTotal debe ser un número válido"),
  price: z
    .number({ message: "price debe ser un número" })
    .positive("price debe ser mayor a 0")
    .finite("price debe ser un número válido"),
  // cuánto deja cada empresa como seña al reservar espacio. El piso de 10%
  // evita que el transportista publique viajes con una seña simbólica; el
  // techo de 50% evita que la mitad del flete quede en manos de la plataforma.
  depositPercent: z.coerce
    .number({ message: "depositPercent debe ser un número" })
    .int("depositPercent debe ser un número entero")
    .min(10, "la seña no puede ser menos del 10%")
    .max(50, "la seña no puede ser más del 50%")
    .optional()
    .default(20),
  features: z.array(z.enum(TRIP_FEATURES)).optional().default([]),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;

export const updateTripStatusSchema = z.object({
  status: z.enum(["IN_TRANSIT", "COMPLETED"]),
});

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const optionalDate = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.date({ message: "la fecha es inválida" }).optional()
);

const optionalFeatures = z.preprocess(
  (value) => {
    if (value === undefined || value === "") return undefined;
    return Array.isArray(value) ? value : [value];
  },
  z.array(z.enum(TRIP_FEATURES)).optional()
);

/**
 * Filtro de proximidad: "lat,lng,radioKm" — ej: "-32.9468,-60.6393,50".
 * El radio está en kilómetros y va de 1 a 500.
 */
const proximityPoint = z
  .string()
  .trim()
  .transform((value, ctx): ProximityFilter | undefined => {
    const parts = value.split(",").map((part) => Number(part.trim()));
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
      ctx.addIssue({
        code: "custom",
        message:
          "el filtro por distancia tiene que ser lat,lng,radioKm (ej: -32.94,-60.63,50)",
      });
      return z.NEVER;
    }
    const lat = parts[0] as number;
    const lng = parts[1] as number;
    const radiusKm = parts[2] as number;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      ctx.addIssue({ code: "custom", message: "las coordenadas están fuera de rango" });
      return z.NEVER;
    }
    if (radiusKm < 1 || radiusKm > 500) {
      ctx.addIssue({
        code: "custom",
        message: "el radio tiene que estar entre 1 y 500 km",
      });
      return z.NEVER;
    }
    return { lat, lng, radiusKm };
  });

export const listTripsQuerySchema = z.object({
  origin: optionalText,
  destination: optionalText,
  dateFrom: optionalDate,
  dateTo: optionalDate,
  features: optionalFeatures,
  nearOrigin: proximityPoint.optional(),
  nearDestination: proximityPoint.optional(),
});

export type ListTripsQuery = z.infer<typeof listTripsQuerySchema>;

export const geocodeQuerySchema = z.object({
  address: z.string().trim().min(1, "la dirección es obligatoria"),
});

/**
 * Estimación de precio para un viaje que todavía no existe: el form la pide
 * mientras el fletero escribe origen y destino, así que no hay Trip del cual
 * sacar las coordenadas. El server geocodifica los dos strings.
 */
export const priceEstimateQuerySchema = z.object({
  origin: z.string().trim().min(1, "el origen es obligatorio"),
  destination: z.string().trim().min(1, "el destino es obligatorio"),
  truckType: z.string().trim().min(1, "el tipo de vehículo es obligatorio"),
});

export type PriceEstimateQuery = z.infer<typeof priceEstimateQuerySchema>;

/**
 * Parámetros para pedir al backend cuánto se devolvería de una seña si se
 * retirara ahora. El cliente NO reimplementa esta fórmula: la pide, para que
 * un cambio en PARTIAL_REFUND_RATIO no pueda dejar al cliente prometiendo un
 * número que el server no va a cumplir.
 */
export const cancellationQuoteQuerySchema = z.object({
  depositAmount: z.coerce
    .number("el monto de la seña debe ser un número")
    .finite("el monto de la seña debe ser un número válido")
    .min(0, "el monto de la seña no puede ser negativo"),
  tripDate: z
    .string()
    .trim()
    .min(1, "la fecha del viaje es obligatoria")
    .refine((v) => !Number.isNaN(new Date(v).getTime()), {
      message: "la fecha del viaje no es válida",
    }),
});

export type CancellationQuoteQuery = z.infer<typeof cancellationQuoteQuerySchema>;

/**
 * Posición que manda el navegador del transportista. El rango se valida acá
 * porque un NaN o una lat de 900 rompería el mapa del cliente (y cualquier
 * consulta por radio posterior).
 */
const coordinate = (name: string, min: number, max: number) =>
  z
    .number({ message: `${name} debe ser un número` })
    .finite(`${name} debe ser un número válido`)
    .min(min, `${name} tiene que estar entre ${min} y ${max}`)
    .max(max, `${name} tiene que estar entre ${min} y ${max}`);

export const createLocationSchema = z.object({
  lat: coordinate("lat", -90, 90),
  lng: coordinate("lng", -180, 180),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const locationQuerySchema = z.object({
  // ?history=true devuelve el recorrido completo, no solo el último punto.
  history: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
});

export type LocationQuery = z.infer<typeof locationQuerySchema>;

export const createReviewSchema = z.object({
  rating: z
    .number({ message: "rating debe ser un número" })
    .int("rating debe ser un entero")
    .min(1, "rating debe estar entre 1 y 5")
    .max(5, "rating debe estar entre 1 y 5"),
  comment: z
    .string()
    .trim()
    .max(500, "el comentario puede tener hasta 500 caracteres")
    .optional(),
  // solo hace falta cuando el viaje tiene más de una empresa con carga:
  // el fletero tiene que indicar a cuál de ellas está calificando.
  toUserId: z.string().trim().min(1).optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const createMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "el mensaje no puede quedar vacío")
    .max(1000, "el mensaje puede tener hasta 1000 caracteres"),
  toUserId: z.string().trim().min(1, "tenés que indicar a quién le escribís"),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;
