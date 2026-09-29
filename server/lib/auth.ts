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

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return next(new AppError("token requerido", 401, "UNAUTHORIZED"));
  }

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret());
    if (typeof payload === "string" || !payload.sub) {
      throw new Error("payload inválido");
    }
  } catch (err) {
    // Log explícito para diagnosticar 500 vs 401
    console.error("[auth] verify failed:", err instanceof Error ? err.name : "unknown", err instanceof Error ? err.message : String(err));
    // Diferenciar errores de JWT (deberían ser 401) de errores inesperados (deberían ser 500)
    // SOLO errores de verificación JWT propiamente dichos -> 401
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError || err instanceof jwt.NotBeforeError) {
      return next(new AppError("token inválido o expirado", 401, "UNAUTHORIZED"));
    }
    // Error de payload inválido (lanzado manualmente) -> 401
    if (err instanceof Error && err.message === "payload inválido") {
      return next(new AppError("token inválido o expirado", 401, "UNAUTHORIZED"));
    }
    // Cualquier otro error inesperado (ej. secret() lanzando por JWT_SECRET faltante) -> 500
    return next(new AppError("error interno verificando token", 500, "INTERNAL_ERROR"));
  }

  // la firma puede ser válida y el token estar cerrado explícitamente: el
  // chequeo contra la base es una consulta más, así que va después de verificar
  // la firma (que es lo que descarta el 99% de los requests ajenos).
  void isTokenRevoked(payload.jti)
    .then((revoked) => {
      if (revoked) {
        next(new AppError("token cerrado: volvé a ingresar", 401, "TOKEN_REVOKED"));
        return;
      }
      req.user = { id: payload.sub as string, role: payload.role as Role };
      req.token = { jti: payload.jti, expiresAt: new Date((payload.exp ?? 0) * 1000) };
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
