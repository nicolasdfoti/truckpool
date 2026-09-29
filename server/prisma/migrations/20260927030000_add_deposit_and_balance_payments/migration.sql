-- seña de reserva + saldo: una carga pasa a tener hasta dos pagos
-- (DEPOSIT al reservar, BALANCE al salir el viaje).

-- 1. porcentaje de seña que pide el transportista al publicar el viaje
ALTER TABLE "Trip" ADD COLUMN "depositPercent" INTEGER NOT NULL DEFAULT 20;

-- 2. importes de la reserva en CargoItem
ALTER TABLE "CargoItem" ADD COLUMN "depositAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "CargoItem" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "CargoItem" ADD COLUMN "cancellationFeeAmount" DECIMAL(12,2);

-- 3. tipo y reembolso acumulado en Payment
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT', 'BALANCE');
ALTER TABLE "Payment" ADD COLUMN "type" "PaymentType" NOT NULL DEFAULT 'DEPOSIT';
ALTER TABLE "Payment" ADD COLUMN "refundedAmount" DECIMAL(12,2);

-- 4. backfill: los pagos que ya existían eran por el total de la carga, así que
-- esa misma plata era la seña. si lo dejáramos en 0, al cobrar el saldo después
-- estaríamos cobrando de más.
UPDATE "CargoItem" SET "depositAmount" = "priceShare";

-- 5. un pago por carga ya no alcanza: el único era por cargoItemId
DROP INDEX "Payment_cargoItemId_key";
CREATE UNIQUE INDEX "Payment_cargoItemId_type_key" ON "Payment"("cargoItemId", "type");

-- 6. los pagos ya devueltos por completo quedan con el reembolso anotado, para
-- que el saldo pendiente se calcule sobre lo que realmente se cobró.
UPDATE "Payment" SET "refundedAmount" = "amount" WHERE "status" = 'REFUNDED';
