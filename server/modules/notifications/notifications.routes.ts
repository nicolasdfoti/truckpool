import { Router } from "express";
import { requireAuth } from "../../lib/auth.js";
import { validateQuery } from "../../lib/validate.js";
import * as notificationsController from "./notifications.controller.js";
import { listNotificationsQuerySchema } from "./notifications.schemas.js";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/",
  requireAuth,
  validateQuery(listNotificationsQuerySchema),
  notificationsController.getNotifications
);

// read-all va antes que /:id/read: el orden importa en express y así una URL
// como /read-all nunca puede interpretarse como un id.
notificationsRouter.patch(
  "/read-all",
  requireAuth,
  notificationsController.patchAllNotificationsRead
);

notificationsRouter.patch(
  "/:id/read",
  requireAuth,
  notificationsController.patchNotificationRead
);
