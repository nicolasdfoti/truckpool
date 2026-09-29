import type { Request, Response } from "express";
import * as usersService from "./users.service.js";
import { AppError } from "../../lib/errors.js";
import { verifyOAuthState } from "../../lib/auth.js";

function requireUser(req: Request): string {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  return req.user.id;
}

export async function getMe(req: Request, res: Response) {
  const result = await usersService.getMyProfile(requireUser(req));
  res.json(result);
}

export async function patchMe(req: Request, res: Response) {
  const result = await usersService.updateMyProfile(requireUser(req), req.body);
  res.json(result);
}

export async function getMyTrips(req: Request, res: Response) {
  const trips = await usersService.listMyTrips(requireUser(req));
  res.json(trips);
}

export async function getMyCargoItems(req: Request, res: Response) {
  const items = await usersService.listMyCargoItems(requireUser(req));
  res.json(items);
}

export async function getCarriers(_req: Request, res: Response) {
  const carriers = await usersService.listCarriers();
  res.json(carriers);
}

export async function getCarrierProfile(req: Request, res: Response) {
  const value = req.params.id;
  const id = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  const profile = await usersService.getCarrierProfile(id);
  res.json(profile);
}

export async function patchVerification(req: Request, res: Response) {
  const result = await usersService.requestVerification(requireUser(req), req.body);
  res.json(result);
}

export async function getPendingVerifications(_req: Request, res: Response) {
  res.json(await usersService.listPendingVerifications());
}

export async function patchVerificationReview(req: Request, res: Response) {
  const value = req.params.userId;
  const userId = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  res.json(await usersService.reviewVerification(userId, req.body));
}

export async function getAdminStats(_req: Request, res: Response) {
  res.json({ stats: await usersService.getAdminStats() });
}

export async function patchAvailability(req: Request, res: Response) {
  // el schema ya valida isAvailableNow, pero aseguramos rol CARRIER
  if (req.user?.role !== "CARRIER") {
    throw new AppError(
      "solo los transportistas pueden cambiar su disponibilidad",
      403,
      "FORBIDDEN"
    );
  }
  const result = await usersService.updateMyProfile(requireUser(req), req.body);
  res.json(result);
}

export async function createTripRequest(req: Request, res: Response) {
  if (req.user?.role !== "COMPANY") {
    throw new AppError(
      "solo las empresas pueden solicitar viajes directos",
      403,
      "FORBIDDEN"
    );
  }
  const result = await usersService.createTripRequest(requireUser(req), req.body);
  res.status(201).json(result);
}

export async function getReceivedTripRequests(req: Request, res: Response) {
  if (req.user?.role !== "CARRIER") {
    throw new AppError(
      "solo los transportistas pueden ver sus solicitudes recibidas",
      403,
      "FORBIDDEN"
    );
  }
  const requests = await usersService.getReceivedTripRequests(requireUser(req));
  res.json(requests);
}

export async function getSentTripRequests(req: Request, res: Response) {
  if (req.user?.role !== "COMPANY") {
    throw new AppError(
      "solo las empresas pueden ver sus solicitudes enviadas",
      403,
      "FORBIDDEN"
    );
  }
  const requests = await usersService.getSentTripRequests(requireUser(req));
  res.json(requests);
}

export async function respondTripRequest(req: Request, res: Response) {
  if (req.user?.role !== "CARRIER") {
    throw new AppError(
      "solo los transportistas pueden responder solicitudes",
      403,
      "FORBIDDEN"
    );
  }
  const value = req.params.id;
  const id = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  const result = await usersService.respondTripRequest(id, requireUser(req), req.body);
  res.json(result);
}

/**
 * GET /api/users/me/mp-connect — Bearer + rol CARRIER.
 * Devuelve la URL de autorización OAuth de Mercado Pago para que el
 * transportista conecte su cuenta y reciba split payments.
 */
export async function getMpConnect(req: Request, res: Response) {
  if (req.user?.role !== "CARRIER") {
    throw new AppError(
      "solo los transportistas pueden conectar Mercado Pago",
      403,
      "FORBIDDEN"
    );
  }
  const { authUrl } = await usersService.getMpAuthUrl(requireUser(req));
  res.json({ authUrl });
}

/**
 * GET /api/users/me/mp-callback — Callback público de OAuth de Mercado Pago.
 *
 * No lleva `requireAuth` a propósito: a esta request la llega a hacer una
 * redirección del navegador del usuario, no un fetch con Bearer, así que no
 * hay header de auth que mandar. La identidad viaja firmada en el `state` que
 * generamos en `/me/mp-connect`.
 *
 * Como el usuario siempre cae acá dentro del navegador, ningún error se
 * devuelve como JSON: se redirige al perfil con el motivo, para que no quede
 * mirando una pantalla de error de la API.
 */
export async function getMpCallback(req: Request, res: Response) {
  const clientUrl = process.env.APP_URL ?? "http://localhost:5173";
  const profileUrl = (mp: string, reason?: string) =>
    `${clientUrl}/perfil?mp=${mp}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`;

  const { code, state, error } = req.query as Record<string, string | undefined>;

  try {
    if (error) {
      throw new AppError("Mercado Pago no autorizó la conexión", 400, "MP_OAUTH_DENIED");
    }
    if (!state) {
      throw new AppError("falta el state de la conexión", 400, "MP_OAUTH_MISSING_STATE");
    }
    if (!code) {
      throw new AppError(
        "falta el código de autorización de Mercado Pago",
        400,
        "MP_OAUTH_MISSING_CODE"
      );
    }
    const userId = verifyOAuthState(state);
    await usersService.exchangeMpCode(userId, code);
  } catch (err) {
    const reason = err instanceof AppError ? err.code : "MP_OAUTH_ERROR";
    return res.redirect(profileUrl("error", reason));
  }

  res.redirect(profileUrl("connected"));
}
