import { prisma } from "../../lib/prisma.js";

/** cuántas trae la campanita por defecto: las últimas, no todo el histórico */
const DEFAULT_LIMIT = 20;

export type NotificationResponse = {
  id: string;
  type: string;
  title: string;
  body: string;
  tripId: string | null;
  read: boolean;
  createdAt: string;
};

function toResponse(notification: {
  id: string;
  type: string;
  title: string;
  body: string;
  tripId: string | null;
  read: boolean;
  createdAt: Date;
}): NotificationResponse {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    tripId: notification.tripId,
    read: notification.read,
    createdAt: notification.createdAt.toISOString(),
  };
}

export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {}
) {
  const notifications = await prisma.notification.findMany({
    where: { userId, ...(options.unreadOnly ? { read: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? DEFAULT_LIMIT,
  });
  return notifications.map(toResponse);
}

/**
 * Marca una notificación como leída. El filtro por userId va en el where (no
 * después): marcar la de otra persona tiene que ser un no-op, nunca un 403 que
 * confirme que ese id existe.
 */
export async function markNotificationRead(id: string, userId: string) {
  const updated = await prisma.notification.updateMany({
    where: { id, userId },
    data: { read: true },
  });
  return { updated: updated.count > 0 };
}

export async function markAllNotificationsRead(userId: string) {
  const updated = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
  return { updated: updated.count };
}
