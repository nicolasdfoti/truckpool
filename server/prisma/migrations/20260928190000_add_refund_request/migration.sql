-- Reembolsos pendientes (patrón outbox).
--
-- Cuando la empresa retira una carga con seña pagada, NO llamamos a Mercado Pago
-- dentro de la transacción de la base. En su lugar, se crea una RefundRequest en
-- PENDING con el monto objetivo (lo que quoteCancellation dice que se devuelve).
-- Un processor separado (fuera de la TX) la toma, llama a refundPayment (ya
-- idempotente por Fase 2.1), y actualiza el status. Si falla, incrementa attempts
-- y guarda el error; queda en PENDING para reintento manual o automático.
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "RefundRequest" (
    "id"              TEXT NOT NULL,
    "cargoItemId"     TEXT NOT NULL,
    "targetAmount"    DECIMAL(12,2) NOT NULL,
    "status"          "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"        INTEGER NOT NULL DEFAULT 0,
    "lastError"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- único por cargo: un retiro genera a lo sumo un reembolso
CREATE UNIQUE INDEX "RefundRequest_cargoItemId_key" ON "RefundRequest"("cargoItemId");

-- el processor busca PENDING por createdAt
CREATE INDEX "RefundRequest_status_idx" ON "RefundRequest"("status");
CREATE INDEX "RefundRequest_createdAt_idx" ON "RefundRequest"("createdAt");
