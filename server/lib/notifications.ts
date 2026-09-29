/**
 * Avisos in-app con email como canal opcional.
 *
 * Reglas de diseño:
 * - La notificación in-app es la fuente: se crea siempre y primero. Si el email
 *   falla (o no hay clave de Resend, o el usuario la apagó) el aviso in-app ya
 *   está igual.
 * - El email nunca bloquea al llamador: se despacha después de crear las filas y
 *   no se espera. Un Resend lento no puede hacer lento un "retirar carga".
 * - Un aviso por persona aunque la persona esté repetida en la lista (una
 *   empresa con dos cargas en el mismo viaje no debe recibir dos avisos
 *   idénticos).
 */
import type { NotificationType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { renderEmail, sendEmailToUser, tripUrl } from "./email.js";

/** el email que se manda, si el aviso necesita uno más rico que title/body */
export type NotificationEmail = { subject: string; html: string };

export type NotifyInput = {
  type: NotificationType;
  /** línea corta de la campanita */
  title: string;
  /** detalle de una o dos líneas */
  body: string;
  tripId?: string | null;
  /**
   * Email a medida para los avisos que necesitan más contexto del que cabe en
   * title/body (importes, varias cargas, ventana de cancelación). Si no se pasa,
   * se arma un email genérico con el title, el body y un link al viaje.
   */
  email?: (recipient: { name: string; email: string }) => NotificationEmail;
};

/** el email por defecto: el mismo aviso, con formato */
function defaultEmail(
  recipient: { name: string; email: string },
  data: NotifyInput
): NotificationEmail {
  return {
    subject: data.title,
    html: renderEmail({
      greeting: `hola ${recipient.name},`,
      paragraphs: [data.body],
      // exactOptionalPropertyTypes: la clave se omite si no hay viaje.
      ...(data.tripId
        ? { cta: { label: "ver el viaje", url: tripUrl(data.tripId) } }
        : {}),
    }),
  };
}

/**
 * Crea un aviso in-app para cada userId y despacha el email de los que lo
 * tienen habilitado. Devuelve cuántas notificaciones se crearon.
 */
export async function notifyUsers(userIds: string[], data: NotifyInput): Promise<number> {
  // una persona una vez: los llamadores arman las listas con las cargas de un
  // viaje y la misma empresa puede aparecer repetida.
  // un id que no sea string nunca es un usuario: el aviso es best-effort y no
  // puede reventar la operación que lo disparó.
  const targets = [
    ...new Set(
      userIds.filter((id): id is string => typeof id === "string").map((id) => id.trim())
    ),
  ].filter(Boolean);
  if (targets.length === 0) return 0;

  const users = await prisma.user.findMany({
    where: { id: { in: targets } },
    select: { id: true, name: true, email: true, emailNotifications: true },
  });
  if (users.length === 0) return 0;

  const { count } = await prisma.notification.createMany({
    data: users.map((user) => ({
      userId: user.id,
      type: data.type,
      title: data.title,
      body: data.body,
      tripId: data.tripId ?? null,
    })),
  });

  // El email va fire-and-forget: la respuesta HTTP no espera a Resend. Los
  // errores se loguean adentro de sendEmailToUser, que nunca lanza.
  const recipients = users.filter((user) => user.emailNotifications);
  if (recipients.length > 0) {
    void deliverEmails(recipients, data);
  }

  return count;
}

async function deliverEmails(
  recipients: { name: string; email: string; emailNotifications: boolean }[],
  data: NotifyInput
): Promise<void> {
  await Promise.all(
    recipients.map(async (user) => {
      try {
        const { subject, html } = data.email
          ? data.email(user)
          : defaultEmail(user, data);
        await sendEmailToUser(user, subject, html);
      } catch (err) {
        // ni un error de armado del email puede salir de acá: el aviso in-app
        // ya está creado y no se toca.
        console.error(
          `[notificaciones] no se pudo encolar el email de ${data.type} para ${user.email}:`,
          err
        );
      }
    })
  );
}
