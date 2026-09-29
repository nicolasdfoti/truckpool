import { z } from "zod";

/**
 * `unreadOnly` llega como string ("true"/"1") desde la query: se acepta lo que
 * sea truthy y se normaliza a boolean, así el cliente no depende de cómo lo
 * serialice.
 */
export const listNotificationsQuerySchema = z.object({
  unreadOnly: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === "true" || value === "1" || value === true),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
