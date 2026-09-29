import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().email("email inválido"),
  password: z.string().min(8, "la contraseña debe tener al menos 8 caracteres"),
  name: z.string().trim().min(1, "el nombre es obligatorio"),
  role: z.enum(["COMPANY", "CARRIER"]),
});

export const loginSchema = z.object({
  email: z.string().trim().email("email inválido"),
  password: z.string().min(1, "la contraseña es obligatoria"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
