-- L7: por qué una carga quedó CANCELLED, para mostrar la etiqueta correcta
-- (retirada, viaje cancelado, salió sin confirmarla, reserva vencida, seña
-- devuelta por el fletero). Nullable y sin backfill: las canceladas de antes
-- quedan en null y el cliente las muestra como «cancelada», sin inventar la
-- causa.

-- CreateEnum
CREATE TYPE "CargoCancellationReason" AS ENUM ('COMPANY_WITHDREW', 'TRIP_CANCELLED', 'TRIP_DEPARTED', 'RESERVATION_EXPIRED', 'REFUNDED_BY_CARRIER');

-- AlterTable
ALTER TABLE "CargoItem" ADD COLUMN "cancellationReason" "CargoCancellationReason";
