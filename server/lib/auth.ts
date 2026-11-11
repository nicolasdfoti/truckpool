import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { AppError } from "./errors.js";
import { isTokenRevoked } from "./tokenRevocation.js";

/**
 * Secreto de firma.
 *
 * Se lee en cada llamada y no en un `const` de módulo: antes estaba
 * arriba del archivo, y como los imports se evalúan antes que el cuerpo del
 * entrypoint, ese `const` se congelaba con `process.env.JWT_SECRET === undefined`
 * y caía siempre en el valor de desarrollo hardcodeado. Un token de admin
 * firmado con un secreto que está en el código fuente no es una sesión: es una
 * escalada de privilegios para cualquiera que lea el repo.
 *
 * No hay valor por defecto a propósito. Si falta, se cae acá; `assertServerEnv`
 * (`lib/env.ts`) además aborta el arranque antes de escuchar, y la app valida
 * JWT_SECRET contra el valor de desarrollo viejo.
 */
function secret(): string {
  const value = process.env.JWT_SECRET;
  if (value === undefined || value.trim() === "") {
    throw new Error(
      "JWT_SECRET no está definido: no se pueden firmar ni verificar tokens de sesión"
    );
  }
  return value;
}

export function signToken(user: { id: string; role: Role }) {
  return jwt.sign(
    { role: user.role, sub: user.id },
    secret(),
    // el `jti` es lo que permite cerrar la sesión: cada token tiene uno y el
    // logout lo anota en la tabla de revocados (ver lib/tokenRevocation.ts)
    { expiresIn: "7d", jwtid: randomUUID() }
  );
}

/**
 * `state` del OAuth de Mercado Pago.
 *
 * El callback es una redirección del navegador: Mercado Pago manda al usuario
 * a `/me/mp-callback` y a esa request no hay forma de mandarle un header de
 * auth. Por eso la identidad viaja en el `state`, firmado: el callback
 * verifica la firma y sabe a qué usuario guardar el access token.
 *
 * Expiración corta a propósito: si el state se filtra de la URL, sirve diez
 * minutos como mucho, y el token de MP se puede revocar en cualquier momento.
 */
export function signOAuthState(userId: string) {
  return jwt.sign({ purpose: "mp-oauth" }, secret(), {
    subject: userId,
    expiresIn: "10m",
  });
}

export function verifyOAuthState(state: string): string {
  try {
    const payload = jwt.verify(state, secret());
    // un token de sesión no sirve como state: el purpose evita que alguien
    // reúse su propio JWT de login para saltarse la verificación
    if (typeof payload === "string" || !payload.sub || payload.purpose !== "mp-oauth") {
      throw new Error("payload inválido");
    }
    return payload.sub;
  } catch {
    throw new AppError(
      "el state de Mercado Pago es inválido o expiró: volvé a intentar la conexión",
      400,
      "MP_OAUTH_INVALID_STATE"
    );
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

type VerifiedToken =
  | { ok: true; payload: jwt.JwtPayload }
  | { ok: false; error: AppError; cause: unknown };

/**
 * Verifica la firma de un token de sesión. Si no sirve devuelve un AppError 401;
 * si el error es nuestro (p. ej. falta JWT_SECRET), uno 500. `cause` es el error
 * original, para el log.
 */
function verifySessionToken(token: string): VerifiedToken {
  try {
    const payload = jwt.verify(token, secret());
    if (typeof payload === "string" || !payload.sub) {
      throw new Error("payload inválido");
    }
    return { ok: true, payload };
  } catch (cause) {
    // Diferenciar errores de JWT (deberían ser 401) de errores inesperados (deberían ser 500)
    // SOLO errores de verificación JWT propiamente dichos -> 401
    // Error de payload inválido (lanzado manualmente) -> 401
    const isTokenError =
      cause instanceof jwt.JsonWebTokenError ||
      cause instanceof jwt.TokenExpiredError ||
      cause instanceof jwt.NotBeforeError ||
      (cause instanceof Error && cause.message === "payload inválido");
    // Cualquier otro error inesperado (ej. secret() lanzando por JWT_SECRET
    // faltante) -> 500
    const error = isTokenError
      ? new AppError("token inválido o expirado", 401, "UNAUTHORIZED")
      : new AppError("error interno verificando token", 500, "INTERNAL_ERROR");
    return { ok: false, error, cause };
  }
}

function logVerifyFailure(cause: unknown) {
  // Log explícito para diagnosticar 500 vs 401
  console.error(
    "[auth] verify failed:",
    cause instanceof Error ? cause.name : "unknown",
    cause instanceof Error ? cause.message : String(cause)
  );
}

function attachSession(req: Request, payload: jwt.JwtPayload) {
  req.user = { id: payload.sub as string, role: payload.role as Role };
  req.token = { jti: payload.jti, expiresAt: new Date((payload.exp ?? 0) * 1000) };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);

  if (!token) {
    return next(new AppError("token requerido", 401, "UNAUTHORIZED"));
  }

  const verified = verifySessionToken(token);
  if (!verified.ok) {
    logVerifyFailure(verified.cause);
    return next(verified.error);
  }
  const { payload } = verified;

  // la firma puede ser válida y el token estar cerrado explícitamente: el
  // chequeo contra la base es una consulta más, así que va después de verificar
  // la firma (que es lo que descarta el 99% de los requests ajenos).
  void isTokenRevoked(payload.jti)
    .then((revoked) => {
      if (revoked) {
        next(new AppError("token cerrado: volvé a ingresar", 401, "TOKEN_REVOKED"));
        return;
      }
      attachSession(req, payload);
      next();
    })
    .catch(next);
}

/**
 * Para los endpoints públicos que muestran más a quien tiene sesión (perfil del
 * fletero, detalle del viaje). Sin token, o con uno que no sirve (vencido,
 * inválido o cerrado), sigue como anónimo: un token malo nunca da más datos, y
 * una sesión vieja guardada en el navegador no rompe una página pública.
 * Un error nuestro (500) sí corta.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return next();

  const verified = verifySessionToken(token);
  if (!verified.ok) {
    if (verified.error.statusCode === 401) return next();
    logVerifyFailure(verified.cause);
    return next(verified.error);
  }
  const { payload } = verified;

  void isTokenRevoked(payload.jti)
    .then((revoked) => {
      if (!revoked) attachSession(req, payload);
      next();
    })
    .catch(next);
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role !== role) {
      return next(new AppError("no autorizado para esta acción", 403, "FORBIDDEN"));
    }
    next();
  };
}
