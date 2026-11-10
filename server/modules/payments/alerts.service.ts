import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { notifyUsers } from "../../lib/notifications.js";

/**
 * Aviso a los admins por plata que el sistema no pudo resolver solo: un cobro
 * que no se pudo asentar (webhook) o una devolución que no sale (outbox de
 * reembolsos).
 *
 * Idempotente por evento: `key` identifica el evento (tipo:pago:pago de MP en
 * el webhook, tipo:request en el outbox), y tanto MP como el worker lo repiten. La clave se reserva antes de avisar (la PK de
 * PaymentAlert la hace atómica aunque dos repeticiones lleguen a la vez); si
 * ya estaba, el aviso ya salió. Si el aviso falla, la clave se libera para que
 * el próximo reintento de MP lo mande.
 *
 * Best-effort: un aviso que falla no puede tumbar el webhook ni el worker (se
 * reintentaría algo que ya se decidió). Sin datos de la empresa: solo ids.
 */
export async function alertAdmins(
  key: string,
  aviso: { tripId: string | null; title: string; body: string }
) {
  try {
    await prisma.paymentAlert.create({ data: { key } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return; // este evento ya se avisó
    }
    console.error("[alertas] no se pudo reservar el aviso a los admins", {
      name: err instanceof Error ? err.name : typeof err,
    });
    return;
  }

  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    if (admins.length === 0) return;
    await notifyUsers(
      admins.map((a) => a.id),
      { type: "PAYMENT_ALERT", ...aviso }
    );
  } catch (err) {
    console.error("[alertas] falló el aviso a los admins", {
      name: err instanceof Error ? err.name : typeof err,
    });
    await prisma.paymentAlert.delete({ where: { key } }).catch(() => {});
  }
}
