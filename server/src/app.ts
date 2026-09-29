import express from "express";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { tripsRouter } from "../modules/trips/trips.routes.js";
import { getPublicTracking } from "../modules/trips/trips.controller.js";
import {
  adminRouter,
  carriersRouter,
  usersRouter,
} from "../modules/users/users.routes.js";
import { paymentsRouter } from "../modules/payments/payments.routes.js";
import { notificationsRouter } from "../modules/notifications/notifications.routes.js";
import { AppError } from "../lib/errors.js";
import { applyTrustProxy, securityHeaders } from "../lib/security.js";

const API_PREFIX = process.env.API_PREFIX ?? "/api";

export const app = express();

applyTrustProxy(app);
app.use(securityHeaders());
app.use(express.json());

const LOCALHOST_ORIGIN = /^http:\/\/localhost:\d+$/;

// el cliente lee este header para nombrar el archivo del manifiesto
const EXPOSED_HEADERS = ["Content-Disposition"];

function corsOptions(): cors.CorsOptions {
  if (process.env.NODE_ENV !== "production") {
    return {
      origin: (origin, callback) => {
        callback(null, !origin || LOCALHOST_ORIGIN.test(origin));
      },
      exposedHeaders: EXPOSED_HEADERS,
    };
  }
  const corsOrigin = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim());
  return corsOrigin
    ? { origin: corsOrigin, exposedHeaders: EXPOSED_HEADERS }
    : { exposedHeaders: EXPOSED_HEADERS };
}

// va después de helmet: cors pisa los headers de access-control y los dos
// middlewares no se pisan entre sí
app.use(cors(corsOptions()));

/**
 * Sonda de vida para el hosting (Railway, Fly, Docker) y para `docker compose
 * up`: responde sin tocar la base. Se expone en /health y también bajo el
 * prefijo de la API, que es de donde la consulta la gente.
 */
const startedAt = Date.now();
function healthHandler(_req: Request, res: Response) {
  res.json({
    status: "ok",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  });
}
app.get("/health", healthHandler);
app.get(`${API_PREFIX}/health`, healthHandler);

app.use(`${API_PREFIX}/auth`, authRouter);
app.use(`${API_PREFIX}/trips`, tripsRouter);

// Tracking público (sin auth): /api/tracking/:trackingCode
app.get(`${API_PREFIX}/tracking/:trackingCode`, getPublicTracking);

app.use(`${API_PREFIX}/users`, usersRouter);
app.use(`${API_PREFIX}/carriers`, carriersRouter);
app.use(`${API_PREFIX}/admin`, adminRouter);
app.use(`${API_PREFIX}/notifications`, notificationsRouter);
app.use(API_PREFIX, paymentsRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "ruta no encontrada", code: "NOT_FOUND" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  console.error(err);
  res.status(500).json({ error: "error interno", code: "INTERNAL_ERROR" });
});
