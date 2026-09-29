-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "destLat" DOUBLE PRECISION,
ADD COLUMN     "destLng" DOUBLE PRECISION,
ADD COLUMN     "originLat" DOUBLE PRECISION,
ADD COLUMN     "originLng" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Trip_status_originLat_idx" ON "Trip"("status", "originLat");

-- CreateIndex
CREATE INDEX "Trip_status_destLat_idx" ON "Trip"("status", "destLat");
