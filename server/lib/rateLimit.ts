/**
 * Rate limits de la API (express-rate-limit, store en memoria).
 *
 * Por qué en memoria alcanza hoy: hay una sola instancia del server (04 §4).
 * Si se escala a más de una:
 * - cada proceso cuenta por su lado, así que el límite real queda multiplicado
 *   por la cantidad de instancias, y un redeploy resetea los contadores;
 * - el límite por email del login se esquiva repartiendo los intentos entre
 *   instancias;
 * - hace falta un store compartido (rate-limit-redis o uno sobre Postgres) y que
 *   todas las instancias tengan el mismo TRUST_PROXY. La cola de Nominatim y la
 *   caché de geocode tienen el mismo problema.
 *
 * Cómo se prenden (`rateLimitsEnabled`): RATE_LIMITS="on" | "off" | vacío.
 * Vacío = prendidos, salvo con vitest, donde la suite pega decenas de veces a
 * las mismas rutas. "off" no se acepta en producción (lib/env.ts). Los tests de
 * los límites ponen RATE_LIMITS=on y recargan la app. AUTH_RATE_LIMIT_MAX
 * además fuerza los de login y registro (así lo usan sus tests).
 */
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Request, RequestHandler } from "express";

const MINUTE_MS = 60 * 1000;

const AUTH_WINDOW_MINUTES = 15;
const DEFAULT_AUTH_MAX_ATTEMPTS = 10;

/**
 * Los límites de cada ruta, en un solo lugar. `user`: cuenta por usuario y va
 * después de requireAuth; `ip`: rutas públicas.
 */
export const RATE_LIMITS = {
  /** reservar espacio en un viaje (además del tope de reservas sin pagar de L4) */
  cargoItems: { windowMs: 15 * MINUTE_MS, limit: 10, key: "user" },
  /** cada preference es un pedido a la cuenta MP del fletero */
  paymentPreference: { windowMs: 15 * MINUTE_MS, limit: 10, key: "user" },
  /** cada mensaje genera un aviso */
  messages: { windowMs: 5 * MINUTE_MS, limit: 30, key: "user" },
  /** cada solicitud le manda un email al fletero */
  tripRequests: { windowMs: 60 * MINUTE_MS, limit: 5, key: "user" },
  /** amplificación hacia OSRM; con sesión desde L2 */
  routeGeometry: { windowMs: MINUTE_MS, limit: 60, key: "user" },
  /** enumeración de códigos: las dos rutas comparten este límite */
  tracking: { windowMs: 15 * MINUTE_MS, limit: 30, key: "ip" },
  /** proxy a Nominatim: la cola de 1 pedido/s es compartida con las reservas */
  geocode: { windowMs: MINUTE_MS, limit: 20, key: "ip" },
  priceEstimate: { windowMs: MINUTE_MS, limit: 20, key: "ip" },
  /** el resumen de la reserva la pide al cambiar el volumen */
  cargoQuote: { windowMs: MINUTE_MS, limit: 60, key: "ip" },
} as const satisfies Record<
  string,
  { windowMs: number; limit: number; key: "ip" | "user" }
>;

export function rateLimitsEnabled(): boolean {
  const flag = process.env.RATE_LIMITS;
  if (flag === "on") return true;
  if (flag === "off") return false;
  return process.env.NODE_ENV !== "test" && !process.env.VITEST;
}

function minutesText(windowMs: number): string {
  const minutes = Math.max(1, Math.round(windowMs / MINUTE_MS));
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

function ipKey(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

export type RateLimitOptions = {
  /** solo para leer el código: cada límite tiene su propio contador */
  name: string;
  windowMs: number;
  limit: number;
  key: "ip" | "user";
  /** solo cuentan los pedidos que fallan (el login) */
  skipSuccessful?: boolean;
  /** el texto del 429; por defecto «demasiados pedidos…» */
  message?: string;
  /** prendido aunque RATE_LIMITS no lo esté (AUTH_RATE_LIMIT_MAX) */
  force?: boolean;
};

/**
 * Un límite. Responde 429 `{ error, code: "RATE_LIMITED" }` (el código lo usa
 * el client: no cambiarlo). Por usuario cuenta `req.user.id`, así que va
 * después de requireAuth; sin sesión cae a la IP.
 */
export function createRateLimit(options: RateLimitOptions): RequestHandler {
  if (!options.force && !rateLimitsEnabled()) {
    return (_req, _res, next) => next();
  }
  const message =
    options.message ??
    `demasiados pedidos. probá de nuevo en ${minutesText(options.windowMs)}.`;
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessful ?? false,
    keyGenerator: (req) =>
      options.key === "user" && req.user ? `user:${req.user.id}` : ipKey(req),
    handler: (_req, res) => {
      res.status(429).json({ error: message, code: "RATE_LIMITED" });
    },
  });
}

function routeLimit(name: keyof typeof RATE_LIMITS): RequestHandler {
  return createRateLimit({ name, ...RATE_LIMITS[name] });
}

export const cargoItemsRateLimit = routeLimit("cargoItems");
export const paymentPreferenceRateLimit = routeLimit("paymentPreference");
export const messagesRateLimit = routeLimit("messages");
export const tripRequestsRateLimit = routeLimit("tripRequests");
export const routeGeometryRateLimit = routeLimit("routeGeometry");
/** una sola instancia para /api/tracking/:code y /api/trips/tracking/:code */
export const trackingRateLimit = routeLimit("tracking");
export const geocodeRateLimit = routeLimit("geocode");
export const priceEstimateRateLimit = routeLimit("priceEstimate");
export const cargoQuoteRateLimit = routeLimit("cargoQuote");

// ── login y registro ────────────────────────────────────────────────────────

function authMaxAttempts(): number {
  const parsed = Number(process.env.AUTH_RATE_LIMIT_MAX);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTH_MAX_ATTEMPTS;
}

function authLimit(skipSuccessful: boolean): RequestHandler {
  return createRateLimit({
    name: skipSuccessful ? "login" : "register",
    windowMs: AUTH_WINDOW_MINUTES * MINUTE_MS,
    limit: authMaxAttempts(),
    key: "ip",
    // En el login solo cuentan los intentos fallidos: un usuario que entra y
    // sale veinte veces no es un atacante, y bloquearlo sería un bug de UX.
    // En el registro TODOS los intentos cuentan, porque un alta de cuenta siempre
    // consume recursos (mail, base de datos, verificación).
    skipSuccessful,
    message: `demasiados intentos. probá de nuevo en ${AUTH_WINDOW_MINUTES} minutos.`,
    // Los tests de HTTP pegan a /auth/login y /auth/register decenas de veces
    // en la misma corrida; definir AUTH_RATE_LIMIT_MAX lo fuerza, y el test del
    // límite lo usa para no tener que esperar 15 minutos.
    force: Boolean(process.env.AUTH_RATE_LIMIT_MAX),
  });
}

/** Login: 10 intentos por IP cada 15 minutos (solo los fallidos cuentan). */
export const loginRateLimit = authLimit(true);

/** Registro: 10 altas por IP cada 15 minutos. */
export const registerRateLimit = authLimit(false);
