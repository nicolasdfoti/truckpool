import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { signToken } from "../../lib/auth.js";
import { revokeToken, pruneRevokedTokens } from "../../lib/tokenRevocation.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";

function toPublicUser(user: { id: string; email: string; name: string; role: unknown }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function registerUser(data: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new AppError("ya existe una cuenta con ese email", 409, "EMAIL_TAKEN");
  }

  const password = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      password,
      role: data.role,
    },
  });

  return { token: signToken(user), user: toPublicUser(user) };
}

export async function loginUser(data: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) {
    throw new AppError("email o contraseña incorrectos", 401, "INVALID_CREDENTIALS");
  }

  const matches = await bcrypt.compare(data.password, user.password);
  if (!matches) {
    throw new AppError("email o contraseña incorrectos", 401, "INVALID_CREDENTIALS");
  }

  return { token: signToken(user), user: toPublicUser(user) };
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError("usuario no encontrado", 404, "USER_NOT_FOUND");
  }
  return toPublicUser(user);
}

/**
 * Cierra la sesión de verdad: el token queda anotado como revocado y a partir
 * de ahora `requireAuth` lo rechaza, aunque siga dentro de su ventana de 7 días.
 *
 * Borrar el token del navegador no alcanza: si alguien lo copió (XSS, un
 * dispositivo compartido, un proxy con logs) sigue sirviendo hasta que expira.
 *
 * Sólo revoca ESTE token, no los demás: cerrar sesión en el celular no debería
 * desloguear la sesión de la compu.
 */
export async function logoutUser(
  token: { jti?: string | undefined; expiresAt: Date } | undefined
) {
  // si el token no tiene jti no se puede revocar por id: sólo se le puede decir
  // al cliente que lo borre. No es el caso normal (signToken siempre lo pone).
  if (!token?.jti) {
    return { revoked: false };
  }
  await revokeToken(token.jti, token.expiresAt);
  // de paso se limpian los tokens vencidos: el logout es el único momento
  // garantizado en que el server está despierto y ya está tocando la base.
  await pruneRevokedTokens().catch(() => 0);
  return { revoked: true };
}
