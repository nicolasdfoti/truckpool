// Lógica de `npm run admin:create` (el entrypoint es create-admin.ts). Recibe la
// base por parámetro para poder probarla sin una base real.
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

/** el admin aprueba fleteros y ve CUIT y emails de todos: la clave es larga */
export const ADMIN_PASSWORD_MIN_LENGTH = 16;

export const DEFAULT_ADMIN_NAME = "Administración TruckPool";

/** un dato de entrada inválido: el script lo muestra tal cual y sale con 1 */
export class AdminInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminInputError";
  }
}

const adminInputSchema = z.object({
  // trim sin pasar a minúsculas, igual que el registro y el login
  email: z.string().trim().email("el email es inválido"),
  password: z
    .string()
    .min(
      ADMIN_PASSWORD_MIN_LENGTH,
      `la contraseña tiene que tener al menos ${ADMIN_PASSWORD_MIN_LENGTH} caracteres`
    ),
  name: z.string().trim().min(1, "el nombre no puede quedar vacío").optional(),
});

export type AdminInput = { email: string; password: string; name?: string };

/**
 * Crea un usuario ADMIN. Si el email ya existe aborta, sea cual sea su rol: no
 * promueve una cuenta existente ni le cambia la contraseña a nadie.
 */
export async function createAdmin(
  input: AdminInput,
  db: PrismaClient
): Promise<{ id: string; email: string }> {
  const parsed = adminInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdminInputError(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { email, password, name } = parsed.data;

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new AdminInputError(
      "ya existe una cuenta con ese email: no se crea nada ni se cambia su contraseña"
    );
  }

  const user = await db.user.create({
    data: {
      email,
      name: name ?? DEFAULT_ADMIN_NAME,
      password: await bcrypt.hash(password, 10),
      role: "ADMIN",
    },
  });
  return { id: user.id, email: user.email };
}
