-- L6: localidad del retiro según el geocode ("Rosario"), sin calle ni número.
-- Es lo único del retiro que ven las otras empresas del viaje. Nullable: las
-- cargas existentes la completan con `npm run seed:geocode -- --cargas`, y un
-- geocode que no resuelve la deja en null.

-- AlterTable
ALTER TABLE "CargoItem" ADD COLUMN "pickupCity" TEXT;
