import type { Request, Response } from "express";
import * as notificationsService from "./notifications.service.js";
import { AppError } from "../../lib/errors.js";
import type { ListNotificationsQuery } from "./notifications.schemas.js";

function requireUser(req: Request): string {
  if (!req.user) {
    throw new AppError("no autenticado", 401, "UNAUTHORIZED");
  }
  return req.user.id;
}

export async function getNotifications(req: Request, res: Response) {
  const { unreadOnly } = (res.locals.query ?? {}) as ListNotificationsQuery;
  const notifications = await notificationsService.listNotifications(requireUser(req), {
    unreadOnly,
  });
  res.json(notifications);
}

export async function patchNotificationRead(req: Request, res: Response) {
  const result = await notificationsService.markNotificationRead(
    String(req.params.id),
    requireUser(req)
  );
  res.json(result);
}

export async function patchAllNotificationsRead(req: Request, res: Response) {
  const result = await notificationsService.markAllNotificationsRead(requireUser(req));
  res.json(result);
}
