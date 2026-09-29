import "express";
import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
      /**
       * Datos del token con el que entró el request, los deja `requireAuth`.
       * El logout necesita el `jti` para poder revocarlo del lado del server.
       * `jti` puede faltar en tokens firmados antes de que existiera.
       */
      token?: { jti?: string | undefined; expiresAt: Date };
    }
  }
}
