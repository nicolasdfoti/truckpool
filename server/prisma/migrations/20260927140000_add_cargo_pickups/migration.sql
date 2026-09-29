-- AlterTable
ALTER TABLE "CargoItem" ADD COLUMN "pickupAddress" TEXT;
ALTER TABLE "CargoItem" ADD COLUMN "pickupLat" DOUBLE PRECISION;
ALTER TABLE "CargoItem" ADD COLUMN "pickupLng" DOUBLE PRECISION;
ALTER TABLE "CargoItem" ADD COLUMN "trackingCode" TEXT;
ALTER TABLE "CargoItem" ADD COLUMN "stopOrder" INTEGER;

-- Generar trackingCode para las cargas existentes: TP-{ultimos4TripId}-C{n}
-- donde n es el orden de creación dentro del viaje
WITH numbered AS (
  SELECT
    ci.id,
    'TP-' || UPPER(SUBSTRING(t.id FROM LENGTH(t.id) - 3 FOR 4)) || '-C' || ROW_NUMBER() OVER (PARTITION BY ci."tripId" ORDER BY ci."createdAt") AS code
  FROM "CargoItem" ci
  JOIN "Trip" t ON t.id = ci."tripId"
  WHERE ci."trackingCode" IS NULL
)
UPDATE "CargoItem" ci
SET "trackingCode" = n.code
FROM numbered n
WHERE ci.id = n.id;

-- Para pickupAddress existente, usar un placeholder que invite a editar
UPDATE "CargoItem"
SET "pickupAddress" = 'Dirección de retiro pendiente (editar en el viaje)'
WHERE "pickupAddress" IS NULL;

-- Ahora hacemos las columnas NOT NULL
ALTER TABLE "CargoItem" ALTER COLUMN "pickupAddress" SET NOT NULL;
ALTER TABLE "CargoItem" ALTER COLUMN "trackingCode" SET NOT NULL;

-- Unique constraint on trackingCode
CREATE UNIQUE INDEX "CargoItem_trackingCode_key" ON "CargoItem"("trackingCode");

-- Índice para consultas de paradas ordenadas
CREATE INDEX "CargoItem_tripId_stopOrder_idx" ON "CargoItem"("tripId", "stopOrder");