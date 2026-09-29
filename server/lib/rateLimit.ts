import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";

const WINDOW_MINUTES = 15;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 10;

function maxAttempts(): number {
  const parsed = Number(process.env.AUTH_RATE_LIMIT_MAX);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ATTEMPTS;
}

function enabled(): boolean {
  // Los tests de HTTP pegan a /auth/login y /auth/register decenas de veces en
  // la misma corrida: con el límite prendido todos darían 429. Defining
  // AUTH_RATE_LIMIT_MAX lo fuerza, y el test del límite lo usa justamente para
  // no tener que esperar 15 minutos.
  if (process.env.AUTH_RATE_LIMIT_MAX) return true;
  return process.env.NODE_ENV !== "test" && !process.env.VITEST;
}

function limiter(options: { skipSuccessful: boolean }): RequestHandler {
  if (!enabled()) {
    return (_req, _res, next) => next();
  }
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: maxAttempts(),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // En el login solo cuentan los intentos fallidos: un usuario que entra y
    // sale veinte veces no es un atacante, y bloquearlo sería un bug de UX.
    // En el registro TODOS los intentos cuentan, porque un alta de cuenta siempre
    // consume recursos (mail, base de datos, verificación).
    skipSuccessfulRequests: options.skipSuccessful,
    handler: (_req, res) => {
      res.status(429).json({
        error: `demasiados intentos. probá de nuevo en ${WINDOW_MINUTES} minutos.`,
        code: "RATE_LIMITED",
      });
    },
  });
}

/** Login: 10 intentos por IP cada 15 minutos (solo los fallidos cuentan). */
export const loginRateLimit = limiter({ skipSuccessful: true });

/** Registro: 10 altas por IP cada 15 minutos. */
export const registerRateLimit = limiter({ skipSuccessful: false });
