-- U9: trackingCode aleatorio. El código viejo (TP-{tripId.slice(-4)}-C{n}) se
-- podía adivinar: se guarda en legacyTrackingCode, donde sigue andando hasta que
-- el viaje queda COMPLETED o CANCELLED, y cada carga recibe uno nuevo con el
-- formato de lib/trackingCode.ts: TP-XXXX-XXXX-XXXX-XXXX, 80 bits en base32
-- Crockford.

-- AlterTable
ALTER TABLE "CargoItem" ADD COLUMN "legacyTrackingCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CargoItem_legacyTrackingCode_key" ON "CargoItem"("legacyTrackingCode");

-- Backfill. Los 80 bits salen de gen_random_uuid() (incluida en Postgres 13+),
-- salteando los bits fijos del uuid v4: el nibble de versión (hex 13) y el de
-- variante (hex 17). Quedan 12 + 3 + 5 = 20 hex aleatorios = 80 bits.
-- Solo se tocan los códigos con el formato viejo.
WITH random_bits AS (
  SELECT
    id,
    ('x' || substr(h, 1, 12) || substr(h, 14, 3) || substr(h, 18, 5))::bit(80) AS b
  FROM (
    SELECT id, replace(gen_random_uuid()::text, '-', '') AS h
    FROM "CargoItem"
    WHERE "trackingCode" !~ '^TP-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$'
  ) AS u
),
new_codes AS (
  SELECT
    id,
    (
      SELECT string_agg(
        substr(
          '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
          substring(b FROM i * 5 + 1 FOR 5)::bit(5)::int + 1,
          1
        ),
        '' ORDER BY i
      )
      FROM generate_series(0, 15) AS i
    ) AS c
  FROM random_bits
)
UPDATE "CargoItem" AS ci
SET
  "legacyTrackingCode" = ci."trackingCode",
  "trackingCode" = 'TP-' || substr(n.c, 1, 4) || '-' || substr(n.c, 5, 4)
    || '-' || substr(n.c, 9, 4) || '-' || substr(n.c, 13, 4)
FROM new_codes AS n
WHERE n.id = ci.id;
