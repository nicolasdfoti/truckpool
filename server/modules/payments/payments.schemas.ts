import { z } from "zod";

// Solo se validan los campos que usa el webhook: `type` y `data.id`. El resto
// del body de MP (id, live_mode, user_id, date_created, api_version, action)
// no se lee, y z.object lo descarta sin validarlo: un campo que no usamos no
// puede rechazar una notificación. Antes live_mode se pedía como texto, MP lo
// manda booleano y toda notificación real terminaba en 400 (04-launch, L1).
export const paymentWebhookSchema = z.object({
  type: z.string().optional(),
  data: z
    .object({
      // la doc lo muestra como texto; un número se acepta y se pasa a texto
      id: z.union([z.string(), z.number()]).transform(String).optional(),
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
