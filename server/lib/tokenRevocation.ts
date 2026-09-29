import { prisma } from "./prisma.js";

/**
 * Revocación de tokens de sesión.
 *
 * Un JWT es verificable pero no anulable: mientras no expira, cualquiera que lo
 * tenga puede hacer requests. Cerrar sesión sólo borrando el token del navegador
 * deja viva la sesión en cualquier lado donde se haya copiado. Así que el logout
 * anota el `jti` del token acá y `requireAuth` lo consulta antes de autorizar.
 *
 * Cada fila se guarda con la expiración del token que anota, y las filas cuyo
 * token ya venció se borran solas: un `jti` expirado no pasa la verificación de
 * firma, así que su ausencia en la tabla no cambia nada.
 */

/** anota un token como cerrado. Idempotente: volver a cerrar sesión no falla. */
export async function revokeToken(jti: string, expiresAt: Date): Promise<void> {
  await prisma.revokedToken.upsert({
    where: { jti },
    create: { jti, expiresAt },
    update: {},
  });
}

/** true si ese token fue cerrado explícitamente */
export async function isTokenRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  const row = await prisma.revokedToken.findUnique({
    where: { jti },
    select: { jti: true },
  });
  return row !== null && row !== undefined;
}

/**
 * Borra las filas cuyo token ya expiró.
 *
 * Se llama de vez en cuando desde el propio logout, no con un job: la tabla
 * crece sólo con sesiones cerradas y el borrado es barato porque `expiresAt`
 * está indexado. Se limita a una tanda para que un logout no se convertir en
 * una operación larga si algún día se acumulaban muchas filas.
 */
export async function pruneRevokedTokens(now: Date = new Date()): Promise<number> {
  const result = await prisma.revokedToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return result.count;
}
