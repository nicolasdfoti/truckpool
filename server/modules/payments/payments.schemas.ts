import { z } from "zod";

export const paymentWebhookSchema = z.object({
  type: z.string().optional(),
  action: z.string().optional(),
  live_mode: z.string().optional(),
  data: z
    .object({
      id: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
});

export type PaymentWebhookBody = z.infer<typeof paymentWebhookSchema>;

// el tipo de pago es opcional: si no viene, es la seña (el primer pago de la
// carga). el saldo se pide explícitamente cuando el viaje ya salió. el body
// entero también es opcional (puede no mandarse nada).
export const paymentPreferenceSchema = z
  .object({ type: z.enum(["DEPOSIT", "BALANCE"]) })
  .partial()
  .nullish();

export type PaymentPreferenceBody = z.infer<typeof paymentPreferenceSchema>;

// preference de prueba: sólo los campos mínimos de un item, sin back_urls ni
// webhook. Sirve para chequear que la integración y el SDK funcionan.
export const mpTestPreferenceSchema = z.object({
  title: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
});

export type MpTestPreferenceBody = z.infer<typeof mpTestPreferenceSchema>;
