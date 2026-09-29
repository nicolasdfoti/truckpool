import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "el nombre no puede estar vacío").optional(),
  bio: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  emailNotifications: z.boolean().optional(),
  // solo aplica a CARRIER, el controller valida el rol
  isAvailableNow: z.boolean().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const requestVerificationSchema = z.object({
  taxId: z
    .string()
    .trim()
    .min(1, "el DNI o CUIT es obligatorio")
    .max(32, "el DNI o CUIT es demasiado largo"),
});

export type RequestVerificationInput = z.infer<typeof requestVerificationSchema>;

export const reviewVerificationSchema = z
  .object({
    approve: z.boolean({ message: "approve debe ser true o false" }),
    note: z.string().trim().max(500, "la nota es demasiado larga").optional(),
  })
  .refine(
    (value) => value.approve || (value.note !== undefined && value.note.length > 0),
    {
      message: "si rechazás la verificación, contá por qué",
      path: ["note"],
    }
  );

export type ReviewVerificationInput = z.infer<typeof reviewVerificationSchema>;

export const createTripRequestSchema = z.object({
  carrierId: z.string().trim().min(1, "el transportista es obligatorio"),
  origin: z.string().trim().min(1, "el origen es obligatorio"),
  destination: z.string().trim().min(1, "el destino es obligatorio"),
  desiredDate: z.coerce.date({ message: "la fecha es inválida" }),
  estimatedVolume: z
    .number({ message: "estimatedVolume debe ser un número" })
    .positive("estimatedVolume debe ser mayor a 0")
    .finite("estimatedVolume debe ser un número válido"),
  note: z.string().trim().max(500, "la nota es demasiado larga").optional(),
});

export type CreateTripRequestInput = z.infer<typeof createTripRequestSchema>;

export const respondTripRequestSchema = z.object({
  accept: z.boolean({ message: "accept debe ser true o false" }),
  // si acepta, el carrier completa los detalles del viaje real
  tripDetails: z
    .object({
      truckType: z.string().trim().min(1, "el tipo de vehículo es obligatorio"),
      capacityTotal: z
        .number({ message: "capacityTotal debe ser un número" })
        .positive("capacityTotal debe ser mayor a 0")
        .finite("capacityTotal debe ser un número válido"),
      price: z
        .number({ message: "price debe ser un número" })
        .positive("price debe ser mayor a 0")
        .finite("price debe ser un número válido"),
      depositPercent: z.coerce
        .number({ message: "depositPercent debe ser un número" })
        .int("depositPercent debe ser un número entero")
        .min(10, "la seña no puede ser menos del 10%")
        .max(50, "la seña no puede ser más del 50%")
        .optional()
        .default(20),
      features: z.array(z.string()).optional().default([]),
      departureTime: z
        .string()
        .trim()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "la hora tiene que tener formato HH:mm")
        .optional()
        .nullable(),
    })
    .optional(),
});

export type RespondTripRequestInput = z.infer<typeof respondTripRequestSchema>;
